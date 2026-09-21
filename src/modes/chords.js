import { QUALITIES, TIERS, shapeOf, voiceChord, qualityLabel, rootLabel, chordName } from '../theory.js';
import { HIT, NEAR, MISS, pick } from './scoring.js';

/** A quality with no symbol of its own is still written on a chart. */
const symbolOf = (quality) => QUALITIES[quality].symbol || 'maj';

export default {
  id: 'chords',
  label: 'Chords',
  blurb: 'What kind of chord is that',
  handLettered: true, // chord symbols are the one thing set in the hand face
  lede: 'Hear a chord and name what it is — major, minor, half-diminished. '
      + 'Not what note it starts on: what kind of chord it is.',

  tiers: TIERS,

  settings: [{
    id: 'voicing',
    label: 'Voicing',
    options: [
      { id: 'root', label: 'Root position' },
      { id: 'inversion', label: 'Inversions' },
      { id: 'open', label: 'Open voicings' },
    ],
  }],

  slots(tier) {
    return [{
      id: 'quality',
      heading: 'quality',
      label: 'What kind of chord is it?',
      options: TIERS[tier].qualities.map((quality) => ({
        id: quality, symbol: symbolOf(quality), name: qualityLabel(quality),
      })),
    }];
  },

  makePuzzle(rng, tier) {
    // The root is for sounding the chord, never for guessing - and it moves
    // every puzzle, so nobody can anchor on "the daily is always in C".
    return {
      answer: {
        root: Math.floor(rng() * 12),
        quality: pick(rng, TIERS[tier].qualities),
      },
      spin: Math.floor(rng() * 3),
      octave: 3 + Math.floor(rng() * 2),
    };
  },

  /**
   * Read from the chord's shape - the notes above the root, folded into an
   * octave - so a 9th and a 2nd are the one note they sound like, and the
   * reading is the same wherever the chord happens to be rooted.
   */
  score(guess, answer) {
    const answerShape = shapeOf(answer.quality);
    const guessShape = shapeOf(guess.quality);

    let matched = 0;
    for (const note of answerShape) if (guessShape.has(note)) matched += 1;

    const correct = guess.quality === answer.quality;
    const quality = correct ? HIT : matched > 0 ? NEAR : MISS;

    return {
      correct,
      cells: [
        { state: quality, text: symbolOf(guess.quality), symbol: true },
        {
          state: matched === answerShape.size ? HIT : matched > 0 ? NEAR : MISS,
          text: `${matched}/${answerShape.size}`,
          narrow: true,
        },
      ],
    };
  },

  clues() {
    return [
      { id: 'chord', label: 'Play chord', primary: true },
      { id: 'arpeggio', label: 'Arpeggiate' },
      { id: 'reference', label: 'Reference C' },
    ];
  },

  play(engine, { puzzle, clue, settings }) {
    if (clue === 'reference') {
      engine.tone(60, engine.start, 1.2);
      return;
    }
    const notes = voiceChord(puzzle.answer, settings.voicing, puzzle.octave, puzzle.spin);
    engine.playNotes(notes, { arpeggio: clue === 'arpeggio' });
  },

  reveal(answer) {
    return { symbol: `${rootLabel(answer.root)} ${symbolOf(answer.quality)}`,
             name: qualityLabel(answer.quality).toLowerCase(),
             full: chordName(answer) };
  },

  weak(answer) {
    return { key: answer.quality, label: qualityLabel(answer.quality) };
  },
};
