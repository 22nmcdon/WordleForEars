import {
  IMAGE_DEFAULTS, imageOf, imageGap, runImager,
} from '../image/field.js';
import { ImagePlugin } from '../image/plugin.js';
import { makeBiquad, setBiquad, runBiquad } from '../comp/dsp.js';
import { mulberry32 } from '../random.js';
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

const IMAGE_EXERCISES = {
  place: { source: 'instrument', other: 'Target', fault: null },
  match: { source: 'mix', other: 'Target', fault: null },
  mono: { source: 'mix', other: 'Untreated', fault: { low: 2.3 } },
};

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

export default {
  id: 'panning',
  label: 'Stereo',
  blurb: 'Place it, and size it',
  surface: true,
  lede: 'A stereo imager, and a loop running through it. Put the sound where '
      + 'the target sits, build the same width the target has, or rescue a low '
      + 'end that somebody has spread so wide it disappears in mono.',
  opening: 'Play the loop, work the image, then lock it in.',
  advice: 'Headphones for this one — a laptop speaker has almost no stereo field to point at. And press Mono often: it is the check that decides what everybody else hears.',

  help: [
    ['Play the loop, then work the image.',
     'The round display is the two channels drawn against each other. Straight up and '
     + 'down is mono, a cloud is wide, and anything lying over towards the horizontal is '
     + 'two channels arguing — which is exactly what will not survive being summed.'],
    ['Width is one idea applied three times.',
     'A pair of channels is the same information as a middle and a side, and width is '
     + 'what the side gets multiplied by. Doing it per band is the whole point: a low end '
     + 'wants to be narrow and a top end usually does not.'],
    ['Mono is the check that matters.',
     'Most of what a record is played on sums to mono somewhere. The bars go red when the '
     + 'two channels of a band are arguing, and the readout says what a fold to mono is '
     + 'costing you.'],
    ['You are judged on the image, not the knobs.',
     'Width band by band, and where the whole thing is sitting left to right. Two sets of '
     + 'settings that come out the same width are the same answer.'],
  ],

  settings: [
    {
      id: 'exercise',
      label: 'Exercise',
      options: [
        { id: 'place', label: 'Place it' },
        { id: 'match', label: 'Match the image' },
        { id: 'mono', label: 'Rescue the low end' },
      ],
    },
  ],

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

  score(guess, answer, tier, puzzle) {
    const exercise = puzzle?.settings?.exercise ?? 'place';
    const settings = { ...IMAGE_DEFAULTS, ...guess, listen: 'stereo' };
    const material = fieldMaterial(puzzle);
    const mine = imageOf(material.left, material.right, material.rate, settings);

    if (exercise === 'mono') return this.scoreMono(mine, material, tier, settings);
    if (exercise === 'match') return this.scoreMatch(mine, answer, material, tier);
    return this.scorePlace(mine, answer, material, tier);
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
    const state = off <= close ? HIT : off <= close * 2.5 ? NEAR : MISS;

    return {
      correct: off <= close,
      error: off,
      cells: [
        { state, text: writePan(this.panOf(got)) },
        {
          state,
          text: off <= close ? 'that is where it is'
            : `${off.toFixed(1)} dB too far ${got > wanted ? 'left' : 'right'}`,
          narrow: true,
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
    const theirs = imageOf(material.left, material.right, material.rate,
      { ...IMAGE_DEFAULTS, ...answer, listen: 'stereo' });
    const gap = imageGap(mine, theirs);
    const error = gap.off;

    const close = IMAGE_CLOSE[tier];
    const state = error <= close ? HIT : error <= close * 2.5 ? NEAR : MISS;

    return {
      correct: error <= close,
      error,
      cells: [
        { state, text: `${error.toFixed(1)} dB out` },
        {
          state,
          // Where the worst of it is, because that is what is being read: a
          // whole-mix reading would say nothing when one band is in
          // completely the wrong place and the other five are right.
          text: error <= close ? 'that is the image'
            : gap.where === null ? `sitting too far ${gap.placed > 0 ? 'left' : 'right'}`
            : `too ${gap.wider > 0 ? 'wide' : 'narrow'} at ${gap.where}`,
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
    };
  },

  /* ---------- the surface ---------- */

  mount(el, { engine, puzzle, onChange }) {
    const exercise = puzzle.settings.exercise;
    const spec = IMAGE_EXERCISES[exercise];
    const settings = { ...IMAGE_DEFAULTS };

    const plugin = new ImagePlugin(el, {
      engine, settings, onChange, source: spec.source, fault: puzzle.fault ?? spec.fault,
    });

    plugin.nameOther(spec.other);
    plugin.setTarget(exercise === 'mono' ? { ...IMAGE_DEFAULTS } : puzzle.answer);

    // The loop a guess is read against, kept on the puzzle. The sample picker
    // changes what you monitor and never what you are marked on.
    (async () => {
      try {
        await plugin.player.prepare();
        const sample = plugin.player.sample();
        if (sample) puzzle.material = sample;
      } catch {
        // No audio yet; scoring says so rather than guessing.
      }
    })();

    return {
      guess: () => ({ ...settings }),
      reveal: () => {
        if (puzzle.answer) plugin.showTarget({ ...IMAGE_DEFAULTS, ...puzzle.answer });
        plugin.lock();
      },
      toggle: () => plugin.toggle(),
      destroy: () => plugin.destroy(),
    };
  },

  clues() {
    return [];
  },

  play() {
    // The loop runs inside the plugin, under the player's own hands.
  },

  reveal(answer, tier, puzzle) {
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

  weak(answer, puzzle) {
    const exercise = puzzle?.settings?.exercise ?? 'place';
    if (exercise === 'mono') return { key: 'mono', label: 'mono compatibility' };
    if (exercise === 'match') return { key: 'width', label: 'width' };

    const side = answer.pan < -0.2 ? 'the left' : answer.pan > 0.2 ? 'the right' : 'the centre';
    return { key: side, label: side };
  },
};
