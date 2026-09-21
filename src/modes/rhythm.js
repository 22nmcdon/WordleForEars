import { HIT, NEAR, MISS, pick } from './scoring.js';

/**
 * Two bars of 4/4, as the beat positions the strikes land on. Written where
 * they are played: a swung eighth sits two thirds of the way through the beat,
 * which is what swinging one means.
 */
const every = (step, bars = 2) => {
  const hits = [];
  for (let at = 0; at < bars * 4; at += step) hits.push(at);
  return hits;
};

const swung = () => {
  const hits = [];
  for (let beat = 0; beat < 8; beat += 1) hits.push(beat, beat + 2 / 3);
  return hits;
};

const PATTERNS = {
  halves: { symbol: 'Halves', feel: 'straight', name: 'Half notes', beats: every(2) },
  quarters: { symbol: 'Quarters', feel: 'straight', name: 'On the beat', beats: every(1) },
  eighths: { symbol: '8ths', feel: 'straight', name: 'Straight eighths', beats: every(0.5) },
  sixteenths: { symbol: '16ths', feel: 'straight', name: 'Sixteenths', beats: every(0.25) },
  triplets: { symbol: 'Triplets', feel: 'straight', name: 'Eighth triplets', beats: every(1 / 3) },
  swing: { symbol: 'Swung', feel: 'swung', name: 'Swung eighths', beats: swung() },
  offbeat: { symbol: 'Offbeats', feel: 'syncopated', name: 'Upbeats only', beats: every(1).map((b) => b + 0.5) },
  charleston: { symbol: 'Charleston', feel: 'syncopated', name: 'One and the and of two', beats: [0, 1.5, 4, 5.5] },
  clave32: { symbol: 'Clave 3-2', feel: 'syncopated', name: 'Son clave, three side first', beats: [0, 1.5, 3, 5, 6] },
  clave23: { symbol: 'Clave 2-3', feel: 'syncopated', name: 'Son clave, two side first', beats: [1, 2, 4, 5.5, 7] },
  three: { symbol: '3 : 2', feel: 'polyrhythm', name: 'Three over two', beats: every(4 / 3) },
  four: { symbol: '4 : 3', feel: 'polyrhythm', name: 'Four over three', beats: every(0.75) },
};

const tier = (label, blurb, guesses, patterns) => ({ label, blurb, guesses, patterns });

export default {
  id: 'rhythm',
  label: 'Rhythm',
  blurb: 'What is it playing',
  lede: 'Four counted in, then a figure over two bars. Name the figure — '
      + 'and the second column says whether you at least had the feel.',

  tiers: {
    easy: tier('Easy', 'Subdivisions', 3, ['halves', 'quarters', 'eighths', 'sixteenths']),
    medium: tier('Medium', 'Straight against swung', 4,
                 ['quarters', 'eighths', 'triplets', 'swing', 'offbeat', 'sixteenths']),
    hard: tier('Hard', 'Syncopation and polyrhythm', 4,
               ['eighths', 'swing', 'charleston', 'clave32', 'clave23', 'three', 'four']),
  },

  settings: [{
    id: 'tempo',
    label: 'Tempo',
    options: [
      { id: '84', label: '84 bpm' },
      { id: '104', label: '104 bpm' },
      { id: '132', label: '132 bpm' },
    ],
  }],

  slots(tierId) {
    return [{
      id: 'pattern',
      heading: 'figure',
      label: 'What is it playing?',
      options: this.tiers[tierId].patterns.map((id) => ({
        id, symbol: PATTERNS[id].symbol, name: PATTERNS[id].feel,
      })),
    }];
  },

  makePuzzle(rng, tierId) {
    return { answer: { pattern: pick(rng, this.tiers[tierId].patterns) } };
  },

  score(guess, answer) {
    const guessed = PATTERNS[guess.pattern];
    const actual = PATTERNS[answer.pattern];
    const correct = guess.pattern === answer.pattern;
    const sameFeel = guessed.feel === actual.feel;

    return {
      correct,
      cells: [
        { state: correct ? HIT : sameFeel ? NEAR : MISS, text: guessed.symbol },
        { state: sameFeel ? HIT : MISS, text: guessed.feel, narrow: true },
      ],
    };
  },

  clues() {
    return [{ id: 'play', label: 'Play the figure', primary: true }];
  },

  play(engine, { puzzle, settings }) {
    engine.playPattern(PATTERNS[puzzle.answer.pattern].beats, { bpm: Number(settings.tempo) });
  },

  reveal(answer) {
    return { symbol: PATTERNS[answer.pattern].symbol, name: PATTERNS[answer.pattern].name.toLowerCase() };
  },

  weak(answer) {
    return { key: answer.pattern, label: PATTERNS[answer.pattern].name };
  },
};
