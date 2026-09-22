import { newStrip, curveReading, writeHz } from '../eq/filters.js';
import { distance } from '../gap.js';
import { EQPlugin } from '../eq/plugin.js';
import { HIT, NEAR, MISS, logPick, toStep, toThirdOctave, pick } from './scoring.js';

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

export default {
  id: 'eq',
  label: 'EQ',
  blurb: 'Shape it until it matches',
  surface: true,
  lede: 'A channel EQ, and a loop running through it. Drag the bands until '
      + 'yours sounds like the target — or until the problem in the sample is gone.',
  opening: 'Play the loop, shape the EQ, then lock it in.',

  help: [
    ['Play the loop, then shape the EQ.',
     'Drag a band to move it; the wheel over a band is its Q; the buttons under the '
     + 'display turn one on and off. Yours and the other side swap instantly, so you '
     + 'can flip while it runs.'],
    ['Any band can be any kind of band.',
     'Peak, shelf or cut, chosen under the display - and a cut can be 12, 24 or 48 dB '
     + 'an octave. Six bands that can each be anything is a parametric EQ rather than '
     + 'a tone control.'],
    ['It can be typed, and it can be nudged.',
     'The numbers under the sliders are fields: 3.15k, 3150 and 3k15 are all the same '
     + 'frequency. With the display focused, the arrow keys move the selected band a '
     + 'semitone and half a decibel at a time, shift makes them fine, and the bracket '
     + 'keys are Q.'],
    ['The analyser is a picture, not a reading.',
     'Tilt it three decibels an octave and a balanced mix reads level instead of '
     + 'sloping away, so what stands out is what actually stands out. Peak hold catches '
     + 'the resonance that only shows itself on one note of the bar. Neither changes '
     + 'the sound or the marking.'],
    ['You are judged on the curve, not the controls.',
     'Two different sets of bands that make the same shape are the same answer - what is '
     + 'compared is what comes out.'],
  ],

  settings: [
    {
      id: 'exercise',
      label: 'Exercise',
      options: [
        { id: 'match', label: 'Match the target' },
        { id: 'fix', label: 'Fix the sample' },
      ],
    },
  ],

  tiers: {
    easy: { label: 'Easy', blurb: 'One band, and a big move', guesses: 4, bands: 1, size: [7, 11] },
    medium: { label: 'Medium', blurb: 'Two bands', guesses: 4, bands: 2, size: [4, 8] },
    hard: { label: 'Hard', blurb: 'Three bands, and subtle', guesses: 4, bands: 3, size: [2.5, 5] },
  },

  /** The round is played on the plugin, so there is nothing to pick from. */
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
  score(guess, answer, tier) {
    const rate = 48000;
    // Readings rather than bare curves. The EQ cached nothing at all before
    // this - `curveOf` ran three times a frame on the display and twice more
    // here, which is five answers to one question with nothing saying they
    // agree. Now the plugin and the scorer ask the same way.
    const gap = distance(curveReading(guess, rate), curveReading(answer, rate));
    const worst = gap.detail.louder;
    const worstAt = gap.detail.hz;

    const error = gap.off;
    const close = CLOSE_ENOUGH[tier];
    const state = error <= close ? HIT : error <= close * 2.5 ? NEAR : MISS;

    return {
      correct: error <= close,
      error,
      cells: [
        { state, text: `${error.toFixed(1)} dB out` },
        {
          state,
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
  hints(answer, tier, puzzle) {
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

  /* ---------- the surface ---------- */

  mount(el, { engine, puzzle, onChange }) {
    const bands = newStrip();
    const fix = puzzle.settings.exercise === 'fix';

    const plugin = new EQPlugin(el, { engine, bands, onChange, source: fix ? 'mix' : 'mix' });
    plugin.setFault(fix ? puzzle.fault : null);
    plugin.setTarget(fix ? [] : puzzle.answer);
    // In the fix exercise there is no target to hear: the other side of the
    // A/B is the sample with your EQ out of the way, which is what a bypass
    // button is for.
    plugin.nameOther(fix ? 'Bypass' : 'Target');

    return {
      guess: () => bands.map((band) => ({ ...band })),
      reveal: ({ live = false } = {}) => {
        plugin.showTarget(fix
          ? [{ ...puzzle.fault, gain: -puzzle.fault.gain }]
          : puzzle.answer);
        // Shown on request rather than at the end of the round: the target is
        // drawn over yours and the bands stay draggable, so you can hear your
        // way onto it instead of only being told where it was.
        if (!live) plugin.lock();
      },
      unlock: () => plugin.unlock(),
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
    const bands = puzzle?.fault
      ? [{ ...puzzle.fault, gain: -puzzle.fault.gain }]
      : answer;

    return {
      symbol: bands.map((band) => writeHz(band.frequency)).join(' · '),
      name: bands.map((band) => `${writeDb(band.gain)} at Q ${band.q.toFixed(1)}`).join(', '),
    };
  },

  weak(answer, puzzle) {
    const band = puzzle?.fault ?? answer[0];
    const zone = TROUBLE.find((t) => band.frequency >= t.low && band.frequency < t.high);
    return { key: zone ? zone.name : writeHz(band.frequency), label: zone ? zone.name : writeHz(band.frequency) };
  },
};
