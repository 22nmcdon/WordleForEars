import {
  HEAT_DEFAULTS, HEAT_FLOOR, MOST_TONE, MOST_HARDNESS,
  harmonicsOf, heatGap,
} from '../heat/shape.js';
import { HeatPlugin } from '../heat/plugin.js';
import { HIT, NEAR, MISS, toStep } from './scoring.js';

/**
 * The harmonics a thing makes when you push it.
 *
 * The last of the production modes, and the only one about a sound that was
 * not there before. Everything else in this app moves energy around: an EQ
 * lifts a band that already existed, a compressor turns a moment down, a
 * reverb puts copies of it in a room. A saturator adds frequencies that were
 * never in the recording, and the whole subject is which ones.
 *
 * The ear skill is one distinction, and it is worth more than any amount of
 * knob knowledge: even harmonics against odd. Even ones are octaves and
 * their neighbours, and they sound like the note getting larger. Odd ones
 * are fifths and their neighbours, and they sound like the note breaking.
 * Warm and dirty are not vague words - they are those two piles of numbers,
 * and the third exercise is nothing but learning to tell them apart.
 *
 * Marking is arithmetic on the settings rather than a measurement of the
 * loop, which no other production mode here can say. Harmonics are only
 * harmonics of something, so the reading is taken off a sine - and what a
 * curve does to a sine is a complete description of what it does to
 * anything. Two sets of settings that make the same series are the same
 * answer, whatever route they took.
 */

const HEAT_EXERCISES = {
  amount: { source: 'instrument', other: 'Target' },
  match: { source: 'mix', other: 'Target' },
  even: { source: 'instrument', other: 'Untouched' },
};

/** How far off the amount of saturation may be, in decibels of distortion. */
const AMOUNT_CLOSE = { easy: 2.6, medium: 1.6, hard: 1.0 };

/** And how far off any one harmonic may be, when the whole colour is marked. */
const COLOUR_CLOSE = { easy: 6.0, medium: 4.0, hard: 2.6 };

/** How near the asked-for even level counts, and how far ahead of the odd. */
const EVEN_CLOSE = { easy: 4.0, medium: 2.5, hard: 1.6 };
const EVEN_LEAD = { easy: 3, medium: 5, hard: 7 };

const writeEven = (db) => `${db >= 0 ? '+' : ''}${db.toFixed(1)} dB`;

/** Second, third, fourth - said the way anybody names a harmonic. */
const ORDINALS = ['', '', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th'];
const ordinal = (n) => ORDINALS[n] ?? `${n}th`;

export default {
  id: 'saturation',
  label: 'Saturation',
  blurb: 'Even, odd, and how much',
  surface: true,
  lede: 'A saturator, and a loop running through it. Match how much colour '
      + 'the target has, match the colour itself, or build a warmth that is '
      + 'all even harmonics and no grit.',
  opening: 'Play the loop, drive it, then lock it in.',
  advice: 'Auto gain is on, and leave it on — saturation makes things louder as well as richer, and louder always sounds better for about two seconds. Press “Only the heat” to hear what the curve is adding with nothing else in the way.',

  help: [
    ['Play the loop, then drive it.',
     'The square panel is the transfer curve: what comes out for everything that could '
     + 'go in. A straight line does nothing. A line that bends at the ends is saturating, '
     + 'and how sharply it bends is the Hardness.'],
    ['Bias is the one that matters.',
     'A curve that treats up and down alike can only make odd harmonics — the third, the '
     + 'fifth — and those sound like grit. Tilt it with Bias and the even ones appear, and '
     + 'those sound like the note getting bigger. Gold bars are even, pink are odd.'],
    ['Drive decides how much, not which.',
     'Past a certain point everything sounds the same kind of broken: hit anything hard '
     + 'enough and it becomes a square wave, which is all odd. Warmth lives at the quiet '
     + 'end of the drive, with the bias doing the work.'],
    ['You are judged on the harmonics, not the knobs.',
     'The series a sine comes out as, second to tenth. Two sets of settings that make the '
     + 'same series are the same answer.'],
  ],

  settings: [
    {
      id: 'exercise',
      label: 'Exercise',
      options: [
        { id: 'amount', label: 'How much' },
        { id: 'match', label: 'Match the colour' },
        { id: 'even', label: 'Even, not odd' },
      ],
    },
  ],

  tiers: {
    easy: { label: 'Easy', blurb: 'Drive and bias', guesses: 3, knobs: 2 },
    medium: { label: 'Medium', blurb: 'And the hardness', guesses: 4, knobs: 3 },
    hard: { label: 'Hard', blurb: 'The whole curve', guesses: 4, knobs: 5 },
  },

  /** The round is played on the plugin, so there is nothing to pick from. */
  slots() {
    return [];
  },

  makePuzzle(rng, tier, settings) {
    const spec = this.tiers[tier];

    if (settings.exercise === 'even') {
      // How loud the even harmonics have to be. Kept away from both ends:
      // too quiet and doing almost nothing passes, too loud and there is no
      // setting that gets there without the odd ones coming along.
      return { want: toStep(-26 + rng() * 12, 0.5), answer: null };
    }

    if (settings.exercise === 'amount') {
      // Only the drive moves. Enough of it to be plainly audible, never so
      // much that the series has flattened out into a square wave, where
      // another three decibels of drive changes almost nothing.
      return {
        answer: {
          ...HEAT_DEFAULTS,
          drive: toStep(8 + rng() * 14, 0.5),
          bias: 0.45,
          hardness: 2.5,
        },
      };
    }

    // Match the colour: as many of the controls as the tier asks for.
    //
    // Every range here has a floor under it, and the floor is the point. A
    // target nobody can hear is not a puzzle: at the hardest tier the first
    // set of ranges could put a quiet drive, a low tone and a half mix
    // together and produce a setting 37 dB down, which is indistinguishable
    // from leaving the plugin alone - and was, in one round in twenty, a
    // round won by submitting nothing.
    const hardness = spec.knobs >= 3 ? toStep(1 + rng() * (MOST_HARDNESS - 1), 0.05) : HEAT_DEFAULTS.hardness;

    // How much drive it takes before that curve is doing anything, which
    // depends on the curve. A soft one is colouring almost immediately; a
    // hard one is a straight line until it isn't, and at the same drive
    // setting it can be twenty decibels quieter. Measured, and then made the
    // floor - so the drive that follows is always a drive you can hear, and
    // always near enough to the knee that the hardness is audible too.
    const floor = 6 + 1.7 * hardness;

    const answer = {
      ...HEAT_DEFAULTS,
      hardness,
      drive: toStep(floor + rng() * 14, 0.5),
      bias: toStep(rng() < 0.25 ? 0 : 0.2 + rng() * 0.8, 0.05),
    };
    if (spec.knobs >= 5) {
      // The tone control is only worth setting where it has something to do,
      // and the mix only where there is enough drive to be worth pulling back.
      answer.tone = rng() < 0.4
        ? MOST_TONE
        : toStep(1400 * (4000 / 1400) ** rng(), 10);
      answer.mix = answer.drive >= floor + 6 && rng() < 0.6
        ? toStep(0.45 + rng() * 0.45, 0.01)
        : 1;
    }

    return { answer };
  },

  /* ---------- marking ---------- */

  score(guess, answer, tier, puzzle) {
    const exercise = puzzle?.settings?.exercise ?? 'amount';
    const rate = puzzle?.rate ?? 48000;
    const mine = harmonicsOf(rate, { ...HEAT_DEFAULTS, ...guess, listen: 'out' });

    if (exercise === 'even') return this.scoreEven(mine, puzzle, tier);

    const theirs = harmonicsOf(rate, { ...HEAT_DEFAULTS, ...answer, listen: 'out' });
    if (exercise === 'match') return this.scoreColour(mine, theirs, tier);
    return this.scoreAmount(mine, theirs, tier);
  },

  /** Is it pushed as hard? */
  scoreAmount(mine, theirs, tier) {
    const off = Math.abs(mine.thd - theirs.thd);
    const close = AMOUNT_CLOSE[tier];
    const state = off <= close ? HIT : off <= close * 2.5 ? NEAR : MISS;

    return {
      correct: off <= close,
      error: off,
      cells: [
        { state, text: `${mine.thd.toFixed(1)} dB of harmonics` },
        {
          state,
          text: off <= close ? 'that is the amount'
            : `${off.toFixed(1)} dB ${mine.thd > theirs.thd ? 'too dirty' : 'too clean'}`,
          narrow: true,
        },
      ],
    };
  },

  /** Is it the same colour, harmonic by harmonic? */
  scoreColour(mine, theirs, tier) {
    const gap = heatGap(mine, theirs);
    const close = COLOUR_CLOSE[tier];
    const state = gap.off <= close ? HIT : gap.off <= close * 2 ? NEAR : MISS;

    return {
      correct: gap.off <= close,
      error: gap.off,
      cells: [
        { state, text: `${gap.off.toFixed(1)} dB out` },
        {
          state,
          // Which harmonic is worst, because that is what is being read: an
          // average over nine of them says nothing when one is in completely
          // the wrong place and the other eight are right.
          text: gap.off <= close ? 'that is the colour'
            : `${Math.abs(gap.louder).toFixed(1)} dB too ${gap.louder > 0 ? 'much' : 'little'} `
              + `${ordinal(gap.where)} harmonic`,
        },
      ],
    };
  },

  /**
   * Is the warmth there, and is it clean?
   *
   * Two readings, because either one alone has a wrong answer that passes.
   * Driving it hard gets the even harmonics to any level you like and brings
   * a pile of odd ones with them; doing almost nothing keeps it clean and
   * has no warmth in it at all. Both at once is the exercise, and the only
   * way through is the quiet end of the drive with the bias doing the work.
   */
  scoreEven(mine, puzzle, tier) {
    const want = puzzle?.want ?? -20;
    const off = Math.abs(mine.even - want);
    const lead = mine.even - mine.odd;

    const close = EVEN_CLOSE[tier];
    const wanted = EVEN_LEAD[tier];
    const there = off <= close;
    const clean = lead >= wanted;

    return {
      correct: there && clean,
      error: off,
      cells: [
        {
          state: there && clean ? HIT : there || off <= close * 2 ? NEAR : MISS,
          text: mine.even <= HEAT_FLOOR ? 'no even harmonics at all'
            : there ? 'the warmth is there'
            : `${off.toFixed(1)} dB too ${mine.even > want ? 'much' : 'little'} warmth`,
        },
        {
          state: clean ? (there ? HIT : NEAR) : MISS,
          text: clean
            ? (there ? `and ${lead.toFixed(0)} dB clear of the grit` : 'and it is clean')
            : lead <= 0 ? 'but the odd harmonics are louder'
            : `only ${lead.toFixed(1)} dB clear of the grit`,
        },
      ],
    };
  },

  /* ---------- the surface ---------- */

  mount(el, { engine, puzzle, onChange }) {
    const exercise = puzzle.settings.exercise;
    const spec = HEAT_EXERCISES[exercise];
    const settings = { ...HEAT_DEFAULTS };

    const plugin = new HeatPlugin(el, {
      engine, settings, onChange, source: spec.source,
    });

    plugin.nameOther(spec.other);
    plugin.setTarget(exercise === 'even' ? { ...HEAT_DEFAULTS } : puzzle.answer);
    puzzle.rate = engine?.ctx?.sampleRate ?? 48000;

    return {
      guess: () => ({ ...settings }),
      reveal: () => {
        if (puzzle.answer) plugin.showTarget({ ...HEAT_DEFAULTS, ...puzzle.answer });
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
    const exercise = puzzle?.settings?.exercise ?? 'amount';

    if (exercise === 'even') {
      return {
        symbol: writeEven(puzzle?.want ?? -20),
        name: 'of even harmonics, with the odd ones kept under',
      };
    }

    const settings = { ...HEAT_DEFAULTS, ...answer };

    if (exercise === 'amount') {
      return { symbol: `${settings.drive.toFixed(1)} dB`, name: 'of drive' };
    }

    const parts = [`${settings.drive.toFixed(0)} dB`, `${Math.round(settings.bias * 100)}% bias`];
    if (settings.hardness !== HEAT_DEFAULTS.hardness) parts.push(`hardness ${settings.hardness.toFixed(1)}`);
    if (settings.mix < 1) parts.push(`${Math.round(settings.mix * 100)}% mix`);

    return { symbol: parts.join(' · '), name: '' };
  },

  weak(answer, puzzle) {
    const exercise = puzzle?.settings?.exercise ?? 'amount';
    if (exercise === 'even') return { key: 'even', label: 'even harmonics' };
    if (exercise === 'match') return { key: 'colour', label: 'harmonic colour' };
    return { key: 'amount', label: 'how much drive' };
  },
};
