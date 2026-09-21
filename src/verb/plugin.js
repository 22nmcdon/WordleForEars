import {
  VERB_DEFAULTS, VERB_BANDS, MOST_DECAY, DECAY_FLOOR,
  makeImpulse, decayProfile, decayTimes, rt60, bandOf, monoOf, wetDryImpulse,
} from './ir.js';
import { VerbPlayer } from './player.js';
import { writeHertz } from '../comp/plugin.js';

/**
 * The reverb, as a plugin.
 *
 * Two pictures of the same room, because they answer different questions. The
 * impulse is what the room is - you can see the gap before it answers, the
 * walls arriving one at a time, and the wash closing over them. The decay is
 * what the room does, band by band, and it is also exactly what a guess is
 * marked against, so there is nothing hidden in the marking that is not on
 * the screen.
 */

const TIME_LOW = 0.004;   // where the decay display starts, in seconds
const TIME_HIGH = MOST_DECAY;

const decayX = (t, width) => (t <= TIME_LOW
  ? 0
  : (Math.log2(t / TIME_LOW) / Math.log2(TIME_HIGH / TIME_LOW)) * width);
const decayY = (db, height) => (db / DECAY_FLOOR) * height;

const keepIn = (value, low, high) => Math.min(high, Math.max(low, value));

export const writeSeconds = (s) => (s >= 1 ? `${s.toFixed(2)} s` : `${Math.round(s * 1000)} ms`);

/** Every knob, and how it reads. */
const VERB_KNOBS = [
  { id: 'preDelay', name: 'Pre-delay', min: 0, max: 200, step: 1, write: (v) => `${Math.round(v)} ms` },
  { id: 'decay', name: 'Decay', min: 0.2, max: MOST_DECAY, log: true, write: (v) => writeSeconds(v) },
  { id: 'size', name: 'Size', min: 4, max: 60, log: true, write: (v) => `${Math.round(v)} m` },
  { id: 'damping', name: 'HF decay', min: 0.2, max: 1, step: 0.01, write: (v) => `× ${v.toFixed(2)}` },
  { id: 'early', name: 'Early', min: 0, max: 0.8, step: 0.01, write: (v) => `${Math.round(v * 100)} %` },
  { id: 'lowCut', name: 'Low cut', min: 20, max: 800, log: true, write: writeHertz },
  { id: 'highCut', name: 'High cut', min: 1500, max: 20000, log: true, write: writeHertz },
  { id: 'mix', name: 'Mix', min: 0, max: 1, step: 0.01, write: (v) => `${Math.round(v * 100)} %` },
];

const dialOf = (knob, value) => (knob.log
  ? { min: Math.log2(knob.min), max: Math.log2(knob.max), step: 0.005, at: Math.log2(Math.max(knob.min, value)) }
  : { min: knob.min, max: knob.max, step: knob.step, at: value });

const offDial = (knob, raw) => (knob.log ? 2 ** Number(raw) : Number(raw));

/** The three bands wear the same warm-to-cool ramp the EQ's regions do. */
const VERB_TINTS = { low: '--rust', mid: '--gold', high: '--enclosure' };

function verbPalette(el) {
  const style = getComputedStyle(el);
  const read = (name) => style.getPropertyValue(name).trim();
  return {
    bands: Object.fromEntries(Object.entries(VERB_TINTS).map(([id, token]) => [id, read(token)])),
    blush: read('--blush'),
    accent: read('--blush-deep'),
    sage: read('--sage'),
    gold: read('--gold'),
    paper: read('--paper'),
    soft: 'rgba(250, 246, 240, 0.55)',
    grid: 'rgba(250, 246, 240, 0.14)',
    faint: 'rgba(250, 246, 240, 0.07)',
  };
}

export class VerbPlugin {
  constructor(el, { engine, settings, onChange, source = 'instrument' }) {
    this.el = el;
    this.engine = engine;
    this.settings = settings;
    this.onChange = onChange;
    this.interactive = true;
    this.target = null;      // drawn only once the round is over
    this.impulse = null;
    this.profile = null;
    this.columns = null;

    this.player = new VerbPlayer(engine, { source });

    this.build();
    this.restage();
    this.draw();

    // Rendered rather than played, so the room is on the screen before
    // anybody presses anything.
    this.player.prepare()
      .then(() => this.queue())
      .catch(() => { /* no audio yet; the pictures still work */ });
  }

  /* ---------- the furniture ---------- */

  build() {
    this.el.innerHTML = `
      <div class="verb">
        <div class="plugin-head">
          <span class="plugin-name">Reverb</span>
          <span class="plugin-trim" id="verbTrim"></span>
          <span class="plugin-read" id="verbRead"></span>
        </div>

        <div class="verb-display">
          <div class="plugin-panel verb-panel-room">
            <canvas id="verbRoom"></canvas>
          </div>
          <div class="plugin-panel verb-panel-decay">
            <canvas id="verbDecay"></canvas>
          </div>
        </div>

        <div class="plugin-controls" id="verbKnobs"></div>

        <div class="eq-transport verb-transport">
          <button class="play-btn" type="button" data-verb="play">Play</button>
          <div class="eq-ab" role="group" aria-label="What you are hearing">
            <button class="ab-btn is-on" type="button" data-hear="mine">Yours</button>
            <button class="ab-btn" type="button" data-hear="theirs" id="verbOther">Target</button>
          </div>
          <label class="field">
            <span class="field-label">Sample</span>
            <select id="verbSource">
              <option value="instrument">Keys</option>
              <option value="drums">Drums</option>
              <option value="mix">Full mix</option>
              <option value="bass">Bass</option>
              <option value="yours" id="verbYours" hidden>Your own</option>
            </select>
          </label>
          <label class="file-btn">Open a file<input type="file" id="verbFile" accept="audio/*"></label>
          <button class="link-btn" type="button" data-verb="reset">Reset</button>
        </div>
      </div>`;

    this.room = this.el.querySelector('#verbRoom');
    this.decay = this.el.querySelector('#verbDecay');
    this.el.querySelector('#verbSource').value = this.player.source;

    this.buildKnobs();
    this.wire();
  }

  buildKnobs() {
    this.el.querySelector('#verbKnobs').innerHTML = VERB_KNOBS.map((knob) => {
      const dial = dialOf(knob, this.settings[knob.id]);
      return `
        <div class="knob">
          <label class="knob-name" for="verb-${knob.id}">${knob.name}</label>
          <output class="knob-value" id="verb-${knob.id}-value">${knob.write(this.settings[knob.id])}</output>
          <input class="knob-dial" type="range" id="verb-${knob.id}" data-dial="${knob.id}"
                 min="${dial.min}" max="${dial.max}" step="${dial.step}" value="${dial.at}"
                 aria-label="${knob.name}">
        </div>`;
    }).join('');
  }

  wire() {
    this.el.querySelector('#verbKnobs').addEventListener('input', (e) => {
      const dial = e.target.closest('[data-dial]');
      if (!dial || !this.interactive) return;
      const knob = VERB_KNOBS.find((k) => k.id === dial.dataset.dial);
      this.settings[knob.id] = offDial(knob, dial.value);
      this.changed();
    });

    this.el.addEventListener('click', (e) => {
      const hear = e.target.closest('[data-hear]');
      if (hear) {
        this.player.hear(hear.dataset.hear);
        for (const button of this.el.querySelectorAll('[data-hear]')) {
          button.classList.toggle('is-on', button === hear);
        }
        return;
      }

      const action = e.target.closest('[data-verb]');
      if (!action) return;
      if (action.dataset.verb === 'play') this.toggle();
      if (action.dataset.verb === 'reset' && this.interactive) {
        Object.assign(this.settings, VERB_DEFAULTS);
        this.buildKnobs();
        this.changed();
      }
    });

    this.el.querySelector('#verbSource').addEventListener('change', async (e) => {
      this.player.source = e.target.value;
      this.player.buffer = null;
      await this.player.prepare();
      this.player.mine.made = null;
      if (this.player.theirs) this.player.theirs.made = null;
      await this.player.setSettings(this.settings);
      if (this.player.target) await this.player.setTarget(this.player.target);
      if (this.player.playing) await this.player.play();
      this.draw();
    });

    this.el.querySelector('#verbFile').addEventListener('change', (e) => this.open(e));

    this.resize = () => { this.restage(); this.draw(); };
    window.addEventListener('resize', this.resize);
  }

  async open(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    const yours = this.el.querySelector('#verbYours');
    yours.hidden = false;
    yours.textContent = 'reading…';

    try {
      const buffer = await this.player.load(file);
      this.el.querySelector('#verbSource').value = 'yours';
      this.player.source = 'yours';
      this.player.buffer = null;
      await this.player.prepare();
      this.player.mine.made = null;
      if (this.player.theirs) this.player.theirs.made = null;
      await this.player.setSettings(this.settings);
      if (this.player.target) await this.player.setTarget(this.player.target);
      await this.player.play();
      this.playing(true);
      yours.textContent = `${file.name} · ${Math.round(buffer.duration)}s`;
    } catch {
      yours.textContent = 'that file could not be read';
      return;
    }

    this.draw();
  }

  /**
   * A knob moved.
   *
   * The pictures are redrawn straight away, from an impulse built here and
   * now; the sound follows when its render is done. Building the room is a
   * few milliseconds and rendering the loop through it is a few more, so the
   * two are kept apart - the display should not wait on the audio thread, and
   * the audio should not be re-rendered once per frame of a drag.
   */
  changed() {
    this.syncKnobs();
    this.restage();
    this.draw();
    this.queue();
    this.onChange?.(this.settings);
  }

  /** Renders the room into the loop, latest settings winning. */
  queue() {
    this.pending = true;
    if (this.rendering) return;

    this.rendering = true;
    (async () => {
      while (this.pending) {
        this.pending = false;
        try {
          await this.player.setSettings({ ...this.settings });
        } catch {
          // No audio context yet, or the render was cut short. The pictures
          // are already right; the sound catches up on the next change.
        }
      }
      this.rendering = false;
      this.writeReadout();
    })();
  }

  syncKnobs() {
    for (const knob of VERB_KNOBS) {
      const readout = this.el.querySelector(`#verb-${knob.id}-value`);
      if (readout) readout.textContent = knob.write(this.settings[knob.id]);
    }
  }

  async toggle() {
    if (this.player.playing) {
      this.player.stop();
      this.playing(false);
      return;
    }
    await this.player.play();
    this.playing(true);
  }

  playing(on) {
    this.el.querySelector('[data-verb="play"]').textContent = on ? 'Stop' : 'Play';
    cancelAnimationFrame(this.frame);
    this.frame = null;
    if (!on) { this.writeReadout(); return; }

    const tick = () => {
      this.writeReadout();
      this.frame = requestAnimationFrame(tick);
    };
    tick();
  }

  /* ---------- drawing ---------- */

  /**
   * The room, measured, ready to be drawn.
   *
   * Done when something changes rather than once a frame: building an impulse
   * and reading its decay in three bands is tens of milliseconds, and the
   * only thing that moves between changes is a number in the readout.
   */
  restage() {
    const rate = this.engine.ctx?.sampleRate ?? 48000;
    this.impulse = makeImpulse(rate, this.settings);
    this.times = decayTimes();
    // What is drawn is what is marked: the room and the dry sound together.
    this.profile = decayProfile(wetDryImpulse(this.impulse, this.settings.mix), rate, this.times);

    const mono = monoOf(this.impulse);
    this.measured = {
      rt: Object.fromEntries(VERB_BANDS.map((band) =>
        [band.id, rt60(bandOf(mono, rate, band), rate)])),
    };

    this.columns = null;
    const { width } = this.sizeOf(this.room);
    if (!width) return;

    // The impulse boiled down to one pair of numbers a column: how far it
    // swings either way. A quarter of a million samples behind four hundred
    // pixels has to be reduced by something, and the loudest either way is
    // what an impulse looks like.
    const count = Math.max(1, Math.round(width));
    const high = new Float32Array(count);
    const low = new Float32Array(count);
    const per = this.impulse.length / count;

    for (let x = 0; x < count; x += 1) {
      const from = Math.floor(x * per);
      const to = Math.min(this.impulse.length, Math.floor((x + 1) * per));
      let top = 0;
      let bottom = 0;
      for (let i = from; i < to; i += 1) {
        const value = mono[i];
        if (value > top) top = value;
        if (value < bottom) bottom = value;
      }
      high[x] = top;
      low[x] = bottom;
    }

    // Scaled to whatever the loudest thing in this room is, because the
    // impulses are normalised to energy and a long one is therefore quieter
    // sample by sample than a short one.
    let peak = 1e-6;
    for (let x = 0; x < count; x += 1) peak = Math.max(peak, high[x], -low[x]);
    this.columns = { high, low, count, peak };
  }

  sizeOf(canvas) {
    const box = canvas.getBoundingClientRect();
    return { width: box.width, height: box.height };
  }

  ready(canvas) {
    const { width, height } = this.sizeOf(canvas);
    if (!width || !height) return null;

    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(width * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }

    const c = canvas.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, width, height);
    return { c, width, height };
  }

  draw() {
    const ink = verbPalette(this.el);
    this.drawRoom(ink);
    this.drawDecay(ink);
    this.writeReadout();
  }

  drawRoom(ink) {
    const stage = this.ready(this.room);
    if (!stage || !this.columns) return;
    const { c, width, height } = stage;
    const { high, low, count, peak } = this.columns;

    const middle = height / 2;
    const span = width / count;
    const seconds = this.impulse.seconds;

    // A line every half second, so the length of the room is readable rather
    // than just visible.
    c.strokeStyle = ink.grid;
    c.lineWidth = 1;
    c.font = '9.5px system-ui, sans-serif';
    c.fillStyle = ink.soft;
    c.textAlign = 'left';
    const stepFor = seconds > 4 ? 1 : seconds > 1.5 ? 0.5 : 0.1;
    for (let t = stepFor; t < seconds; t += stepFor) {
      const x = (t / seconds) * width;
      c.beginPath(); c.moveTo(x, 0); c.lineTo(x, height); c.stroke();
    }

    c.strokeStyle = 'rgba(250, 246, 240, 0.28)';
    c.beginPath(); c.moveTo(0, middle); c.lineTo(width, middle); c.stroke();

    // The gap before the room answers: the one thing on this display that
    // people reliably cannot hear and reliably can see.
    const gap = (this.impulse.preDelay / seconds) * width;
    if (gap > 1) {
      c.fillStyle = 'rgba(250, 246, 240, 0.06)';
      c.fillRect(0, 0, gap, height);
      c.strokeStyle = ink.gold;
      c.setLineDash([3, 3]);
      c.beginPath(); c.moveTo(gap, 0); c.lineTo(gap, height); c.stroke();
      c.setLineDash([]);
    }

    // Drawn in decibels. In plain amplitude a tail is invisible within a
    // fifth of a second - an exponential decay spends almost all of its
    // length very near zero - so the panel was a spike at the left and four
    // fifths of nothing.
    //
    // The floor is eighty-five decibels down rather than sixty, because what
    // it is measured against is the loudest single thing in the room, and
    // that is a reflection: one sample carrying a whole copy of the sound,
    // twenty-odd decibels above the wash it arrives in front of. Against a
    // sixty decibel floor the wash ran out of room halfway across.
    const reach = (value) => {
      const level = Math.abs(value) / peak;
      return level <= 0 ? 0 : Math.max(0, 1 + Math.log10(level) / 4.25);
    };

    c.beginPath();
    for (let x = 0; x < count; x += 1) {
      const at = x * span;
      c.moveTo(at, middle - reach(high[x]) * middle * 0.94);
      c.lineTo(at, middle + reach(low[x]) * middle * 0.94);
    }
    c.strokeStyle = ink.blush;
    c.lineWidth = Math.max(1, span);
    c.stroke();

    c.fillStyle = ink.soft;
    c.font = '9.5px system-ui, sans-serif';
    c.textAlign = 'left';
    c.fillText(`the room · ${writeSeconds(seconds)} · dB`, 6, height - 6);
  }

  drawDecay(ink) {
    const stage = this.ready(this.decay);
    if (!stage || !this.profile) return;
    const { c, width, height } = stage;

    c.lineWidth = 1;
    c.font = '9.5px system-ui, sans-serif';

    c.strokeStyle = ink.grid;
    c.fillStyle = ink.soft;
    c.textAlign = 'right';
    for (let db = -10; db > DECAY_FLOOR; db -= 10) {
      const y = decayY(db, height);
      c.beginPath(); c.moveTo(0, y); c.lineTo(width, y); c.stroke();
      c.fillText(`${db}`, width - 4, y - 3);
    }

    c.textAlign = 'center';
    for (const t of [0.01, 0.1, 1, 4]) {
      const x = decayX(t, width);
      c.beginPath(); c.moveTo(x, 0); c.lineTo(x, height); c.stroke();
      c.fillText(t >= 1 ? `${t}s` : `${t * 1000}ms`, x, height - 4);
    }

    const trace = (profile, alpha, dash) => {
      for (const band of VERB_BANDS) {
        const curve = profile[band.id];
        c.beginPath();
        for (let i = 0; i < curve.length; i += 1) {
          const x = decayX(this.times[i], width);
          const y = decayY(curve[i], height);
          if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
        }
        c.strokeStyle = ink.bands[band.id];
        c.globalAlpha = alpha;
        c.lineWidth = 2;
        c.setLineDash(dash);
        c.stroke();
        c.setLineDash([]);
        c.globalAlpha = 1;
      }
    };

    if (this.targetProfile) trace(this.targetProfile, 0.5, [6, 4]);
    trace(this.profile, 1, []);

    c.fillStyle = ink.soft;
    c.textAlign = 'left';
    c.fillText('how it decays · low, mid, high', 6, height - 16);
  }

  writeReadout() {
    const trim = this.el.querySelector('#verbTrim');
    if (!trim) return;

    const mix = this.settings.mix;
    const back = 20 * Math.log10(1 / Math.sqrt((1 - mix) ** 2 + mix ** 2));
    trim.textContent = Math.abs(back) < 0.05
      ? 'auto gain · none'
      : `auto gain · ${back > 0 ? '+' : '−'}${Math.abs(back).toFixed(1)} dB`;

    const parts = [];
    if (this.measured) {
      const { low, mid, high } = this.measured.rt;
      parts.push(`${writeSeconds(low)} low · ${writeSeconds(mid)} mid · ${writeSeconds(high)} high`);
    }
    parts.push(`${Math.round(this.settings.preDelay)} ms in front`);
    if (this.player.playing) parts.push(`out ${this.player.level().toFixed(0)} dB`);

    this.el.querySelector('#verbRead').textContent = parts.join(' · ');
  }

  /* ---------- what the round does to it ---------- */

  async setTarget(target) {
    await this.player.setTarget(target);
  }

  showTarget(target) {
    const rate = this.engine.ctx?.sampleRate ?? 48000;
    this.target = target;
    const theirs = makeImpulse(rate, target);
    this.targetProfile = decayProfile(
      wetDryImpulse(theirs, target.mix), rate, this.times ?? decayTimes());
    this.draw();
  }

  nameOther(label) {
    this.el.querySelector('#verbOther').textContent = label;
  }

  lock() {
    this.interactive = false;
    this.el.querySelector('.verb').classList.add('is-locked');
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    window.removeEventListener('resize', this.resize);
    this.player.destroy();
  }
}
