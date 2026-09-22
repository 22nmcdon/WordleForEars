import test from 'node:test';
import assert from 'node:assert/strict';

import { MODES, modeOf } from '../src/modes/index.js';
import {
  MAX_GUESSES, guessesFor, scoreGuess,
  createGame, submitGuess, makePuzzle, dailySeed, practiceSeed, reveal, settingsFor,
} from '../src/game.js';
import { mulberry32, hashSeed, puzzleNumber, dayKey } from '../src/random.js';
import { shareText } from '../src/share.js';
import { answerAsGuess, wrongGuess } from './helpers.js';


/* --- the round, whichever mode is asking --------------------------------- */

test('a correct guess wins and stops accepting input', () => {
  const puzzle = makePuzzle({ mode: 'eq', tier: 'easy', seed: 'win' });
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
  const puzzle = makePuzzle({ mode: 'eq', tier: 'medium', seed: 'x' });
  const guess = wrongGuess(puzzle);
  let game = submitGuess(createGame(puzzle), guess);
  const repeat = submitGuess(game, { ...guess });
  assert.equal(repeat.guesses.length, 1);
  assert.match(repeat.error, /already/i);
});

test('two guesses differing in one control are two different guesses', () => {
  const puzzle = makePuzzle({ mode: 'compression', tier: 'medium', seed: 'slots' });
  const first = wrongGuess(puzzle);
  const second = { ...first, ratio: first.ratio * 1.2 };

  let game = submitGuess(createGame(puzzle), first);
  game = submitGuess(game, second);
  assert.equal(game.guesses.length, 2, 'a hair of movement on one control is a new attempt');
});

test('scoring goes through the mode that asked the question', () => {
  const puzzle = makePuzzle({ mode: 'reverb', tier: 'easy', seed: 'route' });
  const score = scoreGuess(answerAsGuess(puzzle), puzzle);
  assert.ok(score.correct);
  assert.equal(score.cells.length,
    MODES.reverb.score(answerAsGuess(puzzle), puzzle.answer, 'easy', puzzle).cells.length);
});

test('a mode\'s settings fill themselves in, and refuse what it does not offer', () => {
  assert.deepEqual(settingsFor('eq', {}), { exercise: 'match' });
  assert.deepEqual(settingsFor('eq', { exercise: 'fix' }), { exercise: 'fix' });
  assert.deepEqual(settingsFor('eq', { exercise: 'nonsense' }), { exercise: 'match' });
  assert.deepEqual(settingsFor('compression', {}), { exercise: 'match' });
  assert.deepEqual(settingsFor('saturation', {}), { exercise: 'amount' });
});

/* --- the daily ----------------------------------------------------------- */

test('a daily is per mode, per tier, per exercise, per UTC day', () => {
  const day = new Date('2026-09-21T08:00:00Z');
  const later = new Date('2026-09-21T23:59:00Z');
  const tomorrow = new Date('2026-09-22T00:01:00Z');

  const daily = (mode, tier, when, settings = {}) =>
    makePuzzle({ mode, tier, settings, seed: dailySeed(mode, tier, settings, when) });

  assert.deepEqual(daily('eq', 'easy', day).answer, daily('eq', 'easy', later).answer,
    'the same day is the same puzzle, wherever you are in it');
  assert.notDeepEqual(daily('eq', 'easy', day).answer, daily('eq', 'easy', tomorrow).answer);
  assert.notDeepEqual(daily('eq', 'easy', day).answer, daily('eq', 'medium', day).answer,
    'a tier is its own puzzle');
  assert.notEqual(dailySeed('eq', 'easy', {}, day), dailySeed('rhythm', 'easy', {}, day),
    'so is a mode');

  // Matching a target and curing a fault are different exercises, so each has
  // its own daily rather than two views of one.
  assert.notEqual(dailySeed('eq', 'easy', { exercise: 'match' }, day),
                  dailySeed('eq', 'easy', { exercise: 'fix' }, day));

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
      const rounds = 500;
      const seen = new Map();
      for (let i = 0; i < rounds; i += 1) {
        const { answer } = makePuzzle({ mode, tier, seed: `spread-${mode}-${tier}-${i}` });
        for (const slot of spec.slots(tier)) {
          if (!seen.has(slot.id)) seen.set(slot.id, new Map());
          const counts = seen.get(slot.id);
          counts.set(answer[slot.id], (counts.get(answer[slot.id]) ?? 0) + 1);
        }
      }

      for (const slot of spec.slots(tier)) {
        const counts = seen.get(slot.id);

        if (slot.kind === 'range') {
          // A control is not a list to get through, and some exercises use a
          // narrow part of it on purpose - a corrective cut lives where the
          // fault lives. What has to be true is that it moves, and that no one
          // answer comes up so often that the daily is the same every day.
          assert.ok(counts.size > 1, `${mode}/${tier}/${slot.id} never moves`);
          assert.ok(Math.max(...counts.values()) < rounds * 0.6,
            `${mode}/${tier}/${slot.id} keeps landing on the same value`);
          continue;
        }

        assert.equal(counts.size, slot.options.length,
          `${mode}/${tier}/${slot.id} never offers some of its answers`);
      }
    }
  }
});

/* --- sharing ------------------------------------------------------------- */

test('the share grid names the mode, counts the guesses and hides the answer', () => {
  const puzzle = makePuzzle({ mode: 'compression', tier: 'easy', settings: { exercise: 'match' }, seed: 'share' });
  let game = createGame(puzzle, { mode: 'daily', date: new Date('2026-09-21T10:00:00Z') });
  game = submitGuess(game, wrongGuess(puzzle));
  game = submitGuess(game, answerAsGuess(puzzle));

  const lines = shareText(game).split('\n');
  assert.match(lines[0], /^Headroom Compression #\d+ · Easy 2\/4$/);
  assert.equal([...lines[2]].length, 2, 'one square per reading');
  assert.equal(lines[3], '🟩🟩');

  const said = reveal(puzzle);
  assert.ok(!lines.join(' ').includes(said.symbol), 'the grid must not leak the answer');
});

test('a lost round shares as X of its allowance', () => {
  const puzzle = makePuzzle({ mode: 'panning', tier: 'easy', seed: 'lost' });
  let game = createGame(puzzle, { mode: 'daily', date: new Date('2026-09-21T10:00:00Z') });
  for (let i = 0; i < game.allowed; i += 1) game = submitGuess(game, wrongGuess(puzzle, i));

  assert.equal(game.status, 'lost');
  assert.match(shareText(game).split('\n')[0], /Stereo #\d+ · Easy X\/3/);
});
