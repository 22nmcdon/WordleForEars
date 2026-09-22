import { curveReading, writeHz } from '../eq/filters.js';
import { distance } from '../gap.js';
import { HIT, NEAR, MISS, logPick, toStep, toThirdOctave, pick } from './scoring.js';

/**
 * What you do with an EQ, as opposed to what an EQ is.
 *
 * The other half of what used to be one mode file. An exercise here knows
 * about answers, tolerances and what counts as close; it knows nothing about
 * canvases, and it never mounts anything. Setting a tool up is
 * `src/bench/session.js`'s job, and what it needs is the four small functions
 * at the top of each exercise - where the material comes from, what is on the
 * other side of the A/B, what fault is in the sample, and what the answer is.
 */

const writeDb = (db) => `${db > 0 ? '+' : ''}${db.toFixed(1).replace(/\.0$/, '')} dB`;

/** Where things go wrong, and what an engineer calls it when they do. */
const TROUBLE = [
  { low: 150, high: 400, name: 'mud' },
  { low: 400, high: 900, name: 'boxiness' },
  { low: 1200, high: 2500, name: 'honk' },
  { low: 3000, high: 6500, name: 'harshness' },
];

/**
 * How far the two curves may part company, at their worst point, and still
 * count as matched.
 *
 * The worst point rather than the average: averaged across the spectrum, a
 * single band is a small part of a wide range, so doing nothing at all scored
 * about two decibels and very nearly passed. What "matched" means to anyone
 * looking at two curves is that they sit on each other everywhere, which is
 * exactly what the largest gap between them measures.
 */
const CLOSE_ENOUGH = { easy: 2.5, medium: 1.8, hard: 1.2 };

/**
 * The two exercises, in the shape a session can set up.
 *
 * This is the descriptor that used to be spelled out inside `mount` - the
 * source, the A/B's name, the fault and the target - and having it as data is
 * what lets one tool be handed from one exercise to the next without being
 * destroyed in between.
 */
export const EQ_EXERCISES = {
  match: {
    id: 'match',
    label: 'Match the target',
    source: 'mix',
    other: 'Target',
    faultOf: () => null,
    targetOf: (puzzle) => puzzle.answer,
    answerOf: (puzzle) => puzzle.answer,
  },
  fix: {
    id: 'fix',
    label: 'Fix the sample',
    source: 'mix',
    // In the fix exercise there is no target to hear: the other side of the
    // A/B is the sample with your EQ out of the way, which is a bypass button.
    other: 'Bypass',
    faultOf: (puzzle) => puzzle.fault,
    targetOf: () => [],
    answerOf: (puzzle) => [{ ...puzzle.fault, gain: -puzzle.fault.gain }],
  },
};

export const EQ_WORK = {
  tool: 'eq',
  opening: 'Play the loop, shape the EQ, then lock it in.',

  settings: [
    {
      id: 'exercise',
      label: 'Exercise',
      options: Object.values(EQ_EXERCISES).map(({ id, label }) => ({ id, label })),
    },
  ],

  exercises: EQ_EXERCISES,

  tiers: {
    easy: { label: 'Easy', blurb: 'One band, and a big move', guesses: 4, bands: 1, size: [7, 11] },
    medium: { label: 'Medium', blurb: 'Two bands', guesses: 4, bands: 2, size: [4, 8] },
    hard: { label: 'Hard', blurb: 'Three bands, and subtle', guesses: 4, bands: 3, size: [2.5, 5] },
  },

  /** The round is played on the tool, so there is nothing to pick from. */
  slots() {
    return [];
  },

  makePuzzle(rng, tier, settings) {
    const spec = this.tiers[tier];
    const size = () => toStep(spec.size[0] + rng() * (spec.size[1] - spec.size[0]), 0.5);

    if (settings.exercise === 'fix') {
      // The sample has a resonance in it. The answer is its inverse, which is
      // what taking a problem out of a track actually is.
      const zone = pick(rng, TROUBLE);
      const frequency = toThirdOctave(logPick(rng, zone.low, zone.high));
      const q = toStep(logPick(rng, 1.5, 5), 0.1);
      const gain = size();

      return {
        fault: { type: 'peaking', frequency, gain, q, on: true, name: zone.name },
        answer: [{ type: 'peaking', frequency, gain: -gain, q, on: true }],
      };
    }

    // A move of one to three bands, spread out so they are separately audible
    // rather than piling up in one place.
    const zones = [[60, 300], [300, 1800], [1800, 12000]];
    const answer = [];
    for (let i = 0; i < spec.bands; i += 1) {
      const [low, high] = zones[i % zones.length];
      answer.push({
        type: 'peaking',
        frequency: toThirdOctave(logPick(rng, low, high)),
        gain: (rng() < 0.5 ? -1 : 1) * size(),
        q: toStep(logPick(rng, 0.8, 3), 0.1),
        on: true,
      });
    }

    return { answer };
  },

  /**
   * How close the curve you built is to the one being asked for.
   *
   * The curve, not the settings. Two different sets of bands can make the same
   * shape - a wide cut here is a pair of narrow ones there - and an EQ that
   * marked you down for arriving by a different route would be teaching the
   * plugin rather than the ear. What is compared is what comes out.
   */
  score(state, puzzle) {
    const { answer, tier } = puzzle;
    const rate = 48000;
    // Readings rather than bare curves. The EQ cached nothing at all before
    // this - `curveOf` ran three times a frame on the display and twice more
    // here, which is five answers to one question with nothing saying they
    // agree. Now the plugin and the scorer ask the same way.
    const gap = distance(curveReading(state, rate), curveReading(answer, rate));
    const worst = gap.detail.louder;
    const worstAt = gap.detail.hz;

    const error = gap.off;
    const close = CLOSE_ENOUGH[tier];
    const mark = error <= close ? HIT : error <= close * 2.5 ? NEAR : MISS;

    return {
      correct: error <= close,
      error,
      cells: [
        { state: mark, text: `${error.toFixed(1)} dB out` },
        {
          state: mark,
          text: error <= close
            ? 'sits on it'
            : `${writeHz(worstAt)} ${worst > 0 ? 'too hot' : 'too shy'}`,
        },
      ],
      why: [
        {
          label: 'Worst point',
          value: `${error.toFixed(2)} dB, at ${writeHz(worstAt)}`,
          how: 'Both sets of bands are turned into a curve and read at 96 '
             + 'frequencies from 30 Hz to 16 kHz, spaced the way the ear hears '
             + 'them. This is the largest gap between the two, and where it is.',
        },
        {
          label: 'Which way',
          value: worst > 0 ? 'yours is louder there' : 'yours is quieter there',
          how: 'The sign of that same gap. It is the direction to move the band '
             + 'nearest that frequency, not necessarily the one you last touched.',
        },
        {
          label: 'Matched at',
          value: `${close.toFixed(1)} dB or less`,
          how: 'The worst point rather than the average, because averaged across '
             + 'the whole spectrum one band is a small part of a wide range - '
             + 'doing nothing at all measured about two decibels and very nearly '
             + 'passed. Two curves that sit on each other everywhere is what '
             + 'anybody looking at them would call matched.',
        },
      ],
    };
  },

  /**
   * The way out, in two rungs, worked out from the answer.
   *
   * The first says what kind of move it is, which is the thing people get
   * wrong first: hunting for a cut with a boost. The second narrows it to a
   * region - not a frequency, because being handed the frequency is the
   * reveal, and that has its own button.
   */
  hints(puzzle) {
    const { answer } = puzzle;
    const bands = puzzle?.fault
      ? [{ ...puzzle.fault, gain: -puzzle.fault.gain }]
      : answer;

    const cuts = bands.filter((band) => band.gain < 0).length;
    const kind = cuts === bands.length ? 'every one of them is a cut'
      : cuts === 0 ? 'every one of them is a boost'
      : `${cuts} of them ${cuts === 1 ? 'is a cut' : 'are cuts'}`;

    const where = bands
      .map((band) => {
        const f = band.frequency;
        return f < 120 ? 'down in the bass' : f < 400 ? 'in the low mids'
          : f < 1200 ? 'in the middle' : f < 4000 ? 'in the upper mids'
          : 'up in the top';
      })
      .filter((zone, i, all) => all.indexOf(zone) === i);

    const biggest = bands.reduce((a, b) => (Math.abs(b.gain) > Math.abs(a.gain) ? b : a));

    return [
      `${bands.length === 1 ? 'It is one band' : `It is ${bands.length} bands`}, and ${kind}.`,
      `The move is ${where.join(', and ')}.`,
      `The biggest of them is about ${Math.abs(biggest.gain).toFixed(0)} dB, `
        + `and ${biggest.q < 1.2 ? 'wide' : biggest.q < 3 ? 'fairly narrow' : 'very narrow'}.`,
    ];
  },
  reveal(puzzle) {
    const { answer } = puzzle;
    const bands = puzzle?.fault
      ? [{ ...puzzle.fault, gain: -puzzle.fault.gain }]
      : answer;

    return {
      symbol: bands.map((band) => writeHz(band.frequency)).join(' · '),
      name: bands.map((band) => `${writeDb(band.gain)} at Q ${band.q.toFixed(1)}`).join(', '),
    };
  },

  weak(puzzle) {
    const { answer } = puzzle;
    const band = puzzle?.fault ?? answer[0];
    const zone = TROUBLE.find((t) => band.frequency >= t.low && band.frequency < t.high);
    return { key: zone ? zone.name : writeHz(band.frequency), label: zone ? zone.name : writeHz(band.frequency) };
  },
};
