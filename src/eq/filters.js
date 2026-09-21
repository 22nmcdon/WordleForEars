// The maths behind the curve.
//
// Every band is a biquad, from the Audio EQ Cookbook - the same filters Web
// Audio builds, with the same coefficients, so the curve drawn on screen is
// the curve the audio actually has rather than a picture of roughly what it is
// doing. A drawing that drifts from the sound is worse than no drawing: this
// one is checked against `BiquadFilterNode.getFrequencyResponse` to a
// hundredth of a decibel.

export const BAND_TYPES = {
  highpass: { label: 'High-pass', short: 'HP', gain: false, q: true },
  lowshelf: { label: 'Low shelf', short: 'LS', gain: true, q: false },
  peaking: { label: 'Peak', short: 'PK', gain: true, q: true },
  highshelf: { label: 'High shelf', short: 'HS', gain: true, q: false },
  lowpass: { label: 'Low-pass', short: 'LP', gain: false, q: true },
};

/** The channel strip, in the order an engineer reads it: low to high. */
export const STRIP = [
  { id: 'hp', type: 'highpass', frequency: 40, gain: 0, q: 0.7 },
  { id: 'ls', type: 'lowshelf', frequency: 120, gain: 0, q: 0.7 },
  { id: 'p1', type: 'peaking', frequency: 400, gain: 0, q: 1.4 },
  { id: 'p2', type: 'peaking', frequency: 2000, gain: 0, q: 1.4 },
  { id: 'hs', type: 'highshelf', frequency: 8000, gain: 0, q: 0.7 },
  { id: 'lp', type: 'lowpass', frequency: 18000, gain: 0, q: 0.7 },
];

export const newStrip = () => STRIP.map((band) => ({ ...band, on: false }));

/** The six coefficients of one band, normalised so a0 is 1. */
export function coefficients({ type, frequency, gain, q }, rate) {
  const w0 = (2 * Math.PI * frequency) / rate;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const A = 10 ** (gain / 40);

  let b0; let b1; let b2; let a0; let a1; let a2;

  if (type === 'peaking') {
    const alpha = sin / (2 * q);
    b0 = 1 + alpha * A; b1 = -2 * cos; b2 = 1 - alpha * A;
    a0 = 1 + alpha / A; a1 = -2 * cos; a2 = 1 - alpha / A;
  } else if (type === 'lowshelf' || type === 'highshelf') {
    // Shelves take their slope from S = 1, and ignore Q - which is what Web
    // Audio does with them, so the two agree.
    const alpha = (sin / 2) * Math.sqrt((A + 1 / A) * (1 / 1 - 1) + 2);
    const root = 2 * Math.sqrt(A) * alpha;

    if (type === 'lowshelf') {
      b0 = A * ((A + 1) - (A - 1) * cos + root);
      b1 = 2 * A * ((A - 1) - (A + 1) * cos);
      b2 = A * ((A + 1) - (A - 1) * cos - root);
      a0 = (A + 1) + (A - 1) * cos + root;
      a1 = -2 * ((A - 1) + (A + 1) * cos);
      a2 = (A + 1) + (A - 1) * cos - root;
    } else {
      b0 = A * ((A + 1) + (A - 1) * cos + root);
      b1 = -2 * A * ((A - 1) + (A + 1) * cos);
      b2 = A * ((A + 1) + (A - 1) * cos - root);
      a0 = (A + 1) - (A - 1) * cos + root;
      a1 = 2 * ((A - 1) - (A + 1) * cos);
      a2 = (A + 1) - (A - 1) * cos - root;
    }
  } else {
    // Web Audio reads Q as *decibels of resonance* on a low-pass or a
    // high-pass, where on a peak it is a plain Q. Use a plain Q here and the
    // drawn corner sits 3.7 dB away from the one you can hear - which is what
    // checking the curve against the node rather than against the textbook
    // turned up.
    const alpha = sin / (2 * 10 ** (q / 20));
    if (type === 'lowpass') {
      b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = (1 - cos) / 2;
    } else {
      b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = (1 + cos) / 2;
    }
    a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
  }

  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/** What one band does at one frequency, in decibels. */
export function bandGainAt(band, frequency, rate) {
  const { b0, b1, b2, a1, a2 } = coefficients(band, rate);
  const w = (2 * Math.PI * frequency) / rate;

  // H(e^jw), written out: cos and sin of one and two steps round the circle.
  const cos1 = Math.cos(w); const sin1 = Math.sin(w);
  const cos2 = Math.cos(2 * w); const sin2 = Math.sin(2 * w);

  const numRe = b0 + b1 * cos1 + b2 * cos2;
  const numIm = -(b1 * sin1 + b2 * sin2);
  const denRe = 1 + a1 * cos1 + a2 * cos2;
  const denIm = -(a1 * sin1 + a2 * sin2);

  const magnitude = Math.sqrt((numRe * numRe + numIm * numIm) / (denRe * denRe + denIm * denIm));
  return 20 * Math.log10(magnitude);
}

/** The whole strip's curve: what the bands come to, band by band, in dB. */
export function curveOf(bands, frequencies, rate = 48000) {
  const curve = new Float64Array(frequencies.length);

  for (const band of bands) {
    if (band.on === false) continue;
    // A band sitting at unity is not in the signal path in any audible sense.
    if (BAND_TYPES[band.type].gain && band.gain === 0) continue;

    for (let i = 0; i < frequencies.length; i += 1) {
      curve[i] += bandGainAt(band, frequencies[i], rate);
    }
  }

  return curve;
}

/** A frequency, written the way a plugin writes it: short on the face of the
    display, spelled out where there is room. */
export const shortHz = (hz) =>
  (hz >= 1000 ? `${(hz / 1000).toFixed(hz >= 10000 ? 0 : 1)}k` : String(Math.round(hz)));

export const writeHz = (hz) =>
  (hz >= 1000 ? `${(hz / 1000).toFixed(hz >= 10000 ? 0 : 1)} kHz` : `${Math.round(hz)} Hz`);

/** Frequencies spaced the way the ear hears them, and the way an EQ draws them. */
export function logFrequencies(count, low = 20, high = 20000) {
  return Array.from({ length: count }, (_, i) =>
    low * (high / low) ** (i / (count - 1)));
}
