import { dialled, logPick, toStep, toThirdOctave, pick } from './scoring.js';

/** Hertz, written the way a plugin writes it. */
export function writeHz(hz) {
  return hz >= 1000 ? `${(hz / 1000).toFixed(hz >= 10000 ? 0 : 1)} kHz` : `${Math.round(hz)} Hz`;
}

const writeDb = (db) => `${db > 0 ? '+' : ''}${db.toFixed(1).replace(/\.0$/, '')} dB`;

/** Where things go wrong, and what an engineer calls it when they do. */
const TROUBLE = [
  { low: 150, high: 400, name: 'mud' },
  { low: 400, high: 900, name: 'boxiness' },
  { low: 1200, high: 2500, name: 'honk' },
  { low: 3000, high: 6500, name: 'harshness' },
];

const BAND_TOLERANCE = {
  easy: { frequency: { hit: 0.5, near: 1.5 }, gain: { hit: 2, near: 5 }, q: { hit: 0.6, near: 1.4 } },
  medium: { frequency: { hit: 0.35, near: 1 }, gain: { hit: 1.5, near: 3.5 }, q: { hit: 0.5, near: 1.2 } },
  hard: { frequency: { hit: 0.25, near: 0.7 }, gain: { hit: 1, near: 2.5 }, q: { hit: 0.4, near: 1 } },
};

export default {
  id: 'eq',
  label: 'EQ',
  blurb: 'Dial the move in',
  lede: 'Not multiple choice: the EQ is yours to dial. Move the band until '
      + 'yours sits on the target — or until the problem in the sample goes away.',

  settings: [
    {
      id: 'exercise',
      label: 'Exercise',
      options: [
        { id: 'match', label: 'Match the target' },
        { id: 'fix', label: 'Fix the sample' },
      ],
    },
    {
      id: 'source',
      label: 'Source',
      options: [
        { id: 'mix', label: 'Full mix' },
        { id: 'instrument', label: 'One instrument' },
      ],
    },
  ],

  tiers: {
    easy: { label: 'Easy', blurb: 'Wide and obvious', guesses: 4, q: false, extreme: [7, 11] },
    medium: { label: 'Medium', blurb: 'Narrower, and the Q is yours too', guesses: 4, q: true, extreme: [4, 7] },
    hard: { label: 'Hard', blurb: 'Surgical, and barely there', guesses: 4, q: true, extreme: [2, 4] },
  },

  slots(tier) {
    const tolerance = BAND_TOLERANCE[tier];
    const slots = [
      {
        kind: 'range',
        id: 'frequency',
        heading: 'frequency',
        label: 'Where is it?',
        min: 50, max: 12000, log: true, start: 1000,
        format: writeHz,
        unit: 'oct', below: 'low', above: 'high',
        ...tolerance.frequency,
      },
      {
        kind: 'range',
        id: 'gain',
        heading: 'gain',
        label: 'How much, and which way?',
        min: -12, max: 12, step: 0.5, start: 0,
        format: writeDb,
        unit: 'dB', decimals: 1, below: 'shy', above: 'hot',
        ...tolerance.gain,
      },
    ];

    if (this.tiers[tier].q) {
      slots.push({
        kind: 'range',
        id: 'q',
        heading: 'Q',
        narrowReading: true,
        label: 'How wide?',
        min: 0.5, max: 8, log: true, start: 1.4,
        format: (q) => `Q ${q.toFixed(1)}`,
        unit: 'x', below: 'wide', above: 'tight',
        ...tolerance.q,
      });
    }

    return slots;
  },

  makePuzzle(rng, tier, settings) {
    const spec = this.tiers[tier];
    const [least, most] = spec.extreme;
    const size = toStep(least + rng() * (most - least), 0.5);
    const q = spec.q ? toStep(logPick(rng, 0.8, 4), 0.1) : 1.2;

    if (settings.exercise === 'fix') {
      // Something is wrong with the sample and the fix is to take it out: the
      // answer is the inverse of the fault, which is what subtractive EQ is.
      const zone = pick(rng, TROUBLE);
      const frequency = toThirdOctave(logPick(rng, zone.low, zone.high));
      return {
        answer: { frequency, gain: -size, q },
        fault: { frequency, gain: size, q, name: zone.name },
      };
    }

    return {
      answer: {
        frequency: toThirdOctave(logPick(rng, 80, 8000)),
        gain: (rng() < 0.5 ? -1 : 1) * size,
        q,
      },
    };
  },

  score(guess, answer, tier) {
    const cells = this.slots(tier).map((slot) => ({
      ...dialled(guess[slot.id], answer[slot.id], slot),
      narrow: slot.id === 'q',
    }));

    // Landing every control inside its tight window is the whole exercise.
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
        { id: 'flat', label: 'Flat' },
      ];
  },

  /** One peaking band, built from whatever settings it is handed. */
  band(engine, { frequency, gain, q }, into) {
    const filter = engine.ctx.createBiquadFilter();
    filter.type = 'peaking';
    filter.frequency.value = frequency;
    filter.Q.value = q;
    filter.gain.value = gain;
    filter.connect(into);
    return filter;
  },

  play(engine, { puzzle, clue, settings, guess }) {
    engine.ensure();
    const source = settings.source;

    if (clue === 'flat') {
      engine.playBed(source, { seconds: 4 });
      return;
    }

    // In the fix exercise the fault is in the sample, so everything but the
    // untreated clue is heard through it - which is what makes a correct cut
    // sound like the fault simply going away.
    const faulty = (into) => (puzzle.fault ? this.band(engine, puzzle.fault, into) : into);

    if (clue === 'raw') {
      engine.playBed(source, { seconds: 4, dest: faulty(engine.out) });
      return;
    }

    const settingsToPlay = clue === 'target' ? puzzle.answer : guess;
    const mine = this.band(engine, settingsToPlay, engine.out);
    engine.playBed(source, { seconds: 4, dest: faulty(mine) });
  },

  reveal(answer) {
    return {
      symbol: writeHz(answer.frequency),
      name: `${writeDb(answer.gain)}, Q ${answer.q.toFixed(1)}`,
    };
  },

  weak(answer) {
    const zone = TROUBLE.find((t) => answer.frequency >= t.low && answer.frequency < t.high);
    return { key: String(Math.round(answer.frequency)), label: zone ? zone.name : writeHz(answer.frequency) };
  },
};
