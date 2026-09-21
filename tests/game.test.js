import test from 'node:test';
import assert from 'node:assert/strict';

import { QUALITIES, TIERS, shapeOf, chordName, chordPitchClasses, voiceChord } from '../src/theory.js';
import { MODES, modeOf } from '../src/modes/index.js';
import {
  MAX_GUESSES, guessesFor, combinationsFor, scoreGuess,
  createGame, submitGuess, makePuzzle, dailySeed, practiceSeed, reveal,
} from '../src/game.js';
import { mulberry32, hashSeed, puzzleNumber, dayKey } from '../src/random.js';
import { shareText } from '../src/share.js';

const answerAsGuess = (puzzle) => Object.fromEntries(
  modeOf(puzzle.mode).slots(puzzle.tier).map((slot) => [slot.id, puzzle.answer[slot.id]]),
);

/**
 * The nth guess that is not the answer.
 *
 * Every combination, in order, with the answer taken out - because a mode with
 * two slots has more wrong answers than either slot has options, and picking
 * per slot runs out and starts repeating itself, which the game rejects as a
 * guess already tried.
 */
function wrongGuess(puzzle, nth = 0) {
  const slots = modeOf(puzzle.mode).slots(puzzle.tier);

  let combinations = [{}];
  for (const slot of slots) {
    combinations = combinations.flatMap((partial) =>
      slot.options.map((option) => ({ ...partial, [slot.id]: option.id })));
  }

  const wrong = combinations.filter((guess) =>
    slots.some((slot) => guess[slot.id] !== puzzle.answer[slot.id]));

  return wrong[nth % wrong.length];
}

/* --- theory, which the chords mode is built on --------------------------- */

test('every quality starts on the root and has unique intervals', () => {
  for (const [id, quality] of Object.entries(QUALITIES)) {
    assert.equal(quality.intervals[0], 0, `${id} must include the root`);
    assert.equal(new Set(quality.intervals).size, quality.intervals.length, `${id} has duplicates`);
    assert.ok(quality.intervals.every((i, n) => n === 0 || i > quality.intervals[n - 1]), `${id} unsorted`);
  }
});

test('a chord shape is what sits above the root, folded into an octave', () => {
  assert.deepEqual(shapeOf('major'), new Set([4, 7]));
  assert.deepEqual(shapeOf('halfDim7'), new Set([3, 6, 10]));
  // A 9th is a 2nd and a 13th is a 6th, to the ear the chord is played with.
  assert.deepEqual(shapeOf('dom9'), new Set([2, 4, 7, 10]));
  assert.deepEqual(shapeOf('dom13'), new Set([2, 4, 7, 9, 10]));
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

/* --- the round, whichever mode is asking --------------------------------- */

test('a correct guess wins and stops accepting input', () => {
  const puzzle = makePuzzle({ mode: 'chords', tier: 'easy', seed: 'win' });
  let game = createGame(puzzle);

  game = submitGuess(game, wrongGuess(puzzle));
  assert.equal(game.status, 'playing');
  game = submitGuess(game, answerAsGuess(puzzle));
  assert.equal(game.status, 'won');

  const after = submitGuess(game, wrongGuess(puzzle, 1));
  assert.equal(after.guesses.length, 2, 'no guesses accepted after the game ends');
});

test('a tier allows its own number of guesses, and no more', () => {
  for (const mode of Object.keys(MODES)) {
    for (const [tier, spec] of Object.entries(MODES[mode].tiers)) {
      const puzzle = makePuzzle({ mode, tier, seed: `lose-${mode}-${tier}` });
      let game = createGame(puzzle);
      assert.equal(game.allowed, spec.guesses);
      assert.equal(guessesFor(mode, tier), spec.guesses);

      for (let i = 0; i < spec.guesses; i += 1) game = submitGuess(game, wrongGuess(puzzle, i));

      assert.equal(game.guesses.length, spec.guesses, `${mode}/${tier} took the wrong number`);
      assert.equal(game.status, 'lost');
    }
  }
  assert.ok(MAX_GUESSES >= 4, 'a stats bucket has to hold the longest tier in the suite');
});

test('repeating a guess is rejected without burning a turn', () => {
  const puzzle = makePuzzle({ mode: 'eq', tier: 'easy', seed: 'x' });
  const guess = wrongGuess(puzzle);
  let game = submitGuess(createGame(puzzle), guess);
  const repeat = submitGuess(game, { ...guess });
  assert.equal(repeat.guesses.length, 1);
  assert.match(repeat.error, /already/i);
});

test('two guesses differing in one slot are two different guesses', () => {
  const puzzle = makePuzzle({ mode: 'eq', tier: 'medium', seed: 'slots' });
  const first = wrongGuess(puzzle);
  const second = { ...first, move: MODES.eq.tiers.medium.moves.find((m) => m.id !== first.move).id };

  let game = submitGuess(createGame(puzzle), first);
  game = submitGuess(game, second);
  assert.equal(game.guesses.length, 2);
});

test('scoring goes through the mode that asked the question', () => {
  const puzzle = makePuzzle({ mode: 'rhythm', tier: 'easy', seed: 'route' });
  const score = scoreGuess(answerAsGuess(puzzle), puzzle);
  assert.ok(score.correct);
  assert.equal(score.cells.length, MODES.rhythm.score(answerAsGuess(puzzle), puzzle.answer, 'easy').cells.length);
});

/* --- the daily ----------------------------------------------------------- */

test('a daily is per mode, per tier, per UTC day', () => {
  const day = new Date('2026-09-21T08:00:00Z');
  const later = new Date('2026-09-21T23:59:00Z');
  const tomorrow = new Date('2026-09-22T00:01:00Z');

  const seedFor = (mode, tier, when) => makePuzzle({ mode, tier, seed: dailySeed(mode, tier, when) });

  assert.deepEqual(seedFor('eq', 'easy', day).answer, seedFor('eq', 'easy', later).answer,
    'the same day is the same puzzle, wherever you are in it');
  assert.notDeepEqual(seedFor('eq', 'easy', day).answer, seedFor('eq', 'easy', tomorrow).answer);
  assert.notDeepEqual(seedFor('eq', 'easy', day).answer, seedFor('eq', 'medium', day).answer,
    'a tier is its own puzzle');
  assert.notEqual(dailySeed('eq', 'easy', day), dailySeed('rhythm', 'easy', day),
    'so is a mode');

  assert.equal(dayKey(day), '2026-09-21');
  assert.equal(puzzleNumber(tomorrow) - puzzleNumber(day), 1);
});

test('practice is a different puzzle every time you ask for one', () => {
  const seeds = new Set();
  for (let i = 0; i < 50; i += 1) seeds.add(practiceSeed('pitch', 'easy', i));
  assert.equal(seeds.size, 50);
});

test('the seeded PRNG is deterministic and stays in range', () => {
  const a = mulberry32(hashSeed('abc'));
  const b = mulberry32(hashSeed('abc'));
  for (let i = 0; i < 50; i += 1) {
    const value = a();
    assert.equal(value, b());
    assert.ok(value >= 0 && value < 1);
  }
});

test('puzzles spread across everything a tier offers', () => {
  for (const [mode, spec] of Object.entries(MODES)) {
    for (const tier of Object.keys(spec.tiers)) {
      const seen = new Map();
      for (let i = 0; i < 500; i += 1) {
        const { answer } = makePuzzle({ mode, tier, seed: `spread-${mode}-${tier}-${i}` });
        for (const slot of spec.slots(tier)) {
          if (!seen.has(slot.id)) seen.set(slot.id, new Set());
          seen.get(slot.id).add(answer[slot.id]);
        }
      }
      for (const slot of spec.slots(tier)) {
        assert.equal(seen.get(slot.id).size, slot.options.length,
          `${mode}/${tier}/${slot.id} never offers some of its answers`);
      }
    }
  }
});

test('chords still move their root about, though it is never guessed', () => {
  const roots = new Set();
  for (let i = 0; i < 200; i += 1) {
    roots.add(makePuzzle({ mode: 'chords', tier: 'easy', seed: `root-${i}` }).answer.root);
  }
  assert.equal(roots.size, 12, 'nothing to anchor on');
  assert.ok(TIERS.easy.qualities.length > 0);
});

/* --- sharing ------------------------------------------------------------- */

test('the share grid names the mode, counts the guesses and hides the answer', () => {
  const puzzle = makePuzzle({ mode: 'eq', tier: 'easy', seed: 'share' });
  let game = createGame(puzzle, { mode: 'daily', date: new Date('2026-09-21T10:00:00Z') });
  game = submitGuess(game, wrongGuess(puzzle));
  game = submitGuess(game, answerAsGuess(puzzle));

  const lines = shareText(game).split('\n');
  assert.match(lines[0], /^Harmonle EQ #\d+ · Easy 2\/3$/);
  assert.equal([...lines[2]].length, 3, 'one square per reading');
  assert.equal(lines[3], '🟩🟩🟩');

  const said = reveal(puzzle);
  assert.ok(!lines.join(' ').includes(said.symbol), 'the grid must not leak the answer');
});

test('a lost round shares as X of its allowance', () => {
  const puzzle = makePuzzle({ mode: 'panning', tier: 'easy', seed: 'lost' });
  let game = createGame(puzzle, { mode: 'daily', date: new Date('2026-09-21T10:00:00Z') });
  for (let i = 0; i < game.allowed; i += 1) game = submitGuess(game, wrongGuess(puzzle, i));

  assert.equal(game.status, 'lost');
  assert.match(shareText(game).split('\n')[0], /Panning #\d+ · Easy X\/2/);
});

test('a guess count is never more than the answers to choose from', () => {
  for (const mode of Object.keys(MODES)) {
    for (const tier of Object.keys(MODES[mode].tiers)) {
      assert.ok(guessesFor(mode, tier) < combinationsFor(mode, tier), `${mode}/${tier}`);
    }
  }
});
