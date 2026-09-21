import test from 'node:test';
import assert from 'node:assert/strict';

import {
  QUALITIES, TIERS, chordPitchClasses, chordName, voiceChord,
} from '../src/theory.js';
import {
  HIT, NEAR, MISS, MAX_GUESSES, scoreGuess, notesState,
  createGame, submitGuess, makePuzzle, dailySeed,
} from '../src/game.js';
import { mulberry32, hashSeed, puzzleNumber, dayKey } from '../src/random.js';
import { shareText } from '../src/share.js';

const C = 0; const E = 4; const G = 7; const A = 9;

test('every quality starts on the root and has unique intervals', () => {
  for (const [id, q] of Object.entries(QUALITIES)) {
    assert.equal(q.intervals[0], 0, `${id} must include the root`);
    assert.equal(new Set(q.intervals).size, q.intervals.length, `${id} has duplicates`);
    assert.ok(q.intervals.every((i, n) => n === 0 || i > q.intervals[n - 1]), `${id} unsorted`);
  }
});

test('tiers only reference qualities that exist', () => {
  for (const tier of Object.values(TIERS)) {
    for (const q of tier.qualities) assert.ok(QUALITIES[q], `unknown quality ${q}`);
  }
});

test('exact guess scores green across the board', () => {
  const s = scoreGuess({ root: C, quality: 'major' }, { root: C, quality: 'major' });
  assert.equal(s.root, HIT);
  assert.equal(s.quality, HIT);
  assert.deepEqual(s.notes, { matched: 3, total: 3 });
  assert.ok(s.correct);
});

test('a note that is in the chord but not its root scores yellow', () => {
  // C major (C E G) guessed against A minor (A C E): C is present, not the root.
  const s = scoreGuess({ root: C, quality: 'major' }, { root: A, quality: 'minor' });
  assert.equal(s.root, NEAR);
  assert.equal(s.notes.matched, 2);
  assert.ok(!s.correct);
});

test('a root outside the chord scores grey', () => {
  const s = scoreGuess({ root: 1, quality: 'major' }, { root: C, quality: 'major' });
  assert.equal(s.root, MISS);
});

test('qualities sharing an interval score yellow, unrelated ones grey', () => {
  const near = scoreGuess({ root: C, quality: 'major' }, { root: C, quality: 'minor' });
  assert.equal(near.quality, NEAR, 'major and minor share the fifth');

  const far = scoreGuess({ root: C, quality: 'augmented' }, { root: C, quality: 'diminished' });
  assert.equal(far.quality, MISS, 'augmented and diminished share nothing above the root');
});

test('note proximity counts the answer notes the guess contains', () => {
  // C major (C E G) vs E minor (E G B): shares E and G.
  const s = scoreGuess({ root: C, quality: 'major' }, { root: E, quality: 'minor' });
  assert.deepEqual(s.notes, { matched: 2, total: 3 });
  assert.equal(notesState(s.notes), NEAR);
  assert.equal(notesState({ matched: 0, total: 3 }), MISS);
  assert.equal(notesState({ matched: 3, total: 3 }), HIT);
});

test('a correct guess wins and stops accepting input', () => {
  const puzzle = { answer: { root: G, quality: 'sus4' }, tier: 'easy', voicing: 'root', spin: 0, octave: 4, seed: 't' };
  let game = createGame(puzzle);
  game = submitGuess(game, { root: C, quality: 'major' });
  assert.equal(game.status, 'playing');
  game = submitGuess(game, { root: G, quality: 'sus4' });
  assert.equal(game.status, 'won');
  assert.equal(game.guesses.length, 2);

  const after = submitGuess(game, { root: C, quality: 'minor' });
  assert.equal(after.guesses.length, 2, 'no guesses accepted after the game ends');
});

test('six wrong guesses lose the game', () => {
  const puzzle = { answer: { root: 11, quality: 'diminished' }, tier: 'easy', voicing: 'root', spin: 0, octave: 4, seed: 't' };
  let game = createGame(puzzle);
  const wrong = [
    { root: C, quality: 'major' }, { root: 1, quality: 'major' },
    { root: 2, quality: 'major' }, { root: 3, quality: 'major' },
    { root: 4, quality: 'major' }, { root: 5, quality: 'major' },
  ];
  for (const g of wrong) game = submitGuess(game, g);
  assert.equal(game.guesses.length, MAX_GUESSES);
  assert.equal(game.status, 'lost');
});

test('repeating a guess is rejected without burning a turn', () => {
  const puzzle = makePuzzle({ tier: 'easy', seed: 'x' });
  let game = createGame(puzzle);
  game = submitGuess(game, { root: C, quality: 'major' });
  const repeat = submitGuess(game, { root: C, quality: 'major' });
  assert.equal(repeat.guesses.length, 1);
  assert.match(repeat.error, /already/i);
});

test('the daily puzzle is identical for the same UTC day and differs across days', () => {
  const day = new Date('2026-09-21T08:00:00Z');
  const sameDayLater = new Date('2026-09-21T23:59:00Z');
  const nextDay = new Date('2026-09-22T00:01:00Z');

  const a = makePuzzle({ tier: 'easy', seed: dailySeed('easy', day) });
  const b = makePuzzle({ tier: 'easy', seed: dailySeed('easy', sameDayLater) });
  const c = makePuzzle({ tier: 'easy', seed: dailySeed('easy', nextDay) });

  assert.deepEqual(a.answer, b.answer);
  assert.notDeepEqual(a.answer, c.answer);
  assert.equal(dayKey(day), '2026-09-21');
  assert.equal(puzzleNumber(nextDay) - puzzleNumber(day), 1);
});

test('generated puzzles stay inside their tier', () => {
  for (const [tier, spec] of Object.entries(TIERS)) {
    for (let i = 0; i < 200; i += 1) {
      const { answer } = makePuzzle({ tier, seed: `seed-${tier}-${i}` });
      assert.ok(spec.qualities.includes(answer.quality), `${answer.quality} not in ${tier}`);
      assert.ok(answer.root >= 0 && answer.root < 12);
    }
  }
});

test('the seeded PRNG is deterministic and stays in range', () => {
  const a = mulberry32(hashSeed('abc'));
  const b = mulberry32(hashSeed('abc'));
  for (let i = 0; i < 50; i += 1) {
    const v = a();
    assert.equal(v, b());
    assert.ok(v >= 0 && v < 1);
  }
});

test('puzzle generation spreads across roots and qualities', () => {
  const roots = new Set();
  const qualities = new Set();
  for (let i = 0; i < 400; i += 1) {
    const { answer } = makePuzzle({ tier: 'easy', seed: `spread-${i}` });
    roots.add(answer.root);
    qualities.add(answer.quality);
  }
  assert.equal(roots.size, 12);
  assert.equal(qualities.size, TIERS.easy.qualities.length);
});

test('voicings keep the chord notes but change the arrangement', () => {
  const chord = { root: C, quality: 'dom7' };
  const expected = chordPitchClasses(chord);
  for (const voicing of ['root', 'inversion', 'open']) {
    const notes = voiceChord(chord, voicing, 4, 1);
    assert.deepEqual(new Set(notes.map((n) => n % 12)), expected);
    assert.deepEqual([...notes].sort((x, y) => x - y), notes, 'notes come back low to high');
    assert.ok(notes.every((n) => n >= 36 && n <= 96), 'notes stay in a playable range');
  }
  assert.notDeepEqual(voiceChord(chord, 'root'), voiceChord(chord, 'open'));
});

test('chord names read the way players say them', () => {
  assert.equal(chordName({ root: C, quality: 'major' }), 'C major');
  assert.equal(chordName({ root: A, quality: 'min7' }), 'A m7');
  assert.equal(chordName({ root: 10, quality: 'halfDim7' }), 'A♯/B♭ m7♭5');
});

test('the share grid has one emoji row per guess and hides the answer', () => {
  const puzzle = { answer: { root: A, quality: 'minor' }, tier: 'easy', voicing: 'root', spin: 0, octave: 4, seed: 's' };
  let game = createGame(puzzle, { mode: 'daily', date: new Date('2026-09-21T10:00:00Z') });
  game = submitGuess(game, { root: C, quality: 'major' });
  game = submitGuess(game, { root: A, quality: 'minor' });

  const text = shareText(game);
  const lines = text.split('\n');
  assert.match(lines[0], /Harmonle #\d+ · Chords Easy 2\/6/);
  assert.equal(lines[2], '🟨🟨🟨');
  assert.equal(lines[3], '🟩🟩🟩');
  assert.ok(!/minor/i.test(text), 'the grid must not leak the answer');
});
