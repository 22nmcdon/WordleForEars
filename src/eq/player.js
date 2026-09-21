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
 * A chain is six biquads in series that are never added or removed, only
 * retuned. A band that is off is left transparent rather than unplugged,
 * because rebuilding the graph under a running loop clicks.
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
    this.analyser.smoothingTimeConstant = 0.72;
    this.analyser.connect(this.engine.out);

    this.mine = this.chain(ctx);
    this.theirs = this.chain(ctx);
    // The fault, when there is one, is in the sample rather than in the EQ -
    // so it sits ahead of both chains and is heard whichever way you flip.
    this.faultNode = ctx.createBiquadFilter();
    this.faultNode.type = 'peaking';
    this.faultNode.frequency.value = 1000;
    this.faultNode.gain.value = 0;
    this.faultNode.connect(this.mine.input);
    this.faultNode.connect(this.theirs.input);

    // Ready before the first flip, not after: `hear` does nothing until the
    // graph exists, so setting this afterwards left both chains at zero gain
    // and the whole plugin silent.
    this.ready = true;
    this.hear('mine');
  }

  chain(ctx) {
    const filters = this.strip.map((band) => {
      const filter = ctx.createBiquadFilter();
      // Built out of circuit: a peak with no gain passes everything through.
      filter.type = 'peaking';
      filter.frequency.value = band.frequency;
      filter.Q.value = band.q;
      filter.gain.value = 0;
      return filter;
    });

    for (let i = 0; i < filters.length - 1; i += 1) filters[i].connect(filters[i + 1]);

    const gain = ctx.createGain();
    gain.gain.value = 0;
    filters[filters.length - 1].connect(gain).connect(this.analyser);

    return { input: filters[0], filters, gain };
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
  static tune(chain, bands, at) {
    bands.forEach((band, i) => {
      const filter = chain.filters[i];
      const off = band.on === false;

      filter.type = off ? 'peaking' : band.type;
      filter.frequency.setTargetAtTime(band.frequency, at, 0.01);
      filter.Q.setTargetAtTime(band.q, at, 0.01);
      filter.gain.setTargetAtTime(off ? 0 : band.gain, at, 0.01);
    });
  }

  setBands(bands) {
    if (!this.ready) return;
    EQPlayer.tune(this.mine, bands, this.engine.ctx.currentTime);
  }

  setTarget(bands) {
    if (!this.ready) return;
    EQPlayer.tune(this.theirs, bands, this.engine.ctx.currentTime);
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
    if (!this.ready) return;
    const at = this.engine.ctx.currentTime;
    this.mine.gain.gain.setTargetAtTime(which === 'mine' ? 1 : 0, at, 0.008);
    this.theirs.gain.gain.setTargetAtTime(which === 'mine' ? 0 : 1, at, 0.008);
  }

  async play(kind) {
    this.build();
    const buffer = await this.engine.renderLoop(kind);
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

  /** The spectrum, in dB, for drawing behind the curve. */
  spectrum() {
    if (!this.ready) return null;
    const bins = new Float32Array(this.analyser.frequencyBinCount);
    this.analyser.getFloatFrequencyData(bins);
    return bins;
  }
}
