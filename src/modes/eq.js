import { onScale, bySign, pick } from './scoring.js';

/** Hertz, written the way a plugin writes it. */
const hz = (frequency) => (frequency >= 1000 ? `${(frequency / 1000).toFixed(frequency % 1000 ? 1 : 0)}k` : String(frequency));

const band = (frequency, name) => ({ id: String(frequency), frequency, symbol: `${hz(frequency)} Hz`, name });
const move = (db) => ({
  id: String(db),
  db,
  symbol: `${db > 0 ? '+' : ''}${db} dB`,
  name: Math.abs(db) >= 8 ? (db > 0 ? 'big boost' : 'big cut')
      : Math.abs(db) >= 5 ? (db > 0 ? 'boost' : 'cut')
      : (db > 0 ? 'nudge up' : 'nudge down'),
});

export default {
  id: 'eq',
  label: 'EQ',
  blurb: 'Where did the move happen',
  lede: 'The same few bars, once flat and once with one band moved. '
      + 'Say where it happened, and how far.',

  tiers: {
    easy: {
      label: 'Easy',
      blurb: 'Five zones, wide, extreme',
      guesses: 3,
      q: 0.8,
      bands: [band(80, 'bass'), band(250, 'low-mid'), band(800, 'mid'), band(3000, 'high-mid'), band(8000, 'treble')],
      moves: [move(10), move(-10)],
    },
    medium: {
      label: 'Medium',
      blurb: 'Seven zones, narrower, moderate',
      guesses: 4,
      q: 1.6,
      bands: [band(60, 'sub'), band(150, 'low'), band(400, 'low-mid'), band(1000, 'mid'),
              band(2500, 'presence'), band(5000, 'high-mid'), band(10000, 'air')],
      moves: [move(6), move(3), move(-3), move(-6)],
    },
    hard: {
      label: 'Hard',
      blurb: 'Nine zones, surgical, subtle',
      guesses: 4,
      q: 3.5,
      bands: [band(50, 'sub'), band(120, 'low'), band(300, 'low-mid'), band(700, 'mid'),
              band(1500, 'upper-mid'), band(3000, 'presence'), band(6000, 'high-mid'),
              band(9000, 'brilliance'), band(12000, 'air')],
      moves: [move(4), move(2), move(-2), move(-4)],
    },
  },

  setting: {
    id: 'source',
    label: 'Source',
    options: [
      { id: 'mix', label: 'Full mix' },
      { id: 'instrument', label: 'One instrument' },
    ],
  },

  slots(tier) {
    const spec = this.tiers[tier];
    return [
      { id: 'band', heading: 'band', label: 'Which band moved?', options: spec.bands },
      { id: 'move', heading: 'move', label: 'Which way, and how far?', options: spec.moves },
    ];
  },

  makePuzzle(rng, tier) {
    const spec = this.tiers[tier];
    return {
      answer: {
        band: pick(rng, spec.bands).id,
        move: pick(rng, spec.moves).id,
      },
    };
  },

  score(guess, answer, tier) {
    const bands = this.tiers[tier].bands;
    const guessed = bands.findIndex((b) => b.id === guess.band);
    const actual = bands.findIndex((b) => b.id === answer.band);

    // Octaves, not zones: how far off a guess is depends on the ear, and the
    // ear hears frequency in ratios. Two zones apart down low is a long way;
    // two zones apart up top is barely a move.
    //
    // It wears the band's own colour rather than a threshold of its own. The
    // zones are not evenly spaced - the gap from 80 to 250 is two thirds of an
    // octave wider than the gap from 3k to 8k - so any fixed number of octaves
    // would have called the next zone along "close" up top and "not close"
    // down low, in the same row, next to a cell already saying otherwise.
    const away = Math.abs(Math.log2(Number(guess.band) / Number(answer.band)));
    const band = onScale(guessed, actual);

    return {
      correct: guess.band === answer.band && guess.move === answer.move,
      cells: [
        { state: band, text: `${hz(Number(guess.band))} Hz` },
        { state: bySign(Number(guess.move), Number(answer.move)),
          text: `${Number(guess.move) > 0 ? '+' : ''}${guess.move} dB` },
        { state: band, text: away < 0.1 ? 'spot on' : `${away.toFixed(1)} oct`, narrow: true },
      ],
    };
  },

  clues() {
    return [
      { id: 'moved', label: 'Play the move', primary: true },
      { id: 'flat', label: 'Flat' },
    ];
  },

  play(engine, puzzle, clue, setting, tier) {
    engine.ensure();

    if (clue === 'flat') {
      engine.playBed(setting, { seconds: 4 });
      return;
    }

    const filter = engine.ctx.createBiquadFilter();
    filter.type = 'peaking';
    filter.frequency.value = Number(puzzle.answer.band);
    filter.Q.value = this.tiers[tier].q;
    filter.gain.value = Number(puzzle.answer.move);
    filter.connect(engine.out);

    engine.playBed(setting, { seconds: 4, dest: filter });
  },

  reveal(answer) {
    const db = Number(answer.move);
    return {
      symbol: `${hz(Number(answer.band))} Hz`,
      name: `${Math.abs(db)} dB ${db > 0 ? 'boost' : 'cut'}`,
    };
  },

  weak(answer) {
    return { key: answer.band, label: `${hz(Number(answer.band))} Hz` };
  },
};
