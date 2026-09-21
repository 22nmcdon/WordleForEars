// A small Web Audio piano: additive partials with a plucked-decay envelope.
// Real-time synthesis keeps the POC dependency-free and zero-asset.

const PARTIALS = [
  { ratio: 1, gain: 1.0, type: 'sine' },
  { ratio: 2, gain: 0.32, type: 'sine' },
  { ratio: 3, gain: 0.14, type: 'sine' },
  { ratio: 4, gain: 0.07, type: 'triangle' },
  { ratio: 6, gain: 0.03, type: 'sine' },
];

export function midiToFreq(midi) {
  return 440 * 2 ** ((midi - 69) / 12);
}

export class PianoEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.playing = [];
  }

  /** Browsers only allow audio after a gesture, so this runs on first play. */
  ensure() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.7;

      // A touch of body so the tone is not a bare sine stack.
      const shelf = this.ctx.createBiquadFilter();
      shelf.type = 'lowshelf';
      shelf.frequency.value = 220;
      shelf.gain.value = 3;

      this.master.connect(shelf).connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  stop() {
    const now = this.ctx ? this.ctx.currentTime : 0;
    for (const node of this.playing) {
      try {
        node.gain.gain.cancelScheduledValues(now);
        node.gain.gain.setTargetAtTime(0, now, 0.02);
        node.osc.stop(now + 0.2);
      } catch {
        /* already stopped */
      }
    }
    this.playing = [];
  }

  noteOn(midi, at, duration, velocity = 1) {
    const ctx = this.ctx;
    const freq = midiToFreq(midi);
    // Higher notes decay faster, as on a real piano.
    const decay = Math.max(0.9, duration * (midi > 72 ? 0.8 : 1.15));

    for (const partial of PARTIALS) {
      const osc = ctx.createOscillator();
      osc.type = partial.type;
      osc.frequency.value = freq * partial.ratio;

      const gain = ctx.createGain();
      const peak = 0.16 * partial.gain * velocity;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(peak, at + 0.008);
      gain.gain.exponentialRampToValueAtTime(peak * 0.28, at + 0.28);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + decay);

      osc.connect(gain).connect(this.master);
      osc.start(at);
      osc.stop(at + decay + 0.05);
      this.playing.push({ osc, gain });
      osc.onended = () => {
        this.playing = this.playing.filter((n) => n.osc !== osc);
      };
    }
  }

  /** Play notes together (block) or one after another (arpeggio). */
  play(notes, { arpeggio = false, duration = 2.4 } = {}) {
    this.ensure();
    this.stop();
    const start = this.ctx.currentTime + 0.06;
    const step = arpeggio ? 0.34 : 0.012; // tiny spread keeps a block chord human
    notes.forEach((midi, i) => {
      const at = start + i * step;
      const length = arpeggio ? duration * 0.7 : duration;
      this.noteOn(midi, at, length, i === 0 ? 1 : 0.85);
    });
  }

  /** A short reference tone so players can orient themselves. */
  playReference(midi = 60) {
    this.ensure();
    this.stop();
    this.noteOn(midi, this.ctx.currentTime + 0.05, 1.2);
  }
}
