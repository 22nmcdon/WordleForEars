import { BAND_TYPES, bandGainAt, contributionOf, curveOf, logFrequencies, shortHz } from './filters.js';
import { EQPlayer } from './player.js';

const LOW = 20;
const HIGH = 20000;
const RANGE = 18; // decibels shown above and below the line
const MOST_RESONANCE = 15;

const toX = (hz, width) => (Math.log2(hz / LOW) / Math.log2(HIGH / LOW)) * width;
const toHz = (x, width) => LOW * (HIGH / LOW) ** (x / width);
const toY = (db, height) => height / 2 - (db / RANGE) * (height / 2);
const toDb = (y, height) => ((height / 2 - y) / (height / 2)) * RANGE;

const GRID_HZ = [30, 50, 100, 200, 300, 500, 1000, 2000, 3000, 5000, 10000, 20000];
const LABEL_HZ = [50, 100, 500, 1000, 5000, 10000];
const GRID_DB = [-12, -6, 0, 6, 12];

/** The colours the curve is drawn in, read off the page so the mode follows it. */
function palette(el) {
  const style = getComputedStyle(el);
  const read = (name) => style.getPropertyValue(name).trim();
  return {
    ink: read('--charcoal'),
    line: read('--line'),
    // On the display, which is charcoal, rather than on the page.
    soft: 'rgba(250, 246, 240, 0.55)',
    grid: 'rgba(250, 246, 240, 0.14)',
    zero: 'rgba(250, 246, 240, 0.34)',
    accent: read('--blush-deep'),
    blush: read('--blush'),
    paper: read('--paper'),
    sage: read('--sage'),
    gold: read('--gold'),
  };
}

/**
 * The EQ itself: a curve you drag, over a spectrum, with the loop running.
 *
 * Everything here is the plugin a producer already knows how to use - the
 * frequencies laid out the way the ear hears them, a node per band, the
 * numbers underneath. What it is not is a quiz about the plugin.
 */
export class EQPlugin {
  constructor(el, { engine, bands, onChange, source = 'mix' }) {
    this.el = el;
    this.engine = engine;
    this.bands = bands;
    this.onChange = onChange;
    this.source = source;
    this.selected = this.bands.findIndex((band) => band.type === 'peaking');
    this.target = null; // drawn only once the round is over
    this.player = new EQPlayer(engine, this.bands);
    this.interactive = true;

    this.build();
    this.draw();
  }

  /* ---------- the furniture ---------- */

  build() {
    this.el.innerHTML = `
      <div class="eq">
        <div class="eq-head">
          <span class="eq-name">Channel EQ</span>
          <span class="eq-read" id="eqRead"></span>
        </div>
        <div class="eq-display">
          <canvas class="eq-canvas" id="eqCanvas"></canvas>
        </div>
        <div class="eq-bands" id="eqBands"></div>
        <div class="eq-controls" id="eqControls"></div>
        <div class="eq-transport">
          <button class="play-btn" type="button" data-eq="play">Play</button>
          <div class="eq-ab" role="group" aria-label="What you are hearing">
            <button class="ab-btn is-on" type="button" data-hear="mine">Yours</button>
            <button class="ab-btn" type="button" data-hear="theirs" id="eqOther">Target</button>
          </div>
          <label class="field">
            <span class="field-label">Sample</span>
            <select id="eqSource">
              <option value="mix">Full mix</option>
              <option value="drums">Drums</option>
              <option value="instrument">Keys</option>
              <option value="noise">Pink noise</option>
            </select>
          </label>
          <button class="link-btn" type="button" data-eq="flatten">Flatten</button>
        </div>
      </div>`;

    this.canvas = this.el.querySelector('#eqCanvas');
    this.readout = this.el.querySelector('#eqRead');
    this.el.querySelector('#eqSource').value = this.source;

    this.buildBandButtons();
    this.buildControls();
    this.wire();
  }

  buildBandButtons() {
    this.el.querySelector('#eqBands').innerHTML = this.bands.map((band, i) => `
      <button class="band-btn" type="button" data-band="${i}"
              aria-pressed="${band.on ? 'true' : 'false'}">
        <span class="band-short">${BAND_TYPES[band.type].short}</span>
        <span class="band-hz">${shortHz(band.frequency)}</span>
      </button>`).join('');
  }

  buildControls() {
    const band = this.bands[this.selected];
    const type = BAND_TYPES[band.type];

    this.el.querySelector('#eqControls').innerHTML = `
      <div class="knob">
        <label class="knob-name" for="eqFreq">Frequency</label>
        <output class="knob-value" id="eqFreqValue">${shortHz(band.frequency)} Hz</output>
        <input class="knob-dial" type="range" id="eqFreq" min="${Math.log2(LOW)}" max="${Math.log2(HIGH)}"
               step="0.01" value="${Math.log2(band.frequency)}" aria-label="Frequency">
      </div>
      <div class="knob" ${type.gain ? '' : 'hidden'}>
        <label class="knob-name" for="eqGain">Gain</label>
        <output class="knob-value" id="eqGainValue">${band.gain.toFixed(1)} dB</output>
        <input class="knob-dial" type="range" id="eqGain" min="-${RANGE}" max="${RANGE}" step="0.1"
               value="${band.gain}" aria-label="Gain">
      </div>
      <div class="knob" ${type.q ? '' : 'hidden'}>
        <label class="knob-name" for="eqQ">Q</label>
        <output class="knob-value" id="eqQValue">${band.q.toFixed(2)}</output>
        <input class="knob-dial" type="range" id="eqQ" min="${Math.log2(0.4)}" max="${Math.log2(12)}"
               step="0.01" value="${Math.log2(Math.max(0.4, band.q))}" aria-label="Q">
      </div>
      <div class="knob" ${type.resonance ? '' : 'hidden'}>
        <label class="knob-name" for="eqRes">Resonance</label>
        <output class="knob-value" id="eqResValue">${band.q > 0 ? '+' : ''}${band.q.toFixed(1)} dB</output>
        <input class="knob-dial" type="range" id="eqRes" min="-${RANGE}" max="${MOST_RESONANCE}" step="0.1"
               value="${band.q}" aria-label="Resonance">
      </div>`;
  }

  /* ---------- working it ---------- */

  wire() {
    const bands = this.el.querySelector('#eqBands');
    bands.addEventListener('click', (e) => {
      const button = e.target.closest('[data-band]');
      if (!button || !this.interactive) return;

      const index = Number(button.dataset.band);
      // The band you are already on toggles; any other one is selected.
      if (index === this.selected) this.bands[index].on = !this.bands[index].on;
      else this.selected = index;

      this.changed();
    });

    this.el.querySelector('#eqControls').addEventListener('input', (e) => {
      if (!this.interactive) return;
      const band = this.bands[this.selected];

      if (e.target.id === 'eqFreq') band.frequency = 2 ** Number(e.target.value);
      if (e.target.id === 'eqGain') band.gain = Number(e.target.value);
      if (e.target.id === 'eqQ') band.q = 2 ** Number(e.target.value);
      if (e.target.id === 'eqRes') band.q = Number(e.target.value);
      band.on = true;
      this.changed({ keepControls: true });
    });

    this.canvas.addEventListener('pointerdown', (e) => this.grab(e));
    this.canvas.addEventListener('pointermove', (e) => this.drag(e));
    this.canvas.addEventListener('pointerup', (e) => this.drop(e));
    this.canvas.addEventListener('pointercancel', (e) => this.drop(e));
    this.canvas.addEventListener('wheel', (e) => this.wheel(e), { passive: false });

    this.el.addEventListener('click', (e) => {
      const hear = e.target.closest('[data-hear]');
      if (hear) {
        this.player.hear(hear.dataset.hear);
        for (const button of this.el.querySelectorAll('[data-hear]')) {
          button.classList.toggle('is-on', button === hear);
        }
        return;
      }

      const action = e.target.closest('[data-eq]');
      if (!action) return;
      if (action.dataset.eq === 'play') this.toggle();
      if (action.dataset.eq === 'flatten' && this.interactive) {
        for (const band of this.bands) { band.gain = 0; band.on = false; }
        this.changed();
      }
    });

    this.el.querySelector('#eqSource').addEventListener('change', (e) => {
      this.source = e.target.value;
      if (this.player.playing) this.player.play(this.source);
    });

    this.resize = () => this.draw();
    window.addEventListener('resize', this.resize);
  }

  /** Where the whole curve sits at one frequency - where a handle belongs. */
  curveAt(hz) {
    return curveOf(this.bands, [hz], this.rate())[0];
  }

  rate() {
    return this.engine.ctx?.sampleRate ?? 48000;
  }

  /** Which node the pointer is on, if any. */
  nodeAt(x, y) {
    const { width, height } = this.size();
    return this.bands.findIndex((band) => {
      const bandX = toX(band.frequency, width);
      const bandY = toY(this.curveAt(band.frequency), height);
      return Math.hypot(bandX - x, bandY - y) < 22;
    });
  }

  grab(e) {
    if (!this.interactive) return;
    const { x, y } = this.at(e);
    const found = this.nodeAt(x, y);
    if (found === -1) return;

    this.selected = found;
    this.dragging = found;
    this.bands[found].on = true;
    this.canvas.setPointerCapture(e.pointerId);
    this.changed();
  }

  drag(e) {
    const { x, y } = this.at(e);

    if (this.dragging === undefined || this.dragging === null) {
      this.canvas.style.cursor = this.nodeAt(x, y) === -1 ? 'default' : 'grab';
      return;
    }

    const { width, height } = this.size();
    const band = this.bands[this.dragging];
    band.frequency = Math.min(HIGH, Math.max(LOW, toHz(x, width)));
    this.pull(band, toDb(y, height));
    this.changed();
  }

  drop(e) {
    if (this.dragging === undefined || this.dragging === null) return;
    this.dragging = null;
    try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* gone already */ }
  }

  /**
   * Drags the curve to the pointer by moving whatever that band controls.
   *
   * Solved rather than assigned, because the handle is on the composite curve:
   * what has to land under the pointer is the sum of every band at this
   * frequency, so the one being dragged takes the difference. A shelf takes
   * twice it, since it is only halfway up at its corner, and a cut takes it as
   * resonance - which is the fix for dragging a high-pass up and down like
   * everything else, instead of reaching for the wheel.
   */
  pull(band, wanted) {
    const type = BAND_TYPES[band.type];
    const others = this.curveAt(band.frequency) - contributionOf(band, this.rate());
    const mine = wanted - others;

    if (type.gain) {
      band.gain = Math.max(-RANGE, Math.min(RANGE, mine / type.contributes));
    } else if (type.resonance) {
      band.q = Math.max(-RANGE, Math.min(MOST_RESONANCE, mine));
    }
  }

  /** The wheel is the Q of a peak, which is what it does in every EQ worth
      using. A cut has no Q to speak of - its handle is the resonance. */
  wheel(e) {
    if (!this.interactive) return;
    const { x, y } = this.at(e);
    const found = this.nodeAt(x, y);
    if (found === -1) return;

    e.preventDefault();
    const band = this.bands[found];
    if (!BAND_TYPES[band.type].q) return;

    this.selected = found;
    band.q = Math.min(12, Math.max(0.4, band.q * (e.deltaY > 0 ? 1.12 : 1 / 1.12)));
    this.changed();
  }

  at(e) {
    const box = this.canvas.getBoundingClientRect();
    return { x: e.clientX - box.left, y: e.clientY - box.top };
  }

  changed({ keepControls = false } = {}) {
    this.player.setBands(this.bands);
    this.buildBandButtons();
    if (!keepControls) this.buildControls();
    else this.syncControls();
    this.draw();
    this.onChange?.(this.bands);
  }

  syncControls() {
    const band = this.bands[this.selected];
    const set = (id, value) => {
      const node = this.el.querySelector(id);
      if (node) node.textContent = value;
    };
    set('#eqFreqValue', `${shortHz(band.frequency)} Hz`);
    set('#eqGainValue', `${band.gain.toFixed(1)} dB`);
    set('#eqQValue', band.q.toFixed(2));
    set('#eqResValue', `${band.q > 0 ? '+' : ''}${band.q.toFixed(1)} dB`);
  }

  async toggle() {
    const button = this.el.querySelector('[data-eq="play"]');
    if (this.player.playing) {
      this.player.stop();
      button.textContent = 'Play';
      cancelAnimationFrame(this.frame);
      this.frame = null;
      this.draw();
      return;
    }

    await this.player.play(this.source);
    this.player.setBands(this.bands);
    button.textContent = 'Stop';
    const tick = () => {
      this.draw();
      this.frame = requestAnimationFrame(tick);
    };
    tick();
  }

  /* ---------- drawing ---------- */

  size() {
    const box = this.canvas.getBoundingClientRect();
    return { width: box.width, height: box.height };
  }

  draw() {
    const { width, height } = this.size();
    if (!width || !height) return;

    const dpr = window.devicePixelRatio || 1;
    if (this.canvas.width !== Math.round(width * dpr)) {
      this.canvas.width = Math.round(width * dpr);
      this.canvas.height = Math.round(height * dpr);
    }

    const ink = palette(this.el);
    const c = this.canvas.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, width, height);

    this.drawGrid(c, width, height, ink);
    this.drawSpectrum(c, width, height, ink);
    if (this.target) this.drawCurve(c, width, height, this.target, ink.sage, 2, [6, 4]);
    this.drawCurve(c, width, height, this.bands, ink.accent, 2.5);
    this.drawNodes(c, width, height, ink);
    this.writeReadout();
  }

  drawGrid(c, width, height, ink) {
    c.lineWidth = 1;
    c.font = '10px system-ui, sans-serif';
    c.textAlign = 'center';

    for (const hz of GRID_HZ) {
      const x = toX(hz, width);
      c.strokeStyle = ink.grid;
      c.beginPath();
      c.moveTo(x, 0);
      c.lineTo(x, height);
      c.stroke();

      if (LABEL_HZ.includes(hz)) {
        c.fillStyle = ink.soft;
        c.fillText(shortHz(hz), x, height - 5);
      }
    }

    c.textAlign = 'left';
    for (const db of GRID_DB) {
      const y = toY(db, height);
      c.strokeStyle = db === 0 ? ink.zero : ink.grid;
      c.beginPath();
      c.moveTo(0, y);
      c.lineTo(width, y);
      c.stroke();
      if (db !== 0) {
        c.fillStyle = ink.soft;
        c.fillText(`${db > 0 ? '+' : ''}${db}`, 4, y - 3);
      }
    }
  }

  /** What is actually coming out, behind the curve that is shaping it. */
  drawSpectrum(c, width, height, ink) {
    const bins = this.player.spectrum();
    if (!bins) return;

    const rate = this.engine.ctx.sampleRate;
    c.beginPath();
    c.moveTo(0, height);

    for (let x = 0; x <= width; x += 2) {
      const hz = toHz(x, width);
      const bin = Math.round((hz / (rate / 2)) * bins.length);
      const db = bins[Math.min(bins.length - 1, bin)];
      // -100 dB at the floor of the display, -20 at the top of it.
      const level = Math.max(0, Math.min(1, (db + 100) / 80));
      c.lineTo(x, height - level * height * 0.92);
    }

    c.lineTo(width, height);
    c.closePath();
    c.fillStyle = ink.blush;
    c.globalAlpha = 0.22;
    c.fill();
    c.globalAlpha = 1;
  }

  drawCurve(c, width, height, bands, colour, weight, dash = []) {
    const points = Math.max(160, Math.round(width / 2));
    const frequencies = logFrequencies(points, LOW, HIGH);
    const curve = curveOf(bands, frequencies, this.rate());

    c.beginPath();
    for (let i = 0; i < points; i += 1) {
      const x = (i / (points - 1)) * width;
      const y = toY(curve[i], height);
      if (i === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.setLineDash(dash);
    c.strokeStyle = colour;
    c.lineWidth = weight;
    c.lineJoin = 'round';
    c.stroke();
    c.setLineDash([]);
  }

  drawNodes(c, width, height, ink) {
    this.bands.forEach((band, i) => {
      const type = BAND_TYPES[band.type];
      const x = toX(band.frequency, width);
      const y = toY(this.curveAt(band.frequency), height);
      const chosen = i === this.selected;

      c.beginPath();
      c.arc(x, y, chosen ? 11 : 9, 0, Math.PI * 2);
      c.fillStyle = band.on ? ink.accent : ink.paper;
      c.strokeStyle = band.on ? ink.accent : ink.soft;
      c.lineWidth = chosen ? 3 : 1.5;
      c.fill();
      c.stroke();

      c.fillStyle = band.on ? ink.paper : ink.soft;
      c.font = '600 9px system-ui, sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(type.short, x, y + 0.5);
      c.textBaseline = 'alphabetic';
    });
  }

  writeReadout() {
    const band = this.bands[this.selected];
    const type = BAND_TYPES[band.type];
    const parts = [type.label, `${shortHz(band.frequency)} Hz`];
    if (type.gain) parts.push(`${band.gain > 0 ? '+' : ''}${band.gain.toFixed(1)} dB`);
    if (type.q) parts.push(`Q ${band.q.toFixed(2)}`);
    if (type.resonance) parts.push(`res ${band.q > 0 ? '+' : ''}${band.q.toFixed(1)} dB`);
    this.readout.textContent = band.on ? parts.join(' · ') : `${type.label} · off`;
  }

  /* ---------- what the round does to it ---------- */

  showTarget(bands) {
    this.target = bands;
    this.draw();
  }

  setFault(fault) {
    this.player.setFault(fault);
  }

  setTarget(bands) {
    this.player.setTarget(bands);
  }

  /** The other side of the A/B, named for what it actually is. */
  nameOther(label) {
    this.el.querySelector('#eqOther').textContent = label;
  }

  lock() {
    this.interactive = false;
    this.el.querySelector('.eq').classList.add('is-locked');
  }

  destroy() {
    this.player.stop();
    cancelAnimationFrame(this.frame);
    window.removeEventListener('resize', this.resize);
  }
}
