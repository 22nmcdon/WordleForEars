import { dialled, logPick, toStep } from './scoring.js';

/**
 * The plan calls this one genuinely difficult even for pros, and it is - so
 * it is built as the tool rather than the quiz: real controls, your settings
 * audible against the target's, and two exercises.
 *
 * **Match** puts a compressor on the sample and asks you to build the same
 * one. **Fix** hands you a loop whose hits are all over the place and asks you
 * to even them out, which is what a compressor is actually for.
 *
 * Loudness is matched either way - see MAKEUP below for how, and why it
 * matters more here than anywhere else in the app.
 */
/**
 * What Web Audio's compressor does to the loudness, in decibels, with no trim
 * at all - measured across the grid rather than derived, because the node
 * applies a makeup gain of its own that is in the implementation and not in
 * the arithmetic. Rows are thresholds, columns are ratios; the numbers are the
 * average of the two sources this mode offers.
 *
 * It matters because a clip that arrives louder than the one before it is a
 * level test: the answer would be "the loud one", every time, without
 * listening to a thing. Trimming it back off leaves the shape, which is what
 * is actually being asked about.
 *
 * Derived from an offline render of every cell. Re-measure if the bed changes.
 */
const MAKEUP = {
  thresholds: [-40, -32, -24, -16, -8],
  ratios: [2, 4, 8, 16],
  db: [
    [-1.09, -0.93, -0.64, -0.54],
    [0.20, 0.74, 1.25, 1.48],
    [1.31, 2.19, 2.71, 2.92],
    [1.92, 2.92, 3.44, 3.72],
    [1.18, 2.00, 2.49, 2.79],
  ],
};

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/** Where a value sits in a list: which pair it falls between, and how far. */
function between(value, list) {
  const at = clamp(value, list[0], list[list.length - 1]);
  let i = 0;
  while (i < list.length - 2 && at > list[i + 1]) i += 1;
  return { i, mix: (at - list[i]) / (list[i + 1] - list[i]) };
}

/** The measured makeup at any setting, read off the grid between the points. */
function makeupFor(threshold, ratio) {
  const row = between(threshold, MAKEUP.thresholds);
  // Ratios are heard in ratios, so the grid is walked in octaves of ratio.
  const column = between(Math.log2(ratio), MAKEUP.ratios.map(Math.log2));

  const across = (r) => MAKEUP.db[r][column.i] * (1 - column.mix) + MAKEUP.db[r][column.i + 1] * column.mix;
  return across(row.i) * (1 - row.mix) + across(row.i + 1) * row.mix;
}

const writeRatio = (ratio) => `${ratio.toFixed(ratio < 10 ? 1 : 0)} : 1`;
const writeThreshold = (db) => `${db.toFixed(0)} dB`;
const writeMs = (ms) => `${ms < 10 ? ms.toFixed(1) : ms.toFixed(0)} ms`;

/**
 * The two sources do not arrive at the same level - the full mix is some 3 dB
 * hotter than the drums alone - so each is trimmed to the same peak before the
 * compressor sees it. Without that, the threshold that is right for one source
 * is 3 dB wrong for the other, and changing what you are listening to would
 * quietly change the answer.
 *
 * Measured off the bed, going into the chain (which is ahead of the master
 * gain, so these are not the levels that come out of the speakers).
 */
const INTO_THE_CHAIN = { drums: 0.489, mix: 0.699 };
const WORKING_PEAK = 0.5;

/**
 * Where the loud hits sit once trimmed, in dBFS. The fix exercise's answer is
 * built from it: a threshold at the quiet hits and a ratio that brings the
 * loud ones down to meet them.
 */
const LOUD_PEAK_DB = Math.round(20 * Math.log10(WORKING_PEAK));

/**
 * What it actually takes to level this loop, found by rendering the grid
 * rather than by arithmetic.
 *
 * On paper a threshold at the quiet hits and a ratio of spread-over-3 should
 * do it. It does not: the detector is looking at peaks while most of a drum
 * hit's energy sits well below its peak, and the knee softens the onset on top
 * of that - so the settings that make the loop measurably even sit about 9 dB
 * lower and a good deal harder than the arithmetic says. A reference answer
 * that was merely plausible would be teaching the wrong lesson, since it is
 * what the player's own dialling is scored against.
 *
 * Measured at 9, 12 and 15 dB of unevenness; the flattest cell of each grid
 * was -24/4, -28/4 and -32/6, which these two lines pass through.
 */
const THRESHOLD_UNDER = 9;
const RATIO_FOR = (uneven) => uneven / 2.5;

const KNOB_TOLERANCE = {
  easy: { threshold: { hit: 6, near: 12 }, ratio: { hit: 1, near: 2 }, attack: { hit: 1.4, near: 2.6 } },
  medium: { threshold: { hit: 4, near: 9 }, ratio: { hit: 0.7, near: 1.5 }, attack: { hit: 1.2, near: 2.2 } },
  hard: { threshold: { hit: 3, near: 6 }, ratio: { hit: 0.5, near: 1.1 }, attack: { hit: 1, near: 1.8 } },
};

export default {
  id: 'compression',
  label: 'Compression',
  blurb: 'Set the compressor',
  lede: 'Two exercises: build the same compressor you can hear on the target, '
      + 'or take a loop whose hits are all over the place and even them out.',
  advice: 'The hardest thing here, and the plan says so: this is difficult even for people who do it for a living. Listen to the transients and to what happens between the hits.',

  settings: [
    {
      id: 'exercise',
      label: 'Exercise',
      options: [
        { id: 'match', label: 'Match the target' },
        { id: 'fix', label: 'Even out the loop' },
      ],
    },
    {
      id: 'source',
      label: 'Source',
      options: [
        { id: 'drums', label: 'Drums' },
        { id: 'mix', label: 'Full mix' },
      ],
    },
  ],

  tiers: {
    easy: { label: 'Easy', blurb: 'Threshold and ratio, roughly', guesses: 4, attack: false },
    medium: { label: 'Medium', blurb: 'Threshold and ratio, closer', guesses: 4, attack: false },
    hard: { label: 'Hard', blurb: 'And the attack as well', guesses: 4, attack: true },
  },

  slots(tier) {
    const tolerance = KNOB_TOLERANCE[tier];
    const slots = [
      {
        kind: 'range',
        id: 'threshold',
        heading: 'threshold',
        label: 'Where does it start working?',
        min: -48, max: 0, step: 1, start: -12,
        format: writeThreshold,
        unit: 'dB', below: 'low', above: 'high',
        ...tolerance.threshold,
      },
      {
        kind: 'range',
        id: 'ratio',
        heading: 'ratio',
        label: 'How hard, once it does?',
        min: 1.5, max: 20, log: true, start: 3,
        format: writeRatio,
        unit: 'x', below: 'soft', above: 'hard',
        ...tolerance.ratio,
      },
    ];

    if (this.tiers[tier].attack) {
      slots.push({
        kind: 'range',
        id: 'attack',
        heading: 'attack',
        narrowReading: true,
        label: 'Does it catch the transient?',
        min: 1, max: 100, log: true, start: 20,
        format: writeMs,
        unit: 'x', below: 'fast', above: 'slow',
        ...tolerance.attack,
      });
    }

    return slots;
  },

  makePuzzle(rng, tier, settings) {
    const attack = this.tiers[tier].attack ? toStep(logPick(rng, 2, 60), 0.5) : 8;

    if (settings.exercise === 'fix') {
      // The loop's hits are `uneven` dB apart; the answer is the threshold and
      // ratio that bring them back together.
      const uneven = toStep(9 + rng() * 6, 1);
      return {
        uneven,
        answer: {
          threshold: LOUD_PEAK_DB - uneven - THRESHOLD_UNDER,
          ratio: toStep(RATIO_FOR(uneven), 0.5),
          attack,
        },
      };
    }

    return {
      answer: {
        threshold: toStep(-36 + rng() * 30, 1),
        ratio: toStep(logPick(rng, 2, 16), 0.5),
        attack,
      },
    };
  },

  score(guess, answer, tier) {
    const cells = this.slots(tier).map((slot) => ({
      ...dialled(guess[slot.id], answer[slot.id], slot),
      narrow: slot.id === 'attack',
    }));

    return { correct: cells.every((cell) => cell.state === 'hit'), cells };
  },

  clues(tier, settings) {
    return settings.exercise === 'fix'
      ? [
        { id: 'mine', label: 'Play yours', primary: true },
        { id: 'raw', label: 'Untreated' },
      ]
      : [
        { id: 'target', label: 'Play the target', primary: true },
        { id: 'mine', label: 'Play yours' },
        { id: 'flat', label: 'Bypass' },
      ];
  },

  /** A compressor from whatever settings it is handed, loudness put back. */
  compressor(engine, { threshold, ratio, attack }, into) {
    const node = engine.ctx.createDynamicsCompressor();
    node.threshold.value = threshold;
    node.knee.value = 6;
    node.ratio.value = ratio;
    node.attack.value = attack / 1000;
    node.release.value = 0.16;

    const trim = engine.ctx.createGain();
    trim.gain.value = 10 ** (-makeupFor(threshold, ratio) / 20);

    node.connect(trim).connect(into);
    return node;
  },

  /** The source, trimmed so every setting means the same thing on both. */
  levelled(engine, source, into) {
    const level = engine.ctx.createGain();
    level.gain.value = WORKING_PEAK / INTO_THE_CHAIN[source];
    level.connect(into);
    return level;
  },

  play(engine, { puzzle, clue, settings, guess }) {
    engine.ensure();
    const source = settings.source;
    const bed = { seconds: 3.6, uneven: puzzle.uneven ?? 0 };

    if (clue === 'flat' || clue === 'raw') {
      engine.playBed(source, { ...bed, dest: this.levelled(engine, source, engine.out) });
      return;
    }

    const wanted = clue === 'target' ? puzzle.answer : guess;
    const chain = this.compressor(engine, wanted, engine.out);
    engine.playBed(source, { ...bed, dest: this.levelled(engine, source, chain) });
  },

  reveal(answer) {
    return {
      symbol: writeRatio(answer.ratio),
      name: `over ${writeThreshold(answer.threshold)}, ${writeMs(answer.attack)} attack`,
    };
  },

  weak(answer) {
    const hard = answer.ratio >= 8 ? 'hard ratios' : answer.ratio >= 4 ? 'working ratios' : 'gentle ratios';
    return { key: hard, label: hard };
  },
};
