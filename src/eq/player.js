import { averageLift, liftFrequencies, sectionsOf, MOST_SECTIONS } from './filters.js';
import { averageSpectrum } from './spectrum.js';

/**
 * The loop, running through two EQ chains you can flip between.
 *
 *   loop ─┬─ yours  ─ gain ─┐
 *         └─ theirs ─ gain ─┴─ analyser ─ out
 *
 * Both chains are always built and always fed; switching is a pair of gains,
 * which is how an A/B on a desk works - the two paths stay in step to the
 * sample, so what you hear when you flip is the processing and nothing else.
 *
 * A chain is a fixed run of biquads that are never added or removed, only
 * retuned - four per band, because the steepest cut on offer is a cascade of
 * four. A band that is off, and a section its slope does not need, are left
 * transparent rather than unplugged: rebuilding the graph under a running
 * loop clicks.
 */
export class EQPlayer {
  constructor(engine, strip) {
    this.engine = engine;
    this.strip = strip;
    this.source = null;
    this.hearing = 'mine';
    this.ready = false;
  }

  /** Builds the graph once the browser will let us make sound. */
  build() {
    if (this.ready) return;
    const ctx = this.engine.ensure();

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 4096;
    this.analyser.smoothingTimeConstant = this.ballistics ?? 0.72;
    this.analyser.connect(this.engine.out);

    this.mine = this.chain(ctx);
    this.theirs = this.chain(ctx);

    // One band, on its own, for listening to what lives there.
    this.soloFilter = ctx.createBiquadFilter();
    this.soloFilter.type = 'bandpass';
    this.soloFilter.frequency.value = 1000;
    this.soloFilter.Q.value = 2;
    this.soloGain = ctx.createGain();
    this.soloGain.gain.value = 0;
    this.soloFilter.connect(this.soloGain).connect(this.analyser);
    this.soloing = null;
    // The fault, when there is one, is in the sample rather than in the EQ -
    // so it sits ahead of both chains and is heard whichever way you flip.
    this.faultNode = ctx.createBiquadFilter();
    this.faultNode.type = 'peaking';
    this.faultNode.frequency.value = 1000;
    this.faultNode.gain.value = 0;
    this.faultNode.connect(this.mine.input);
    this.faultNode.connect(this.theirs.input);
    // Solo is taken before the EQ: the question it answers is what is in the
    // sample at that frequency, not what your bands have done to it.
    this.faultNode.connect(this.soloFilter);

    // Ready before the first flip, not after: `hear` does nothing until the
    // graph exists, so setting this afterwards left both chains at zero gain
    // and the whole plugin silent.
    this.ready = true;
    this.hear('mine');
  }

  chain(ctx) {
    // Four biquads per band, whether or not the band needs four. A cut at
    // 48 dB/oct is a cascade of four, and a graph that grew and shrank as the
    // slope changed would be a graph rebuilt under a running loop. The unused
    // ones are held out of circuit instead, which costs a multiply each and
    // nothing audible.
    const sections = this.strip.map(() => Array.from({ length: MOST_SECTIONS }, () => {
      const filter = ctx.createBiquadFilter();
      // Built out of circuit: a peak with no gain passes everything through.
      filter.type = 'peaking';
      filter.frequency.value = 1000;
      filter.Q.value = 1;
      filter.gain.value = 0;
      return filter;
    }));

    const filters = sections.flat();
    for (let i = 0; i < filters.length - 1; i += 1) filters[i].connect(filters[i + 1]);

    // Auto gain: whatever the curve adds overall, this takes back off, so the
    // two sides of the A/B are the same loudness and only the shape differs.
    const trim = ctx.createGain();
    trim.gain.value = 1;

    const gain = ctx.createGain();
    gain.gain.value = 0;
    filters[filters.length - 1].connect(trim).connect(gain).connect(this.analyser);

    return { input: filters[0], sections, trim, gain };
  }

  /**
   * Tunes one chain to a set of bands, without interrupting the sound.
   *
   * A band that is off becomes a peak with no gain, which is exactly nothing.
   * Parking its corner at the end of the range instead - which is the obvious
   * thing to do - is not nothing: a low-pass sitting at 18 kHz still takes
   * three quarters of a decibel off 12 kHz, and a high-pass at 40 takes a
   * decibel and a half off 60. The drawn curve simply leaves an off band out,
   * so the sound has to as well or the two stop agreeing at the edges.
   */
  static tune(chain, bands, at, rate, weights) {
    const lift = averageLift(bands, rate, weights);
    chain.trim.gain.setTargetAtTime(10 ** (-lift / 20), at, 0.02);

    bands.forEach((band, i) => {
      // What this band is actually made of - one biquad, or up to four of
      // them for a steep cut. Whatever is left over is parked.
      const sections = band.on === false ? [] : sectionsOf(band);

      chain.sections[i].forEach((filter, s) => {
        const section = sections[s];

        if (!section) {
          filter.type = 'peaking';
          filter.gain.setTargetAtTime(0, at, 0.01);
          return;
        }

        filter.type = section.type;
        filter.frequency.setTargetAtTime(section.frequency, at, 0.01);
        filter.Q.setTargetAtTime(section.q, at, 0.01);
        filter.gain.setTargetAtTime(section.gain ?? 0, at, 0.01);
      });
    });
  }

  setBands(bands) {
    if (!this.ready) return;
    this.bands = bands;
    EQPlayer.tune(this.mine, bands, this.engine.ctx.currentTime, this.engine.ctx.sampleRate, this.weights);
  }

  setTarget(bands) {
    if (!this.ready) return;
    this.targetBands = bands;
    EQPlayer.tune(this.theirs, bands, this.engine.ctx.currentTime, this.engine.ctx.sampleRate, this.weights);
  }

  /** What the source is made of, so auto gain knows what a move is worth. */
  measure(buffer) {
    this.weights = averageSpectrum(buffer, liftFrequencies());
    if (this.bands) this.setBands(this.bands);
    if (this.targetBands) this.setTarget(this.targetBands);
  }

  /**
   * Listen to one band on its own - the part of the sample it is working on.
   *
   * What "its part" means depends on the band: a peak is the region around it,
   * a shelf is everything past its corner, and a cut is the thing it is
   * throwing away, which is the most useful of the three to hear.
   */
  setSolo(band) {
    if (!this.ready) return;
    const at = this.engine.ctx.currentTime;
    this.soloing = band ? { ...band } : null;

    if (band) {
      const listen = {
        peaking: 'bandpass',
        lowshelf: 'lowpass',
        highshelf: 'highpass',
        highpass: 'lowpass',
        lowpass: 'highpass',
      }[band.type];

      this.soloFilter.type = listen;
      this.soloFilter.frequency.setTargetAtTime(band.frequency, at, 0.01);
      this.soloFilter.Q.setTargetAtTime(listen === 'bandpass' ? Math.max(0.7, band.q) : 0.7, at, 0.01);
    }

    this.soloGain.gain.setTargetAtTime(band ? 1 : 0, at, 0.01);
    this.mine.gain.gain.setTargetAtTime(band ? 0 : (this.hearing === 'mine' ? 1 : 0), at, 0.01);
    this.theirs.gain.gain.setTargetAtTime(band ? 0 : (this.hearing === 'mine' ? 0 : 1), at, 0.01);
  }

  /** The fault baked into the sample, or nothing. */
  setFault(fault) {
    if (!this.ready) return;
    const at = this.engine.ctx.currentTime;
    this.faultNode.frequency.setTargetAtTime(fault ? fault.frequency : 1000, at, 0.01);
    this.faultNode.Q.setTargetAtTime(fault ? fault.q : 1, at, 0.01);
    this.faultNode.gain.setTargetAtTime(fault ? fault.gain : 0, at, 0.01);
  }

  /** Flip between your EQ and theirs, quickly enough to compare. */
  hear(which) {
    this.hearing = which;
    if (!this.ready || this.soloing) return;
    const at = this.engine.ctx.currentTime;
    this.mine.gain.gain.setTargetAtTime(which === 'mine' ? 1 : 0, at, 0.008);
    this.theirs.gain.gain.setTargetAtTime(which === 'mine' ? 0 : 1, at, 0.008);
  }

  /** Something the player brought themselves, decoded and kept for the session. */
  async load(file) {
    const ctx = this.engine.ensure();
    this.yours = await ctx.decodeAudioData(await file.arrayBuffer());
    return this.yours;
  }

  async play(kind) {
    this.build();
    const buffer = kind === 'yours' ? this.yours : await this.engine.renderLoop(kind);
    if (!buffer) return false;

    this.measure(buffer);
    this.stop();

    const source = this.engine.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(this.faultNode);
    source.start();
    this.source = source;
    return true;
  }

  stop() {
    if (!this.source) return;
    try { this.source.stop(); } catch { /* already stopped */ }
    this.source.disconnect();
    this.source = null;
  }

  get playing() {
    return this.source !== null;
  }

  /**
   * How fast the analyser follows what it is given.
   *
   * Fast catches the transients, slow shows the balance, and they are two
   * different questions about the same sound - which is why every analyser
   * ever built has this switch on it.
   */
  setBallistics(value) {
    this.ballistics = value;
    if (this.analyser) this.analyser.smoothingTimeConstant = value;
  }

  /** The spectrum, in dB, for drawing behind the curve. */
  spectrum() {
    if (!this.ready) return null;
    const bins = new Float32Array(this.analyser.frequencyBinCount);
    this.analyser.getFloatFrequencyData(bins);
    return bins;
  }
}
