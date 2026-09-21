import test from 'node:test';
import assert from 'node:assert/strict';

import {
  QUALITIES, TIERS, shapeOf, chordName, chordPitchClasses, voiceChord,
} from '../src/theory.js';
import {
  HIT, NEAR, MISS, MAX_GUESSES, guessesFor, scoreGuess, notesState,
  createGame, submitGuess, makePuzzle, dailySeed,
} from '../src/game.js';
import { mulberry32, hashSeed, puzzleNumber, dayKey } from '../src/random.js';
import { shareText } from '../src/share.js';

const at = (root, quality) => ({ root, quality });

test('every quality starts on the root and has unique intervals', () => {
  for (const [id, q] of Object.entries(QUALITIES)) {
    assert.equal(q.intervals[0], 0, `${id} must include the root`);
    assert.equal(new Set(q.intervals).size, q.intervals.length, `${id} has duplicates`);
    assert.ok(q.intervals.every((i, n) => n === 0 || i > q.intervals[n - 1]), `${id} unsorted`);
  }
});

test('tiers only reference qualities that exist, and each allows some guesses', () => {
  for (const tier of Object.values(TIERS)) {
    for (const q of tier.qualities) assert.ok(QUALITIES[q], `unknown quality ${q}`);
    assert.ok(tier.guesses >= 3 && tier.guesses < tier.qualities.length,
      'a tier you can work through by pressing every button is not an ear test');
  }
});

test('a chord shape is what sits above the root, folded into an octave', () => {
  assert.deepEqual(shapeOf('major'), new Set([4, 7]));
  assert.deepEqual(shapeOf('halfDim7'), new Set([3, 6, 10]));
  // A 9th is a 2nd and a 13th is a 6th, to the ear the chord is played with.
  assert.deepEqual(shapeOf('dom9'), new Set([2, 4, 7, 10]));
  assert.deepEqual(shapeOf('dom13'), new Set([2, 4, 7, 9, 10]));
});

test('naming the chord being played scores green, whatever its root', () => {
  for (const root of [0, 5, 11]) {
    const s = scoreGuess({ quality: 'minor' }, at(root, 'minor'));
    assert.equal(s.quality, HIT);
    assert.deepEqual(s.notes, { matched: 2, total: 2 });
    assert.ok(s.correct);
  }
});

test('the root is not part of the reading', () => {
  // The same guess against the same quality on a different root reads the same:
  // this mode asks what the chord is, never what note it starts on.
  const low = scoreGuess({ quality: 'major' }, at(0, 'minor'));
  const high = scoreGuess({ quality: 'major' }, at(7, 'minor'));
  assert.deepEqual(low, high);
});

test('a chord sharing a note above the root scores gold', () => {
  // Major and minor share the fifth and nothing else.
  const s = scoreGuess({ quality: 'major' }, at(0, 'minor'));
  assert.equal(s.quality, NEAR);
  assert.deepEqual(s.notes, { matched: 1, total: 2 });
  assert.ok(!s.correct);
});

test('a chord sharing nothing above the root scores rust', () => {
  // Augmented is 4 and 8; diminished is 3 and 6.
  const s = scoreGuess({ quality: 'augmented' }, at(0, 'diminished'));
  assert.equal(s.quality, MISS);
  assert.deepEqual(s.notes, { matched: 0, total: 2 });
});

test('the note count is what narrows the next guess', () => {
  // m7b5 is 3, 6, 10; m7 is 3, 7, 10 - the third and the seventh, not the fifth.
  const s = scoreGuess({ quality: 'min7' }, at(2, 'halfDim7'));
  assert.deepEqual(s.notes, { matched: 2, total: 3 });
  assert.equal(notesState(s.notes), NEAR);
  assert.equal(notesState({ matched: 3, total: 3 }), HIT);
  assert.equal(notesState({ matched: 0, total: 3 }), MISS);
});

test('a correct guess wins and stops accepting input', () => {
  const puzzle = makePuzzle({ tier: 'easy', seed: 'win' });
  let game = createGame(puzzle);
  const wrong = TIERS.easy.qualities.find((q) => q !== puzzle.answer.quality);

  game = submitGuess(game, { quality: wrong });
  assert.equal(game.status, 'playing');
  game = submitGuess(game, { quality: puzzle.answer.quality });
  assert.equal(game.status, 'won');

  const after = submitGuess(game, { quality: wrong });
  assert.equal(after.guesses.length, 2, 'no guesses accepted after the game ends');
});

test('a tier allows its own number of guesses, and no more', () => {
  for (const [tier, spec] of Object.entries(TIERS)) {
    const puzzle = makePuzzle({ tier, seed: `lose-${tier}` });
    let game = createGame(puzzle);
    assert.equal(game.allowed, spec.guesses);
    assert.equal(guessesFor(tier), spec.guesses);

    const wrong = spec.qualities.filter((q) => q !== puzzle.answer.quality);
    for (const quality of wrong.slice(0, spec.guesses)) game = submitGuess(game, { quality });

    assert.equal(game.guesses.length, spec.guesses);
    assert.equal(game.status, 'lost');
  }
  assert.equal(MAX_GUESSES, 4, 'a stats bucket has to hold the longest tier');
});

test('repeating a guess is rejected without burning a turn', () => {
  const puzzle = makePuzzle({ tier: 'easy', seed: 'x' });
  const wrong = TIERS.easy.qualities.find((q) => q !== puzzle.answer.quality);
  let game = submitGuess(createGame(puzzle), { quality: wrong });
  const repeat = submitGuess(game, { quality: wrong });
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

test('generated puzzles stay inside their tier and move their root about', () => {
  for (const [tier, spec] of Object.entries(TIERS)) {
    const roots = new Set();
    for (let i = 0; i < 200; i += 1) {
      const { answer } = makePuzzle({ tier, seed: `seed-${tier}-${i}` });
      assert.ok(spec.qualities.includes(answer.quality), `${answer.quality} not in ${tier}`);
      assert.ok(answer.root >= 0 && answer.root < 12);
      roots.add(answer.root);
    }
    assert.equal(roots.size, 12, 'nothing to anchor on: the root moves every puzzle');
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

test('puzzle generation spreads across a tier', () => {
  const qualities = new Set();
  for (let i = 0; i < 400; i += 1) {
    qualities.add(makePuzzle({ tier: 'easy', seed: `spread-${i}` }).answer.quality);
  }
  assert.equal(qualities.size, TIERS.easy.qualities.length);
});

test('voicings keep the chord notes but change the arrangement', () => {
  const chord = { root: 0, quality: 'dom7' };
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
  assert.equal(chordName({ root: 0, quality: 'major' }), 'C major');
  assert.equal(chordName({ root: 9, quality: 'min7' }), 'A m7');
  assert.equal(chordName({ root: 10, quality: 'halfDim7' }), 'A♯/B♭ m7♭5');
});

test('the share grid has one row per guess and hides the answer', () => {
  const puzzle = makePuzzle({ tier: 'easy', seed: 'share' });
  const wrong = TIERS.easy.qualities.find((q) => scoreGuess({ quality: q }, puzzle.answer).quality === MISS);

  let game = createGame(puzzle, { mode: 'daily', date: new Date('2026-09-21T10:00:00Z') });
  game = submitGuess(game, { quality: wrong });
  game = submitGuess(game, { quality: puzzle.answer.quality });

  const lines = shareText(game).split('\n');
  assert.match(lines[0], /Harmonle #\d+ · Chords Easy 2\/3/);
  assert.equal(lines[2], '⬜⬜');
  assert.equal(lines[3], '🟩🟩');
  assert.ok(!lines.join(' ').includes(puzzle.answer.quality), 'the grid must not leak the answer');
});
