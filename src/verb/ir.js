import { makeBiquad, setBiquad, runBiquad } from '../comp/dsp.js';
import { mulberry32 } from '../random.js';

// A room, as an impulse response.
//
// The reverb here is convolution: the settings make an impulse response and
// the loop is convolved with it. That is more work than an algorithmic reverb
// and it buys the thing this whole app is built on - the picture on screen is
// not a drawing of what the reverb is doing, it is the reverb. The same array
// is convolved, measured, displayed and marked, so there is nothing for the
// three of them to disagree about.
//
// It also means the numbers are real numbers. A decay time is measured off
// the response the way an acoustician measures a hall, rather than being
// whatever the feedback coefficient happened to produce.

/** Every knob, and where it starts. */
export const VERB_DEFAULTS = {
  preDelay: 20,      // ms of silence before the room answers
  decay: 1.8,        // RT60, in seconds
  size: 18,          // metres - how far away the first walls are
  damping: 0.55,     // how much shorter the highs decay: 1 is not at all
  early: 0.35,       // the level of the early reflections against the tail
  lowCut: 20,        // Hz, on the way in
  highCut: 20000,    // Hz, on the way in
  mix: 0.3,          // 0 is dry, 1 is nothing but room
};

/** The bands a decay is read in - the three an engineer talks about. */
export const VERB_BANDS = [
  { id: 'low', label: 'Low', low: 60, high: 400 },
  { id: 'mid', label: 'Mid', low: 400, high: 3000 },
  { id: 'high', label: 'High', low: 3000, high: 12000 },
];

/**
 * Where the tail is split into something that damps and something that does
 * not, and how sharply.
 *
 * Sharply matters. A first-order split left a fifth of the slow band's energy
 * sitting up at 4 kHz, so once the fast part had died the slow part's leakage
 * took over and a room set to decay five times faster up top measured only
 * one and a half times faster. Two cascaded Butterworths - a Linkwitz-Riley
 * crossover, which is what a speaker uses and sums flat - put the bands
 * thirty decibels apart where the reading is taken.
 */
const DAMP_CROSSOVER = 1200;
const CROSSOVER_POLES = 2;

/** The floor a decay is read down to. Below this there is nothing to hear. */
export const DECAY_FLOOR = -60;

/**
 * Early reflections, as fractions of the time it takes sound to cross the
 * room and come back.
 *
 * A fixed pattern rather than a random one, so that a room of a given size is
 * the same room every time it is built - on every machine, for everybody's
 * daily. The spacing is uneven because a rectangular room's first reflections
 * are uneven; an even comb sounds like a comb.
 */
const TAPS = [0.21, 0.34, 0.41, 0.58, 0.63, 0.79, 0.87, 1.0, 1.19, 1.31];

/** How fast sound travels, in metres a second. */
const SPEED = 343;

const sq = (x) => x * x;

/** The longest room on offer, plus room for it to finish. */
export const MOST_DECAY = 8;
const CACHE_SECONDS = MOST_DECAY * 1.1 + 0.5;

/**
 * The noise the rooms are all made from, split once and kept.
 *
 * Every room is the same noise under a different envelope - the filtering
 * that splits it into something that damps and something that does not
 * depends on neither the decay nor the damping, only on the crossover. Doing
 * it per room meant four biquads a sample a channel, which came to a sixth of
 * a second to build an eight second hall: a knob you could turn and then wait
 * for. Split once, building a room is a multiply and an add.
 *
 * It also means a room is the same room every time it is asked for, on every
 * machine, which is what a shared daily needs.
 */
const splits = new Map();

function noiseBands(rate) {
  const held = splits.get(rate);
  if (held) return held;

  const length = Math.ceil(rate * CACHE_SECONDS);
  const noise = mulberry32(0x5eed1e);
  const bands = { low: [], high: [], length };

  for (let c = 0; c < 2; c += 1) {
    const low = new Float32Array(length);
    const high = new Float32Array(length);

    const lows = Array.from({ length: CROSSOVER_POLES },
      () => setBiquad(makeBiquad(), 'lowpass', DAMP_CROSSOVER, rate));
    const highs = Array.from({ length: CROSSOVER_POLES },
      () => setBiquad(makeBiquad(), 'highpass', DAMP_CROSSOVER, rate));

    for (let i = 0; i < length; i += 1) {
      const white = noise() * 2 - 1;
      let l = white;
      let h = white;
      for (const stage of lows) l = runBiquad(stage, l);
      for (const stage of highs) h = runBiquad(stage, h);
      low[i] = l;
      high[i] = h;
    }

    bands.low.push(low);
    bands.high.push(high);
  }

  splits.set(rate, bands);
  return bands;
}

/**
 * The room, as samples.
 *
 * Two channels, from two uncorrelated noises: a reverb in mono is a filter,
 * and what makes a room sound like a room is that the two ears are not
 * hearing the same thing.
 *
 * The tail is built in two bands. The low one decays over the time on the
 * knob, the high one over a fraction of it, and that fraction is the damping
 * control - which is how a real room behaves and, more to the point, how a
 * decay time is actually quoted: per band, because there is no such thing as
 * one decay time for a room with soft furnishings in it.
 */
export function makeImpulse(rate, params = {}) {
  const { preDelay, decay, size, damping, early, lowCut, highCut } = { ...VERB_DEFAULTS, ...params };

  const pre = Math.round((preDelay / 1000) * rate);
  const tailFor = Math.max(decay, decay * damping, (2 * size) / SPEED * 1.6);
  const length = Math.max(rate * 0.05, Math.ceil(pre + rate * (tailFor * 1.08 + 0.02)));
  const channels = [new Float32Array(length), new Float32Array(length)];

  const bands = noiseBands(rate);
  const lowRate = -3 / Math.max(0.05, decay);
  const highRate = -3 / Math.max(0.05, decay * damping);

  // How far apart the walls are, in time: the reflection off the far wall and
  // back is the whole of what tells you how big a place is.
  const across = (2 * size) / SPEED;

  // The diffuse tail arrives, it does not begin. In a real room the sound has
  // to bounce a few times before it is a wash, and until then what you hear
  // is the walls one at a time. Starting the tail at full level buried every
  // early reflection underneath it, which meant the size control changed the
  // numbers and nothing anybody could hear.
  const build = Math.max(0.004, Math.min(across * 1.4, decay * 0.35));

  // The envelopes are exponential, so they are stepped rather than evaluated:
  // one multiply a sample instead of a call to pow. Over eight seconds that
  // is a million and a half of them, and it was most of the time it took to
  // build a hall.
  const lowStep = 10 ** (lowRate / rate);
  const highStep = 10 ** (highRate / rate);
  const buildSamples = Math.max(1, build * rate);

  for (let c = 0; c < channels.length; c += 1) {
    const out = channels[c];
    const low = bands.low[c];
    const high = bands.high[c];
    const last = Math.min(length, pre + bands.length);

    // 10^(-3t/RT) is -60 dB at t = RT, which is what RT60 means.
    let lowEnv = 1;
    let highEnv = 1;

    for (let i = pre; i < last; i += 1) {
      const j = i - pre;
      const swell = j < buildSamples ? j / buildSamples : 1;
      out[i] = swell * (low[j] * lowEnv + high[j] * highEnv);
      lowEnv *= lowStep;
      highEnv *= highStep;
    }
  }

  // The early reflections: the walls, one at a time, before the room turns to
  // a wash.
  //
  // Set by energy rather than by amplitude, and the difference is the whole
  // control. A reflection is one sample and the tail is a hundred thousand of
  // them, so a tap at the tail's own amplitude is a ten-thousandth of the
  // room and changes neither the sound nor any reading of it - the first
  // version of this had an early-late control that measured as nothing at
  // all. A real reflection towers over the diffuse tail, because it is a
  // whole copy of the sound arriving at once. So `early` is the share of the
  // room's energy that arrives as walls, and the taps are scaled to it.
  const tailEnergy = channels.reduce((sum, out) => {
    let band = 0;
    for (let i = 0; i < length; i += 1) band += sq(out[i]);
    return sum + band;
  }, 0);

  const walls = [];
  for (let c = 0; c < channels.length; c += 1) {
    TAPS.forEach((tap, k) => {
      // A little apart in the two ears, or the reflections arrive as one
      // click in the middle of your head.
      const skew = 1 + (c === 0 ? -1 : 1) * 0.06 * ((k % 3) - 1);
      const at = pre + Math.round(across * tap * skew * rate);
      if (at >= length) return;

      const level = (10 ** (lowRate * ((at - pre) / rate))) * (0.85 ** k);
      walls.push({ c, at, level: (k % 2 ? -1 : 1) * level });
    });
  }

  const wallEnergy = walls.reduce((sum, wall) => sum + sq(wall.level), 0);
  const share = Math.min(0.85, Math.max(0, early));
  if (wallEnergy > 0 && tailEnergy > 0 && share > 0) {
    const scale = Math.sqrt(((share / (1 - share)) * tailEnergy) / wallEnergy);
    for (const wall of walls) channels[wall.c][wall.at] += wall.level * scale;
  }

  // The send filters. In the response rather than in the graph, so that the
  // impulse is the whole of the answer: what is drawn, what is convolved and
  // what a guess is marked against are then one array.
  for (const out of channels) {
    if (lowCut > 20) {
      const hp = setBiquad(makeBiquad(), 'highpass', lowCut, rate);
      for (let i = 0; i < length; i += 1) out[i] = runBiquad(hp, out[i]);
    }
    if (highCut < 20000) {
      const lp = setBiquad(makeBiquad(), 'lowpass', highCut, rate);
      for (let i = 0; i < length; i += 1) out[i] = runBiquad(lp, out[i]);
    }
  }

  // Normalised to unit energy, which is what a convolution reverb does with
  // the responses it ships. Without it a long room is a loud room, and the
  // A/B becomes a level test again - the same false positive auto gain exists
  // to kill everywhere else in this app.
  let energy = 0;
  for (const out of channels) for (let i = 0; i < length; i += 1) energy += sq(out[i]);
  const scale = energy > 0 ? 1 / Math.sqrt(energy) : 0;
  for (const out of channels) for (let i = 0; i < length; i += 1) out[i] *= scale;

  return { channels, rate, length, seconds: length / rate, preDelay: pre / rate };
}

/* ---------- reading a room ---------- */

/**
 * The energy decay curve, in decibels: how much of the response is still to
 * come at each moment.
 *
 * Schroeder's backwards integral, which is the standard way to measure a
 * decay and far steadier than looking at the envelope - a tail is noise, and
 * noise wanders several decibels from sample to sample while the integral of
 * it does not wander at all.
 */
export function decayCurve(samples, rate, times, against = null) {
  const running = new Float64Array(samples.length + 1);
  for (let i = samples.length - 1; i >= 0; i -= 1) {
    running[i] = running[i + 1] + sq(samples[i]);
  }

  // Against the whole room, when a caller has one: that is what makes this a
  // reading of a band's share as well as of its decay.
  const total = against ?? running[0];
  if (total <= 0) return times.map(() => DECAY_FLOOR);

  return times.map((t) => {
    const at = Math.round(t * rate);
    if (at >= samples.length) return DECAY_FLOOR;
    const left = running[at] / total;
    return Math.max(DECAY_FLOOR, 10 * Math.log10(Math.max(left, 1e-12)));
  });
}

/**
 * The decay time, measured rather than assumed.
 *
 * Read off the part of the curve between -5 and -25 dB and extrapolated to
 * -60, which is what a room measurement does: the first few decibels are the
 * direct sound and the last few are under the noise, and neither belongs to
 * the decay.
 */
export function rt60(samples, rate) {
  const step = 0.005;
  const times = [];
  for (let t = 0; t < samples.length / rate; t += step) times.push(t);
  const curve = decayCurve(samples, rate, times);

  const cross = (db) => {
    for (let i = 0; i < curve.length; i += 1) if (curve[i] <= db) return times[i];
    return null;
  };

  const from = cross(-5);
  const to = cross(-25);
  if (from === null || to === null || to <= from) return 0;
  return ((to - from) * 60) / 20;
}

/**
 * Clarity, in decibels: the sound that arrives early against the sound that
 * arrives late.
 *
 * C80 is the acoustician's number for whether a hall is muddy, and it is
 * exactly the thing pre-delay and the early-late balance are for. Positive is
 * clear, negative is a wash, and the difference between a room you can put a
 * vocal in and one you cannot is a few decibels of it.
 */
export function clarity(samples, rate, ms = 80) {
  const split = Math.round((ms / 1000) * rate);
  let early = 0;
  let late = 0;
  for (let i = 0; i < samples.length; i += 1) {
    if (i < split) early += sq(samples[i]);
    else late += sq(samples[i]);
  }
  if (late <= 0) return 60;
  if (early <= 0) return -60;
  return Math.max(-60, Math.min(60, 10 * Math.log10(early / late)));
}

/** One band of a response, for reading its decay on its own. */
export function bandOf(samples, rate, band) {
  const out = new Float32Array(samples.length);
  out.set(samples);

  if (band.low > 20) {
    for (let pass = 0; pass < 2; pass += 1) {
      const hp = setBiquad(makeBiquad(), 'highpass', band.low, rate);
      for (let i = 0; i < out.length; i += 1) out[i] = runBiquad(hp, out[i]);
    }
  }
  if (band.high < 20000) {
    for (let pass = 0; pass < 2; pass += 1) {
      const lp = setBiquad(makeBiquad(), 'lowpass', band.high, rate);
      for (let i = 0; i < out.length; i += 1) out[i] = runBiquad(lp, out[i]);
    }
  }

  return out;
}

/**
 * The times a decay is compared at.
 *
 * Spaced logarithmically, because a decay is heard as a ratio: the difference
 * between a third of a second and half a second is a different room, and the
 * difference between five seconds and five and a bit is nothing at all. On an
 * even grid out to seven seconds every short room sat on the floor after four
 * points and they all read the same.
 */
export const decayTimes = (count = 60, from = 0.004, to = MOST_DECAY) =>
  [0, ...Array.from({ length: count - 1 }, (_, i) =>
    from * (to / from) ** (i / (count - 2)))];

/**
 * What a room does, in the terms it is judged in: how it decays, band by band.
 *
 * Takes the response to read rather than the room, because what anybody hears
 * is the dry sound and the room together - see `wetDryImpulse`. Handed the
 * wet side on its own, the mix knob was invisible: the reverb decays the same
 * way whether it is at five per cent or a hundred, so a match could be scored
 * perfect with the reverb turned all the way down and nothing audible at all.
 *
 * One reading then covers every control at once. Decay is the slope of it,
 * pre-delay is the flat part at the start, damping is the three bands pulling
 * apart, the early-late balance is the shape of the first few decibels, the
 * send filters are where each band begins, and the mix is the step down from
 * the direct sound to the room - so two reverbs whose profiles sit on each
 * other are the same reverb, however their knobs were arrived at.
 */
export function decayProfile(mono, rate, times = decayTimes()) {
  // Every band against the whole room rather than against itself. Normalised
  // band by band, a room with the low end filtered off its send read as
  // identical to one without - its low band still decayed from nought to
  // minus sixty, there was just less of it. Against the total, a band that
  // has been taken out starts low and stays low, so what the send filters do
  // is in the same reading as everything else.
  const bands = VERB_BANDS.map((band) => bandOf(mono, rate, band));
  const total = bands.reduce((sum, samples) => {
    let energy = 0;
    for (let i = 0; i < samples.length; i += 1) energy += sq(samples[i]);
    return sum + energy;
  }, 0);

  const profile = {};
  VERB_BANDS.forEach((band, i) => {
    profile[band.id] = decayCurve(bands[i], rate, times, total);
  });
  return profile;
}

/**
 * Both ears together, for measuring - a room's decay is not a stereo question.
 *
 * Summed rather than averaged, because this is a measurement and the two
 * channels of a room are very nearly uncorrelated: adding them keeps the
 * energy, and averaging them throws away about five and a half decibels of
 * it. That matters in one place and matters a lot there - `wetDryImpulse`
 * weighs the room against a direct sound of a known size, so a room measured
 * five decibels quiet reads as five decibels drier than it is.
 */
export function monoOf(impulse) {
  const [left, right] = impulse.channels;
  const out = new Float32Array(impulse.length);
  for (let i = 0; i < impulse.length; i += 1) out[i] = left[i] + (right ? right[i] : 0);
  return out;
}

/** How far apart two rooms are, in decibels of decay. */
export function profileDistance(mine, theirs) {
  let sum = 0;
  let count = 0;

  for (const band of VERB_BANDS) {
    const a = mine[band.id];
    const b = theirs[band.id];
    for (let i = 0; i < a.length; i += 1) {
      sum += sq(a[i] - b[i]);
      count += 1;
    }
  }

  return Math.sqrt(sum / Math.max(1, count));
}

/**
 * The whole thing you actually hear: the dry signal and the room together.
 *
 * Clarity is a property of that, not of the reverb on its own - a wash of a
 * room with the mix at ten per cent is a perfectly clear sound, and the
 * reading has to say so.
 */
export function wetDryImpulse(impulse, mix) {
  const mono = monoOf(impulse);
  const out = new Float32Array(mono.length);
  const wet = Math.min(1, Math.max(0, mix));

  for (let i = 0; i < out.length; i += 1) out[i] = mono[i] * wet;
  // The dry path is the sound arriving with nothing done to it at all, which
  // in these terms is exactly one sample at the front.
  out[0] += 1 - wet;
  return out;
}

/** A room, built and read in the terms a guess is marked in. */
export function roomProfile(rate, settings, times = decayTimes()) {
  const impulse = makeImpulse(rate, settings);
  return decayProfile(wetDryImpulse(impulse, settings.mix ?? VERB_DEFAULTS.mix), rate, times);
}
