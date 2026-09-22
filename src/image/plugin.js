import {
  IMAGE_DEFAULTS, IMAGE_BANDS, IMAGE_FLOOR, WIDEST, imageOf, widthOf,
} from './field.js';
import { ImagePlayer } from './player.js';
import { dialOf, offDial, sizeOf, readyCanvas } from '../fx/panel.js';
import { writeHertz } from '../comp/plugin.js';

/**
 * The imager, as a plugin.
 *
 * Two pictures, and they answer the two questions anybody has about a stereo
 * mix. The goniometer is the live one: it draws the two channels against each
 * other, so a mono signal is a vertical line, a wide one is a cloud, and
 * anything leaning over to the horizontal is two channels disagreeing - which
 * is what will not survive being summed. The bars are the considered one:
 * width band by band, coloured by whether the two channels in that band are
 * agreeing or arguing.
 */

const WIDTH_TOP = 6;      // decibels of width the bars reach to

const bandX = (i, width) => ((i + 0.5) / IMAGE_BANDS.length) * width;
const widthY = (db, height) => height - ((db - IMAGE_FLOOR) / (WIDTH_TOP - IMAGE_FLOOR)) * height;

/** Every knob, and how it reads. */
const IMAGE_KNOBS = [
  { id: 'low', name: 'Low width', min: 0, max: WIDEST, step: 0.01, write: (v) => `${Math.round(v * 100)} %` },
  { id: 'mid', name: 'Mid width', min: 0, max: WIDEST, step: 0.01, write: (v) => `${Math.round(v * 100)} %` },
  { id: 'high', name: 'High width', min: 0, max: WIDEST, step: 0.01, write: (v) => `${Math.round(v * 100)} %` },
  { id: 'lowMid', name: 'Low ends at', min: 80, max: 800, log: true, write: writeHertz },
  { id: 'midHigh', name: 'Top starts at', min: 1500, max: 10000, log: true, write: writeHertz },
  {
    id: 'pan',
    name: 'Pan',
    min: -1,
    max: 1,
    step: 0.01,
    write: (v) => (Math.abs(v) < 0.02 ? 'Centre' : `${Math.round(Math.abs(v) * 100)}% ${v < 0 ? 'left' : 'right'}`),
  },
];

const LISTENS = [
  { id: 'stereo', label: 'Stereo' },
  { id: 'mono', label: 'Mono' },
  { id: 'side', label: 'Side' },
];

function imagePalette(el) {
  const style = getComputedStyle(el);
  const read = (name) => style.getPropertyValue(name).trim();
  return {
    blush: read('--blush'),
    accent: read('--blush-deep'),
    sage: read('--sage'),
    gold: read('--gold'),
    rust: read('--rust'),
    soft: 'rgba(250, 246, 240, 0.55)',
    grid: 'rgba(250, 246, 240, 0.14)',
    zero: 'rgba(250, 246, 240, 0.3)',
  };
}

/** Agreeing, arguing, or somewhere between - the colour a band is drawn in. */
function agreement(correlation, ink) {
  if (correlation >= 0.6) return ink.sage;
  if (correlation >= 0) return ink.gold;
  return ink.rust;
}

export class ImagePlugin {
  constructor(el, { engine, settings, onChange, source = 'mix', fault = null }) {
    this.el = el;
    this.engine = engine;
    this.settings = settings;
    this.onChange = onChange;
    this.interactive = true;
    this.target = null;
    this.profile = null;
    this.readAt = 0;

    this.player = new ImagePlayer(engine, { source });
    this.player.setFault(fault);

    this.build();
    this.draw();

    this.player.prepare()
      .then(() => { this.measure(); this.draw(); })
      .catch(() => { /* no audio yet; the knobs still work */ });
  }

  /* ---------- the furniture ---------- */

  build() {
    this.el.innerHTML = `
      <div class="image">
        <div class="plugin-head">
          <span class="plugin-name">Stereo image</span>
          <span class="plugin-trim" id="imageTrim"></span>
          <span class="plugin-read" id="imageRead"></span>
        </div>

        <div class="image-display">
          <div class="plugin-panel image-panel-scope">
            <canvas id="imageScope"></canvas>
          </div>
          <div class="plugin-panel image-panel-bands">
            <canvas id="imageBands"></canvas>
          </div>
        </div>

        <div class="plugin-controls" id="imageKnobs"></div>

        <div class="image-routing">
          <span class="panel-name">Listen</span>
          <div class="eq-ab" role="group" aria-label="What you are monitoring">
            ${LISTENS.map((l) => `<button class="ab-btn${l.id === 'stereo' ? ' is-on' : ''}" type="button" data-listen="${l.id}">${l.label}</button>`).join('')}
          </div>
          <span class="eq-hint">mono is the check that matters — what survives it is what everybody hears</span>
        </div>

        <div class="eq-transport image-transport">
          <button class="play-btn" type="button" data-image="play">Play</button>
          <div class="eq-ab" role="group" aria-label="What you are hearing">
            <button class="ab-btn is-on" type="button" data-hear="mine">Yours</button>
            <button class="ab-btn" type="button" data-hear="theirs" id="imageOther">Target</button>
          </div>
          <label class="field">
            <span class="field-label">Sample</span>
            <select id="imageSource">
              <option value="mix">Full mix</option>
              <option value="instrument">Keys</option>
              <option value="drums">Drums</option>
              <option value="yours" id="imageYours" hidden>Your own</option>
            </select>
          </label>
          <label class="file-btn">Open a file<input type="file" id="imageFile" accept="audio/*"></label>
          <button class="link-btn" type="button" data-image="reset">Reset</button>
        </div>
      </div>`;

    this.scope = this.el.querySelector('#imageScope');
    this.bands = this.el.querySelector('#imageBands');
    this.el.querySelector('#imageSource').value = this.player.source;

    this.buildKnobs();
    this.wire();
  }

  buildKnobs() {
    this.el.querySelector('#imageKnobs').innerHTML = IMAGE_KNOBS.map((knob) => {
      const dial = dialOf(knob, this.settings[knob.id]);
      return `
        <div class="knob">
          <label class="knob-name" for="image-${knob.id}">${knob.name}</label>
          <output class="knob-value" id="image-${knob.id}-value">${knob.write(this.settings[knob.id])}</output>
          <input class="knob-dial" type="range" id="image-${knob.id}" data-dial="${knob.id}"
                 min="${dial.min}" max="${dial.max}" step="${dial.step}" value="${dial.at}"
                 aria-label="${knob.name}">
        </div>`;
    }).join('');
  }

  wire() {
    this.el.querySelector('#imageKnobs').addEventListener('input', (e) => {
      const dial = e.target.closest('[data-dial]');
      if (!dial || !this.interactive) return;
      const knob = IMAGE_KNOBS.find((k) => k.id === dial.dataset.dial);
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

      const listen = e.target.closest('[data-listen]');
      if (listen) {
        // Monitoring, not processing: it changes what you are checking and
        // never what you are marked on.
        this.settings.listen = listen.dataset.listen;
        for (const button of this.el.querySelectorAll('[data-listen]')) {
          button.classList.toggle('is-on', button === listen);
        }
        this.player.setSettings(this.settings);
        if (this.player.target) this.player.setTarget({ ...this.player.target, listen: this.settings.listen });
        this.writeReadout();
        return;
      }

      const action = e.target.closest('[data-image]');
      if (!action) return;
      if (action.dataset.image === 'play') this.toggle();
      if (action.dataset.image === 'reset' && this.interactive) {
        const listen = this.settings.listen;
        Object.assign(this.settings, IMAGE_DEFAULTS, { listen });
        this.buildKnobs();
        this.changed();
      }
    });

    this.el.querySelector('#imageSource').addEventListener('change', async (e) => {
      this.player.source = e.target.value;
      this.player.buffer = null;
      await this.player.prepare();
      if (this.player.playing) await this.player.play();
      this.measure();
      this.draw();
    });

    this.el.querySelector('#imageFile').addEventListener('change', (e) => this.open(e));

    this.resize = () => this.draw();
    window.addEventListener('resize', this.resize);
  }

  async open(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    const yours = this.el.querySelector('#imageYours');
    yours.hidden = false;
    yours.textContent = 'reading…';

    try {
      const buffer = await this.player.load(file);
      this.el.querySelector('#imageSource').value = 'yours';
      this.player.source = 'yours';
      this.player.buffer = null;
      await this.player.prepare();
      await this.player.play();
      this.playing(true);
      yours.textContent = `${file.name} · ${Math.round(buffer.duration)}s`
        + (buffer.numberOfChannels > 1 ? '' : ' · mono');
    } catch {
      yours.textContent = 'that file could not be read';
      return;
    }

    this.measure();
    this.draw();
  }

  changed() {
    this.syncKnobs();
    this.player.setSettings(this.settings);
    this.schedule();
    this.draw();
    this.onChange?.(this.settings);
  }

  /**
   * Reads the image off the material, no more often than it is worth doing.
   *
   * Filtering a bar of stereo audio into six bands and correlating each one
   * is tens of milliseconds - fine once, far too slow for every frame of a
   * drag. The goniometer is the live picture; this is the considered one, and
   * it catches up when the hand stops.
   */
  schedule() {
    clearTimeout(this.soon);
    this.soon = setTimeout(() => { this.measure(); this.draw(); }, 120);
  }

  measure() {
    const sample = this.player.sample();
    if (!sample) return;
    this.profile = imageOf(sample.left, sample.right, sample.rate, this.settings);
  }

  syncKnobs() {
    for (const knob of IMAGE_KNOBS) {
      const readout = this.el.querySelector(`#image-${knob.id}-value`);
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
    this.el.querySelector('[data-image="play"]').textContent = on ? 'Stop' : 'Play';
    cancelAnimationFrame(this.frame);
    this.frame = null;
    if (!on) { this.draw(); return; }

    const tick = () => {
      this.draw();
      this.frame = requestAnimationFrame(tick);
    };
    tick();
  }

  /* ---------- drawing ---------- */

  draw() {
    const ink = imagePalette(this.el);
    this.drawScope(ink);
    this.drawBands(ink);
    this.writeReadout();
  }

  /**
   * The goniometer: the two channels drawn against each other, turned so that
   * what they agree on points up.
   *
   * Straight up and down is mono. A cloud is wide. Anything lying over
   * towards the horizontal is two channels arguing, and the horizontal is
   * exactly the axis that disappears when somebody sums them.
   */
  drawScope(ink) {
    const stage = readyCanvas(this.scope);
    if (!stage) return;
    const { c, width, height } = stage;

    const middle = { x: width / 2, y: height / 2 };
    const reach = Math.min(width, height) * 0.44;

    c.strokeStyle = ink.grid;
    c.lineWidth = 1;
    c.beginPath();
    c.arc(middle.x, middle.y, reach, 0, Math.PI * 2);
    c.stroke();

    // The two axes it is read against: up is what the channels share, across
    // is what they do not.
    c.strokeStyle = ink.zero;
    c.setLineDash([3, 4]);
    c.beginPath();
    c.moveTo(middle.x, middle.y - reach); c.lineTo(middle.x, middle.y + reach);
    c.moveTo(middle.x - reach, middle.y); c.lineTo(middle.x + reach, middle.y);
    c.stroke();
    c.setLineDash([]);

    const frames = this.player.playing ? this.player.frames() : null;
    if (frames) {
      let peak = 1e-4;
      for (let i = 0; i < frames.left.length; i += 1) {
        peak = Math.max(peak, Math.abs(frames.left[i]), Math.abs(frames.right[i]));
      }

      c.fillStyle = ink.blush;
      c.globalAlpha = 0.5;
      for (let i = 0; i < frames.left.length; i += 2) {
        const m = ((frames.left[i] + frames.right[i]) * 0.5) / peak;
        const s = ((frames.left[i] - frames.right[i]) * 0.5) / peak;
        c.fillRect(middle.x + s * reach - 0.75, middle.y - m * reach - 0.75, 1.5, 1.5);
      }
      c.globalAlpha = 1;
    }

    c.fillStyle = ink.soft;
    c.font = '9.5px system-ui, sans-serif';
    c.textAlign = 'center';
    c.fillText('mono', middle.x, 12);
    c.textAlign = 'left';
    c.fillText('side', 4, middle.y - 4);
    c.textAlign = 'left';
    c.fillText(this.player.playing ? 'the field' : 'the field · press play', 6, height - 6);
  }

  drawBands(ink) {
    const stage = readyCanvas(this.bands);
    if (!stage) return;
    const { c, width, height } = stage;

    c.font = '9.5px system-ui, sans-serif';
    c.strokeStyle = ink.grid;
    c.lineWidth = 1;
    c.textAlign = 'right';
    c.fillStyle = ink.soft;
    for (let db = 0; db > IMAGE_FLOOR; db -= 10) {
      const y = widthY(db, height);
      c.beginPath(); c.moveTo(0, y); c.lineTo(width, y); c.stroke();
      c.fillText(`${db}`, width - 4, y - 3);
    }

    if (!this.profile) return;
    const slot = width / IMAGE_BANDS.length;
    const bar = Math.min(26, slot * 0.5);

    IMAGE_BANDS.forEach((band, i) => {
      const read = this.profile.bands[band.id];
      const x = bandX(i, width);
      const top = widthY(read.width, height);
      const base = widthY(IMAGE_FLOOR, height);

      c.fillStyle = agreement(read.correlation, ink);
      c.globalAlpha = 0.75;
      c.fillRect(x - bar / 2, top, bar, Math.max(1, base - top));
      c.globalAlpha = 1;

      if (this.target) {
        const theirs = widthY(this.target.bands[band.id].width, height);
        c.strokeStyle = ink.sage;
        c.lineWidth = 2;
        c.setLineDash([5, 3]);
        c.beginPath();
        c.moveTo(x - bar * 0.8, theirs); c.lineTo(x + bar * 0.8, theirs);
        c.stroke();
        c.setLineDash([]);
      }

      c.fillStyle = ink.soft;
      c.textAlign = 'center';
      c.fillText(band.label, x, height - 4);
    });

    c.fillStyle = ink.soft;
    c.textAlign = 'left';
    c.fillText('width by band · green agrees, red argues', 6, 12);
  }

  writeReadout() {
    const trim = this.el.querySelector('#imageTrim');
    if (!trim) return;

    if (this.profile) {
      const { correlation, mono } = this.profile.whole;
      trim.textContent = `correlation ${correlation.toFixed(2)} · mono costs ${Math.abs(mono).toFixed(1)} dB`;
    } else {
      trim.textContent = '';
    }

    const parts = [
      `${Math.round(this.settings.low * 100)} / ${Math.round(this.settings.mid * 100)} / `
      + `${Math.round(this.settings.high * 100)}%`,
    ];
    if (this.profile) parts.push(`${this.profile.whole.width.toFixed(1)} dB wide`);
    if (this.settings.listen !== 'stereo') parts.push(`${this.settings.listen} only`);

    this.el.querySelector('#imageRead').textContent = parts.join(' · ');
  }

  /* ---------- what the round does to it ---------- */

  setTarget(target) {
    this.player.setTarget(target);
  }

  showTarget(target) {
    const sample = this.player.sample();
    if (sample) this.target = imageOf(sample.left, sample.right, sample.rate, target);
    this.draw();
  }

  nameOther(label) {
    this.el.querySelector('#imageOther').textContent = label;
  }

  lock() {
    this.interactive = false;
    this.el.querySelector('.image').classList.add('is-locked');
  }

  destroy() {
    clearTimeout(this.soon);
    cancelAnimationFrame(this.frame);
    window.removeEventListener('resize', this.resize);
    this.player.destroy();
  }
}
