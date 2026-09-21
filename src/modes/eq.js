import { newStrip, curveOf, logFrequencies, writeHz } from '../eq/filters.js';
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
 * The frequencies a curve is judged on: where the ear is, at the spacing the
 * ear hears. Below 30 and above 16k there is little to hear and a great deal
 * of room to be wrong in, which would flatter or punish a guess for nothing.
 */
const JUDGED = logFrequencies(96, 30, 16000);

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
    const mine = curveOf(guess, JUDGED, rate);
    const theirs = curveOf(answer, JUDGED, rate);

    let worst = 0;
    let worstAt = 0;

    for (let i = 0; i < JUDGED.length; i += 1) {
      const off = mine[i] - theirs[i];
      if (Math.abs(off) > Math.abs(worst)) {
        worst = off;
        worstAt = JUDGED[i];
      }
    }

    const error = Math.abs(worst);
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
    };
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
      reveal: () => {
        plugin.showTarget(fix
          ? [{ ...puzzle.fault, gain: -puzzle.fault.gain }]
          : puzzle.answer);
        plugin.lock();
      },
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
