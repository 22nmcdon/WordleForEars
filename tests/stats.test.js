import test from 'node:test';
import assert from 'node:assert/strict';

// stats.js talks to localStorage; give it a minimal in-memory stand-in.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};

const { getStats, recordGame, dailyResult, weakestQuality, resetStats } = await import('../src/stats.js');
const { createGame, submitGuess, makePuzzle } = await import('../src/game.js');

function play(puzzle, guesses, mode = 'practice') {
  let game = createGame(puzzle, { mode });
  for (const g of guesses) game = submitGuess(game, g);
  recordGame(game);
  return game;
}

const puzzleFor = (answer, seed = 's') => (
  { answer, tier: 'easy', voicing: 'root', spin: 0, octave: 4, seed }
);

test.beforeEach(() => resetStats());

test('a win records a streak and lands in the right distribution bucket', () => {
  const answer = { root: 0, quality: 'major' };
  play(puzzleFor(answer), [{ root: 5, quality: 'minor' }, answer]);
  const stats = getStats('practice', 'easy');
  assert.equal(stats.played, 1);
  assert.equal(stats.won, 1);
  assert.equal(stats.streak, 1);
  assert.equal(stats.maxStreak, 1);
  assert.equal(stats.distribution[1], 1, 'solved on guess two');
});

test('a loss breaks the streak but keeps the best', () => {
  const answer = { root: 0, quality: 'major' };
  play(puzzleFor(answer), [answer]);
  const wrong = Array.from({ length: 6 }, (_, i) => ({ root: i + 1, quality: 'sus2' }));
  play(puzzleFor({ root: 0, quality: 'diminished' }, 's2'), wrong);

  const stats = getStats('practice', 'easy');
  assert.equal(stats.played, 2);
  assert.equal(stats.won, 1);
  assert.equal(stats.streak, 0);
  assert.equal(stats.maxStreak, 1);
});

test('a finished daily is stored so it cannot be replayed', () => {
  const answer = { root: 7, quality: 'sus4' };
  const puzzle = puzzleFor(answer, 'daily:easy:2026-09-21');
  assert.equal(dailyResult(puzzle), null);
  play(puzzle, [{ root: 0, quality: 'major' }, answer], 'daily');

  const saved = dailyResult(puzzle);
  assert.equal(saved.status, 'won');
  assert.deepEqual(saved.guesses, [{ root: 0, quality: 'major' }, answer]);
  assert.equal(dailyResult(puzzleFor(answer, 'daily:easy:2026-09-22')), null);
});

test('the weak-spot hint waits for enough data, then names the worst quality', () => {
  const dim = { root: 0, quality: 'diminished' };
  const wrong = Array.from({ length: 6 }, (_, i) => ({ root: i + 1, quality: 'sus2' }));
  assert.equal(weakestQuality(getStats('practice', 'easy')), null, 'no hint from one game');

  for (let i = 0; i < 3; i += 1) play(puzzleFor(dim, `d${i}`), wrong);
  play(puzzleFor({ root: 2, quality: 'major' }, 'm1'), [{ root: 2, quality: 'major' }]);

  const weak = weakestQuality(getStats('practice', 'easy'));
  assert.equal(weak.quality, 'diminished');
  assert.equal(weak.label, 'Diminished');
  assert.equal(weak.rate, 0);
});

test('unfinished games are not recorded', () => {
  const puzzle = makePuzzle({ tier: 'easy', seed: 'unfinished' });
  const game = submitGuess(createGame(puzzle), { root: 0, quality: 'major' });
  recordGame(game);
  assert.equal(getStats('practice', 'easy').played, 0);
});

test('corrupt storage degrades to empty stats instead of throwing', () => {
  localStorage.setItem('harmonle.stats.v1', '{not json');
  assert.deepEqual(getStats('practice', 'easy').distribution, [0, 0, 0, 0, 0, 0]);
});
