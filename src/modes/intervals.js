import { HIT, NEAR, MISS, distanceCell, pick } from './scoring.js';

/** Every interval inside the octave, plus the octave itself. */
const INTERVALS = [
  { semitones: 1, short: 'm2', name: 'Minor 2nd' },
  { semitones: 2, short: 'M2', name: 'Major 2nd' },
  { semitones: 3, short: 'm3', name: 'Minor 3rd' },
  { semitones: 4, short: 'M3', name: 'Major 3rd' },
  { semitones: 5, short: 'P4', name: 'Perfect 4th' },
  { semitones: 6, short: 'TT', name: 'Tritone' },
  { semitones: 7, short: 'P5', name: 'Perfect 5th' },
  { semitones: 8, short: 'm6', name: 'Minor 6th' },
  { semitones: 9, short: 'M6', name: 'Major 6th' },
  { semitones: 10, short: 'm7', name: 'Minor 7th' },
  { semitones: 11, short: 'M7', name: 'Major 7th' },
  { semitones: 12, short: 'P8', name: 'Octave' },
];

const by = (...wanted) => INTERVALS.filter((i) => wanted.includes(i.semitones));

export default {
  id: 'intervals',
  label: 'Intervals',
  blurb: 'How far apart were they',
  lede: 'Two notes. Name the distance between them — and the distance is all '
      + 'that is asked, so it does not matter where they sit.',

  tiers: {
    // The plan's own split: the wide, consonant ones first; the ones that
    // actually take training - the semitone, the tritone, the major 7th - last.
    easy: { label: 'Easy', blurb: 'Octave, 5th, 3rds', guesses: 3, intervals: by(3, 4, 5, 7, 12) },
    medium: { label: 'Medium', blurb: 'The diatonic set', guesses: 4, intervals: by(2, 3, 4, 5, 7, 9, 10, 12) },
    hard: { label: 'Hard', blurb: 'All twelve, tritone included', guesses: 4, intervals: INTERVALS },
  },

  settings: [{
    id: 'how',
    label: 'Played',
    options: [
      { id: 'melodic', label: 'One after the other' },
      { id: 'harmonic', label: 'Both together' },
    ],
  }],

  slots(tier) {
    return [{
      id: 'interval',
      heading: 'interval',
      label: 'How far apart were they?',
      options: this.tiers[tier].intervals.map((interval) => ({
        id: String(interval.semitones), symbol: interval.short, name: interval.name,
      })),
    }];
  },

  makePuzzle(rng, tier) {
    const interval = pick(rng, this.tiers[tier].intervals);
    // The pair moves about, so the interval is the only thing to go on.
    return { answer: { interval: String(interval.semitones) }, low: 52 + Math.floor(rng() * 12) };
  },

  score(guess, answer) {
    const apart = Math.abs(Number(guess.interval) - Number(answer.interval));
    const short = INTERVALS.find((i) => i.semitones === Number(guess.interval)).short;
    return {
      correct: apart === 0,
      cells: [
        { state: apart === 0 ? HIT : apart <= 1 ? NEAR : MISS, text: short },
        distanceCell(apart, 'semitone'),
      ],
    };
  },

  clues() {
    return [
      { id: 'play', label: 'Play it', primary: true },
      { id: 'flip', label: 'The other way' },
    ];
  },

  play(engine, { puzzle, clue, settings }) {
    const low = puzzle.low;
    const high = low + Number(puzzle.answer.interval);
    // Downwards is the same interval and a different thing to hear, which is
    // why it is offered rather than being a second puzzle.
    const notes = clue === 'flip' ? [high, low] : [low, high];
    engine.playNotes(settings.how === 'harmonic' ? [low, high] : notes,
                     { arpeggio: settings.how !== 'harmonic', duration: 2 });
  },

  reveal(answer) {
    const interval = INTERVALS.find((i) => i.semitones === Number(answer.interval));
    return { symbol: interval.short, name: interval.name.toLowerCase() };
  },

  weak(answer) {
    const interval = INTERVALS.find((i) => i.semitones === Number(answer.interval));
    return { key: answer.interval, label: interval.name };
  },
};
