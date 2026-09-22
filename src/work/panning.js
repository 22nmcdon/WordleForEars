import {
  IMAGE_DEFAULTS, imageOf, imageReading, runImager,
} from '../image/field.js';
import { makeBiquad, setBiquad, runBiquad } from '../comp/dsp.js';
import { mulberry32 } from '../random.js';
import { distance } from '../gap.js';
import { HIT, NEAR, MISS, toStep, pick } from './scoring.js';

/**
 * Where things sit, and how far apart they sit.
 *
 * This began as a one-knob listening quiz - here is a sound, move the pan
 * until yours is where theirs is - and that exercise is still the first of
 * the three, because it is the right place to start. What is around it now is
 * the tool the question belongs to: mid and side, band by band, which is how
 * anybody actually decides how wide a record is.
 *
 * Kept under `panning` so that everybody's history of it survives, and
 * labelled for what it does now.
 *
 * The third exercise is the one worth building the rest for. A low end spread
 * across the field sounds enormous and then vanishes the moment anything sums
 * it - a club system, a phone, a radio - and hearing that happen, and undoing
 * it without flattening the whole record, is the single most useful thing in
 * this mode.
 */


/** How far two images may be apart, in decibels of width, and still match. */
const IMAGE_CLOSE = { easy: 2.4, medium: 1.6, hard: 1.0 };

/**
 * How far off a placing may be, in decibels of balance between the channels.
 *
 * Read off the output rather than off the knob, and clamped, because balance
 * runs away to nothing at all once one side is closed: hard left is not
 * twenty decibels further left than three-quarters left, it is the end of the
 * room.
 */
const PLACED = { easy: 4, medium: 2.5, hard: 1.0 };
const MOST_BALANCE = 20;

/**
 * What the low end may lose to a fold to mono, and what the top must keep.
 *
 * Measured against the faults this mode hands out. Left alone, the widened
 * low end costs between two and two and a half decibels when summed, so
 * every tier has to fail that - the first set of numbers let it pass on easy,
 * which made the exercise winnable by submitting nothing. Narrowed to about
 * half, it costs under a decibel, and there is a wide range of settings that
 * do it.
 */
const MONO_COST = { easy: 1.5, medium: 1.0, hard: 0.7 };
const KEEP_THE_TOP = 2.5;

/** The bands the low-end question is asked about, and the ones the top is. */
const DOWN_LOW = ['sub', 'low'];
const UP_TOP = ['himid', 'high'];

/**
 * A stand-in for the loop, for the times the real thing is not to hand.
 *
 * The surface renders the material the moment it mounts, so in the app this
 * is almost never what marks a guess. It exists so that scoring is a pure
 * function a test can call without an audio context, and so that a guess
 * submitted in the first moments of a round is read rather than dropped.
 *
 * Built to have the same shape of problem the bed has: two channels that
 * agree about most things and disagree most down low, which is the only
 * arrangement in which any of these exercises means anything.
 */
function stereoProbe(rate, seconds = 1.2) {
  const length = Math.round(rate * seconds);
  const left = new Float32Array(length);
  const right = new Float32Array(length);

  const shared = mulberry32(0xb0a7);
  const apart = mulberry32(0x5e11);
  const low = setBiquad(makeBiquad(), 'lowpass', 220, rate);
  const high = setBiquad(makeBiquad(), 'highpass', 220, rate);

  for (let i = 0; i < length; i += 1) {
    const together = shared() * 2 - 1;
    const differ = apart() * 2 - 1;
    // Most of the disagreement is in the low end, as it is on the bed.
    const side = runBiquad(low, differ) * 0.85 + runBiquad(high, differ) * 0.22;
    left[i] = together + side;
    right[i] = together - side;
  }

  return { left, right, rate };
}

/** The audio a guess is read against - the exercise's own, never the monitor's. */
function fieldMaterial(puzzle) {
  if (puzzle?.material?.left) return puzzle.material;

  const probe = stereoProbe(48000);
  if (!puzzle?.fault) return probe;

  // The fault belongs to the recording, so the stand-in gets it too.
  const faulted = runImager(probe.left, probe.right, probe.rate,
    { ...IMAGE_DEFAULTS, ...puzzle.fault });
  return { left: faulted.left, right: faulted.right, rate: probe.rate };
}

const writePan = (pan) => {
  const at = Math.round(pan * 100);
  if (Math.abs(at) < 3) return 'Centre';
  return `${Math.abs(at)}% ${at < 0 ? 'left' : 'right'}`;
};

const mean = (list) => list.reduce((a, b) => a + b, 0) / Math.max(1, list.length);
const held = (db) => Math.max(-MOST_BALANCE, Math.min(MOST_BALANCE, db));

/**
 * The three exercises, in the shape a session can set up.
 *
 * The descriptor that used to be spelled out inside `mount`, as data - which
 * is what lets one tool be handed from one exercise to the next without being
 * destroyed in between.
 */
export const IMAGE_EXERCISES = {
  place: {
    id: 'place',
    label: 'Place it',
    source: 'instrument',
    other: 'Target',
    faultOf: () => null,
    targetOf: (puzzle) => puzzle.answer,
  },
  match: {
    id: 'match',
    label: 'Match the image',
    source: 'mix',
    other: 'Target',
    faultOf: () => null,
    targetOf: (puzzle) => puzzle.answer,
  },
  mono: {
    id: 'mono',
    label: 'Rescue the low end',
    source: 'mix',
    // Somebody spread the bottom end before it reached you. The other side of
    // the A/B is that, untouched, so you can hear what you are undoing.
    other: 'Untreated',
    faultOf: (puzzle) => puzzle.fault ?? { low: 2.3 },
    targetOf: () => ({ ...IMAGE_DEFAULTS }),
  },
};

export const IMAGE_WORK = {
  tool: 'panning',
  opening: 'Play the loop, work the image, then lock it in.',

  settings: [
    {
      id: 'exercise',
      label: 'Exercise',
      options: Object.values(IMAGE_EXERCISES).map(({ id, label }) => ({ id, label })),
    },
  ],

  exercises: IMAGE_EXERCISES,

  tiers: {
    easy: { label: 'Easy', blurb: 'Hard left, centre, hard right', guesses: 3, places: [-1, 0, 1], bands: 1 },
    medium: { label: 'Medium', blurb: 'Anywhere, in quarters', guesses: 4, step: 0.25, bands: 2 },
    hard: { label: 'Hard', blurb: 'Anywhere at all', guesses: 4, step: 0.1, bands: 3 },
  },

  /** The round is played on the plugin, so there is nothing to pick from. */
  slots() {
    return [];
  },

  makePuzzle(rng, tier, settings) {
    const spec = this.tiers[tier];

    if (settings.exercise === 'mono') {
      // How far somebody else spread the low end before handing it over.
      return { fault: { low: toStep(2.6 + rng() * 0.6, 0.05) }, answer: null };
    }

    if (settings.exercise === 'match') {
      // Widths either side of untouched, so that leaving the plugin alone is
      // never the answer - and never so narrow that the reading runs into its
      // own floor, where every narrow image looks like every other one.
      const away = () => {
        const wide = rng() < 0.5;
        return toStep(wide ? 1.45 + rng() * 0.85 : 0.25 + rng() * 0.4, 0.05);
      };

      const answer = { ...IMAGE_DEFAULTS, low: away() };
      if (spec.bands >= 2) answer.high = away();
      if (spec.bands >= 3) answer.mid = away();
      return { answer };
    }

    const pan = spec.places
      ? pick(rng, spec.places)
      : toStep(-1 + rng() * 2, spec.step);

    return { answer: { ...IMAGE_DEFAULTS, pan } };
  },

  /* ---------- marking ---------- */

  score(state, puzzle) {
    const { answer, tier } = puzzle;
    const guess = state;
    const exercise = puzzle?.settings?.exercise ?? 'place';
    const settings = { ...IMAGE_DEFAULTS, ...guess, listen: 'stereo' };
    const material = fieldMaterial(puzzle);
    // The same envelope the plugin hands back, so the panel's number and this
    // one are the same measurement rather than two that happen to agree.
    const mine = imageReading(material.left, material.right, material.rate, settings);

    if (exercise === 'mono') return this.scoreMono(mine.values, material, tier, settings);
    if (exercise === 'match') return this.scoreMatch(mine, answer, material, tier);
    return this.scorePlace(mine.values, answer, material, tier);
  },

  /** Is it in the same place? */
  scorePlace(mine, answer, material, tier) {
    // Two measurements rather than a measurement and a formula. The bed is
    // not perfectly centred to begin with, so reading one side off the audio
    // and working the other out on paper left a residual that moved with the
    // material - and at the finest tier that residual was most of the
    // tolerance.
    const theirs = imageOf(material.left, material.right, material.rate,
      { ...IMAGE_DEFAULTS, ...answer, listen: 'stereo' });

    const got = held(mine.whole.balance);
    const wanted = held(theirs.whole.balance);
    const off = Math.abs(got - wanted);

    const close = PLACED[tier];
    const mark = off <= close ? HIT : off <= close * 2.5 ? NEAR : MISS;

    return {
      correct: off <= close,
      error: off,
      cells: [
        { state: mark, text: writePan(this.panOf(got)) },
        {
          state: mark,
          text: off <= close ? 'that is where it is'
            : `${off.toFixed(1)} dB too far ${got > wanted ? 'left' : 'right'}`,
          narrow: true,
        },
      ],
      why: [
        {
          label: 'Balance, yours',
          value: `${got > 0 ? '+' : ''}${got.toFixed(2)} dB`,
          how: 'The difference in level between the two channels, measured off '
             + 'the audio rather than read off the pan control. Positive is left.',
        },
        {
          label: 'Balance, wanted',
          value: `${wanted > 0 ? '+' : ''}${wanted.toFixed(2)} dB`,
          how: 'Measured the same way, off the same bed panned to the answer. Two '
             + 'measurements rather than a measurement and a formula: the bed is '
             + 'not perfectly centred to begin with, and working one side out on '
             + 'paper left a residual that moved with the material and, at the '
             + 'finest tier, was most of the tolerance.',
        },
        {
          label: 'Matched at',
          value: `${close.toFixed(2)} dB or less`,
          how: 'How far apart the two balances may sit and still be the same '
             + 'place. It tightens with the tier, because the tier is how finely '
             + 'the answer was placed.',
        },
      ],
    };
  },

  /**
   * What a pan does to the balance between the channels.
   *
   * The same law the imager uses, so that a target described by a pan and a
   * guess measured off the audio are on the same scale.
   */
  balanceOf(pan) {
    if (pan === 0) return 0;
    if (pan < 0) {
      const x = (pan + 1) * Math.PI * 0.5;
      const left = 1 + Math.cos(x);
      const right = Math.sin(x);
      return 20 * Math.log10(Math.max(left, 1e-6) / Math.max(right, 1e-6));
    }
    const x = pan * Math.PI * 0.5;
    const left = Math.cos(x);
    const right = 1 + Math.sin(x);
    return 20 * Math.log10(Math.max(left, 1e-6) / Math.max(right, 1e-6));
  },

  /** And back, near enough to say where something is sitting. */
  panOf(balance) {
    let best = 0;
    let closest = Infinity;
    for (let pan = -1; pan <= 1.0001; pan += 0.01) {
      const off = Math.abs(held(this.balanceOf(pan)) - balance);
      if (off < closest) { closest = off; best = pan; }
    }
    return best;
  },

  /** Is it the same width, band by band? */
  scoreMatch(mine, answer, material, tier) {
    const theirs = imageReading(material.left, material.right, material.rate,
      { ...IMAGE_DEFAULTS, ...answer, listen: 'stereo' });
    const gap = distance(mine, theirs);
    const error = gap.off;

    const close = IMAGE_CLOSE[tier];
    const mark = error <= close ? HIT : error <= close * 2.5 ? NEAR : MISS;

    return {
      correct: error <= close,
      error,
      cells: [
        { state: mark, text: `${error.toFixed(1)} dB out` },
        {
          state: mark,
          // Where the worst of it is, because that is what is being read: a
          // whole-mix reading would say nothing when one band is in
          // completely the wrong place and the other five are right.
          text: error <= close ? 'that is the image'
            : gap.where === null ? `sitting too far ${gap.detail.placed > 0 ? 'left' : 'right'}`
            : `too ${gap.detail.wider > 0 ? 'wide' : 'narrow'} at ${gap.where}`,
        },
      ],
      why: [
        {
          label: 'Worst band',
          value: gap.where === null
            ? 'the whole image, not one band'
            : `${gap.where}, ${error.toFixed(2)} dB out`,
          how: 'The image is measured in six bands, and this is the one furthest '
             + 'from the target. The worst band rather than the average, because '
             + 'an average over six says nothing when one is in completely the '
             + 'wrong place and the other five are right.',
        },
        {
          label: 'Which way',
          value: gap.where === null
            ? `sitting ${gap.detail.placed > 0 ? 'left' : 'right'} of centre`
            : `${Math.abs(gap.detail.wider).toFixed(2)} dB too `
              + `${gap.detail.wider > 0 ? 'wide' : 'narrow'}`,
          how: 'Width is the side signal against the middle. Too wide and it will '
             + 'not survive being summed; too narrow and the record closes up.',
        },
      ],
    };
  },

  /**
   * Did the low end survive being summed, and is anything left of the top?
   *
   * Two readings, because either one on its own has a wrong answer that
   * passes it. Monoing everything makes the low end perfectly mono-safe and
   * throws the record away; leaving it alone keeps the width and loses the
   * bass on half the systems it will be played on.
   */
  scoreMono(mine, material, tier, settings) {
    const untouched = imageOf(material.left, material.right, material.rate, IMAGE_DEFAULTS);

    const cost = -mean(DOWN_LOW.map((id) => mine.bands[id].mono));
    const top = mean(UP_TOP.map((id) => mine.bands[id].width));
    const wasTop = mean(UP_TOP.map((id) => untouched.bands[id].width));

    // And it has to still be pointing straight ahead. Throwing the whole mix
    // to one side makes the low end perfectly mono-safe, for the same reason
    // a mono record is - there is nothing on the other side to cancel with.
    //
    // Read off the pan rather than off the measured balance, because the two
    // are not separable: scaling the side of a band changes the balance
    // between the channels whenever the middle and the side are at all
    // related, so a legitimate narrowing of the low end moved the balance
    // and failed a guard meant for a hard pan.
    const leaning = Math.abs(settings.pan ?? 0) > 0.12;

    const close = MONO_COST[tier];
    const safe = cost <= close;
    const kept = top >= wasTop - KEEP_THE_TOP && !leaning;

    return {
      correct: safe && kept,
      error: cost,
      cells: [
        {
          state: safe && kept ? HIT : safe || cost <= close * 2 ? NEAR : MISS,
          text: safe ? 'the low end survives mono' : `mono costs ${cost.toFixed(1)} dB down low`,
        },
        {
          state: kept ? (safe ? HIT : NEAR) : MISS,
          text: leaning ? 'but it is all on one side now'
            : kept ? (safe ? 'and the top is still there' : 'the top is fine')
            : `${(wasTop - top).toFixed(1)} dB of the top gone too`,
        },
      ],
      why: [
        {
          label: 'Mono cost, low end',
          value: `${cost.toFixed(2)} dB, allowed ${close.toFixed(1)}`,
          how: 'What the bottom two bands lose when the two channels are summed. '
             + 'Anything on the sides down there cancels against itself, which is '
             + 'why a wide low end disappears on a system that plays one speaker.',
        },
        {
          label: 'Top left standing',
          value: `${top.toFixed(2)} against ${wasTop.toFixed(2)} untouched`,
          how: `How wide the top three bands still are. Monoing everything makes `
             + `the low end perfectly safe and throws the record away, so the top `
             + `may not lose more than ${KEEP_THE_TOP} of its width.`,
        },
        {
          label: 'Still pointing forward',
          value: leaning ? 'no - it has been thrown to one side' : 'yes',
          how: 'Read off the pan rather than the measured balance. The two are '
             + 'not separable - scaling the side of a band moves the balance '
             + 'whenever the middle and the side are at all related - so a '
             + 'legitimate narrowing of the low end failed a guard meant for a '
             + 'hard pan until this was read off the control instead.',
        },
      ],
    };
  },

  hints(puzzle) {
    const { answer, tier } = puzzle;
    const exercise = puzzle?.settings?.exercise ?? 'place';

    if (exercise === 'mono') {
      return [
        'The problem is down low, and it is width: there is too much on the '
          + 'sides for the bottom end to survive being summed.',
        'Narrow the low band and leave the top alone. Panning the whole thing '
          + 'would also make it mono-safe, for the same reason a mono record is, '
          + 'and that is marked as the wrong answer it is.',
      ];
    }

    if (exercise === 'match') {
      const settings = { ...IMAGE_DEFAULTS, ...answer };
      const named = [['low', 'the low band'], ['mid', 'the middle'], ['high', 'the top']]
        .filter(([id]) => Math.abs(settings[id] - 1) > 0.08);

      return [
        named.length === 1
          ? `One band has moved: ${named[0][1]}.`
          : `${named.length} bands have moved: ${named.map(([, name]) => name).join(' and ')}.`,
        named.map(([id, name]) => `${name} is ${settings[id] > 1 ? 'wider' : 'narrower'}`)
          .join(', and ') + '.',
      ];
    }

    const pan = answer.pan;
    return [
      Math.abs(pan) < 0.12
        ? 'It is in the middle, or close enough to it that the reading will not '
          + 'separate the two.'
        : `It is on ${pan < 0 ? 'the left' : 'the right'} of centre - so the pan `
          + 'has to move, and it has to move that way.',
      Math.abs(pan) < 0.12
        ? 'Leave the pan where it is and read the balance rather than the control.'
        : Math.abs(pan) > 0.8
          ? 'And it is most of the way over, not a nudge - close to hard over.'
        : Math.abs(pan) > 0.4
          ? 'About halfway out: audibly to one side, but not pinned against it.'
        : 'Only a little way out - closer to the middle than to the side.',
    ];
  },

  reveal(puzzle) {
    const { answer } = puzzle;
    const exercise = puzzle?.settings?.exercise ?? 'place';

    if (exercise === 'mono') {
      return {
        symbol: `${Math.round((puzzle?.fault?.low ?? 2.3) * 100)}%`,
        name: 'of low-end width to undo, without losing the top',
      };
    }

    if (exercise === 'match') {
      const settings = { ...IMAGE_DEFAULTS, ...answer };
      return {
        symbol: `${Math.round(settings.low * 100)} / ${Math.round(settings.mid * 100)} / ${Math.round(settings.high * 100)}%`,
        name: 'low, mid and top',
      };
    }

    return { symbol: writePan(answer.pan), name: '' };
  },

  weak(puzzle) {
    const { answer } = puzzle;
    const exercise = puzzle?.settings?.exercise ?? 'place';
    if (exercise === 'mono') return { key: 'mono', label: 'mono compatibility' };
    if (exercise === 'match') return { key: 'width', label: 'width' };

    const side = answer.pan < -0.2 ? 'the left' : answer.pan > 0.2 ? 'the right' : 'the centre';
    return { key: side, label: side };
  },
};
