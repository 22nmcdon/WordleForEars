import { ROOT_LABELS } from '../theory.js';
import { HIT, NEAR, MISS, distanceCell, pick } from './scoring.js';

const WHITE = [0, 2, 4, 5, 7, 9, 11];
const ALL = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

/** The shortest way round the circle: B to C is one semitone, not eleven. */
function semitonesApart(a, b) {
  const straight = Math.abs(a - b) % 12;
  return Math.min(straight, 12 - straight);
}

export default {
  id: 'pitch',
  label: 'Pitch',
  blurb: 'Name the note you heard',
  lede: 'A single note. Name it — with a reference tone if you want one, '
      + 'which makes it relative pitch, or without, which does not.',

  tiers: {
    easy: { label: 'Easy', blurb: 'White notes', guesses: 3, notes: WHITE },
    medium: { label: 'Medium', blurb: 'All twelve', guesses: 4, notes: ALL },
    hard: { label: 'Hard', blurb: 'All twelve, one octave up', guesses: 4, notes: ALL, octave: 5 },
  },

  setting: {
    id: 'reference',
    label: 'Reference',
    options: [
      { id: 'offered', label: 'Middle C on tap' },
      { id: 'none', label: 'No reference' },
    ],
  },

  slots(tier) {
    return [{
      id: 'note',
      heading: 'note',
      label: 'Which note was it?',
      options: this.tiers[tier].notes.map((pc) => ({ id: String(pc), symbol: ROOT_LABELS[pc] })),
    }];
  },

  makePuzzle(rng, tier) {
    const spec = this.tiers[tier];
    return {
      answer: { note: String(pick(rng, spec.notes)) },
      octave: spec.octave ?? 4,
    };
  },

  score(guess, answer) {
    const apart = semitonesApart(Number(guess.note), Number(answer.note));
    return {
      correct: apart === 0,
      cells: [
        { state: apart === 0 ? HIT : apart <= 2 ? NEAR : MISS, text: ROOT_LABELS[Number(guess.note)] },
        distanceCell(apart, 'semitone'),
      ],
    };
  },

  clues(tier, setting) {
    const clues = [{ id: 'note', label: 'Play the note', primary: true }];
    // Offering middle C is the difference between relative pitch and absolute,
    // so it is the player's choice to make rather than the tier's.
    if (setting === 'offered') clues.push({ id: 'reference', label: 'Reference C' });
    return clues;
  },

  play(engine, puzzle, clue) {
    if (clue === 'reference') {
      engine.tone(60, engine.start, 1.2);
      return;
    }
    engine.playNotes([12 * (puzzle.octave + 1) + Number(puzzle.answer.note)], { duration: 2.2 });
  },

  reveal(answer) {
    return { symbol: ROOT_LABELS[Number(answer.note)], name: '' };
  },

  weak(answer) {
    return { key: answer.note, label: ROOT_LABELS[Number(answer.note)] };
  },
};
