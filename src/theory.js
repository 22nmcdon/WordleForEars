// Core music-theory data for the Chords mode.
// Tiers mirror the project plan: Easy = triads, Medium = 6th/7th chords,
// Hard = clean extensions and altered dominants.

export const PITCH_CLASSES = [
  'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B',
];

// Display names keep the enharmonic spelling players expect on a keyboard.
export const ROOT_LABELS = [
  'C', 'C♯/D♭', 'D', 'D♯/E♭', 'E', 'F', 'F♯/G♭', 'G', 'G♯/A♭', 'A', 'A♯/B♭', 'B',
];

// Every quality is a set of semitone offsets from the root.
export const QUALITIES = {
  major: { label: 'Major', symbol: '', intervals: [0, 4, 7] },
  minor: { label: 'Minor', symbol: 'm', intervals: [0, 3, 7] },
  augmented: { label: 'Augmented', symbol: 'aug', intervals: [0, 4, 8] },
  diminished: { label: 'Diminished', symbol: 'dim', intervals: [0, 3, 6] },
  sus2: { label: 'Sus2', symbol: 'sus2', intervals: [0, 2, 7] },
  sus4: { label: 'Sus4', symbol: 'sus4', intervals: [0, 5, 7] },

  dom7: { label: 'Dominant 7', symbol: '7', intervals: [0, 4, 7, 10] },
  min7: { label: 'Minor 7', symbol: 'm7', intervals: [0, 3, 7, 10] },
  maj7: { label: 'Major 7', symbol: 'maj7', intervals: [0, 4, 7, 11] },
  mM7: { label: 'Minor-major 7', symbol: 'mM7', intervals: [0, 3, 7, 11] },
  halfDim7: { label: 'Half-diminished 7', symbol: 'm7♭5', intervals: [0, 3, 6, 10] },
  dim7: { label: 'Diminished 7', symbol: 'dim7', intervals: [0, 3, 6, 9] },
  min6: { label: 'Minor 6', symbol: 'm6', intervals: [0, 3, 7, 9] },
  maj6: { label: 'Major 6', symbol: '6', intervals: [0, 4, 7, 9] },
  sus7: { label: 'Dominant 7 sus4', symbol: '7sus4', intervals: [0, 5, 7, 10] },
  add9: { label: 'Add 9', symbol: 'add9', intervals: [0, 2, 4, 7] },

  dom9: { label: 'Dominant 9', symbol: '9', intervals: [0, 4, 7, 10, 14] },
  maj9: { label: 'Major 9', symbol: 'maj9', intervals: [0, 4, 7, 11, 14] },
  min9: { label: 'Minor 9', symbol: 'm9', intervals: [0, 3, 7, 10, 14] },
  min11: { label: 'Minor 11', symbol: 'm11', intervals: [0, 3, 7, 10, 14, 17] },
  dom13: { label: 'Dominant 13', symbol: '13', intervals: [0, 4, 7, 10, 14, 21] },
  dom7b9: { label: 'Dominant 7♭9', symbol: '7♭9', intervals: [0, 4, 7, 10, 13] },
  dom7s9: { label: 'Dominant 7♯9', symbol: '7♯9', intervals: [0, 4, 7, 10, 15] },
  dom7s5: { label: 'Dominant 7♯5', symbol: '7♯5', intervals: [0, 4, 8, 10] },
  dom7s5s9: { label: 'Dominant 7♯5♯9', symbol: '7♯5♯9', intervals: [0, 4, 8, 10, 15] },
  maj7s11: { label: 'Major 7♯11', symbol: 'maj7♯11', intervals: [0, 4, 7, 11, 18] },
};

/**
 * `guesses` is enough to deduce and not enough to enumerate: three of six on
 * Easy, four of ten further up. A tier you can simply work through by pressing
 * every button is not an ear test.
 */
export const TIERS = {
  easy: {
    label: 'Easy',
    blurb: 'Triads',
    guesses: 3,
    qualities: ['major', 'minor', 'augmented', 'diminished', 'sus2', 'sus4'],
  },
  medium: {
    label: 'Medium',
    blurb: '6th & 7th chords',
    guesses: 4,
    qualities: ['dom7', 'min7', 'maj7', 'mM7', 'halfDim7', 'dim7', 'min6', 'maj6', 'sus7', 'add9'],
  },
  hard: {
    label: 'Hard',
    blurb: 'Extensions & altered dominants',
    guesses: 4,
    qualities: [
      'dom9', 'maj9', 'min9', 'min11', 'dom13',
      'dom7b9', 'dom7s9', 'dom7s5', 'dom7s5s9', 'maj7s11',
    ],
  },
};

export const VOICINGS = {
  root: { label: 'Root position', blurb: 'Closed, root on the bottom' },
  inversion: { label: 'Inversions', blurb: '1st / 2nd inversion' },
  open: { label: 'Open voicings', blurb: 'Drop-2 style spread' },
};

export function qualityLabel(quality) {
  return QUALITIES[quality].label;
}

export function rootLabel(pitchClass) {
  return ROOT_LABELS[((pitchClass % 12) + 12) % 12];
}

/** Human-readable chord name, e.g. "A♯/B♭ m7♭5". */
export function chordName({ root, quality }) {
  const symbol = QUALITIES[quality].symbol;
  return symbol ? `${rootLabel(root)} ${symbol}` : `${rootLabel(root)} major`;
}

/**
 * What a quality is made of, as pitch classes above its root - the shape of the
 * chord with the root taken away, which is the whole of what this mode asks
 * about. Folded into an octave, so a 9th and a 2nd are the one note they sound
 * like, and a 13th and a 6th likewise.
 */
export function shapeOf(quality) {
  return new Set(
    QUALITIES[quality].intervals.slice(1).map((interval) => interval % 12),
  );
}

/** The pitch classes (0-11) a chord contains, order-independent. */
export function chordPitchClasses({ root, quality }) {
  return new Set(QUALITIES[quality].intervals.map((i) => (root + i) % 12));
}

/**
 * Turn a chord into concrete MIDI notes for the synth.
 * `voicing` reshuffles the notes without changing the pitch-class content.
 */
export function voiceChord({ root, quality }, voicing = 'root', octave = 4, spin = 0) {
  const intervals = QUALITIES[quality].intervals;
  const base = 12 * (octave + 1) + root; // MIDI: C4 = 60
  let notes = intervals.map((i) => base + i);

  if (voicing === 'inversion') {
    const lifts = (spin % (intervals.length - 1)) + 1;
    notes = notes.map((n, i) => (i < lifts ? n + 12 : n));
  } else if (voicing === 'open' && notes.length > 2) {
    // Drop-2: the second note from the top falls an octave, opening the voicing.
    notes[notes.length - 2] -= 12;
  }

  return notes.sort((a, b) => a - b);
}
