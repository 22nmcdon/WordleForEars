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

const { getStats, recordGame, dailyResult, weakestKind, resetStats } = await import('../src/stats.js');
const { createGame, submitGuess, makePuzzle, MAX_GUESSES } = await import('../src/game.js');
const { TIERS } = await import('../src/theory.js');

const puzzleFor = (quality, seed = 's') => (
  { mode: 'chords', tier: 'easy', setting: 'root', seed,
    answer: { root: 0, quality }, spin: 0, octave: 4 }
);

function play(puzzle, qualities, playing = 'practice') {
  let game = createGame(puzzle, { mode: playing });
  for (const quality of qualities) game = submitGuess(game, { quality });
  recordGame(game);
  return game;
}

/** Three qualities that are not the answer - enough to lose an Easy round. */
const wrongFor = (quality) => TIERS.easy.qualities.filter((q) => q !== quality).slice(0, 3);

test.beforeEach(() => resetStats());

test('a win records a streak and lands in the right distribution bucket', () => {
  play(puzzleFor('major'), ['minor', 'major']);

  const stats = getStats('practice', 'chords', 'easy');
  assert.equal(stats.played, 1);
  assert.equal(stats.won, 1);
  assert.equal(stats.streak, 1);
  assert.equal(stats.maxStreak, 1);
  assert.equal(stats.distribution[1], 1, 'solved on guess two');
});

test('a loss breaks the streak but keeps the best', () => {
  play(puzzleFor('major'), ['major']);
  play(puzzleFor('diminished', 's2'), wrongFor('diminished'));

  const stats = getStats('practice', 'chords', 'easy');
  assert.equal(stats.played, 2);
  assert.equal(stats.won, 1);
  assert.equal(stats.streak, 0);
  assert.equal(stats.maxStreak, 1);
});

test('a finished daily is stored so it cannot be replayed', () => {
  const puzzle = puzzleFor('sus4', 'daily:chords:easy:2026-09-21');
  assert.equal(dailyResult(puzzle), null);
  play(puzzle, ['major', 'sus4'], 'daily');

  const saved = dailyResult(puzzle);
  assert.equal(saved.status, 'won');
  assert.deepEqual(saved.guesses, [{ quality: 'major' }, { quality: 'sus4' }]);
  assert.equal(dailyResult(puzzleFor('sus4', 'daily:chords:easy:2026-09-22')), null);
});

test('the weak-spot hint waits for enough data, then names the worst kind of answer', () => {
  assert.equal(weakestKind(getStats('practice', 'chords', 'easy')), null, 'no hint from one game');

  for (let i = 0; i < 3; i += 1) play(puzzleFor('diminished', `d${i}`), wrongFor('diminished'));
  play(puzzleFor('major', 'm1'), ['major']);

  const weak = weakestKind(getStats('practice', 'chords', 'easy'));
  assert.equal(weak.key, 'diminished');
  assert.equal(weak.label, 'Diminished');
  assert.equal(weak.rate, 0);
});

test('unfinished games are not recorded', () => {
  const puzzle = makePuzzle({ tier: 'easy', seed: 'unfinished' });
  const wrong = TIERS.easy.qualities.find((q) => q !== puzzle.answer.quality);
  recordGame(submitGuess(createGame(puzzle), { quality: wrong }));
  assert.equal(getStats('practice', 'chords', 'easy').played, 0);
});

test('a bucket is its own per mode, so the modes do not pool their streaks', () => {
  play(puzzleFor('major'), ['major']);
  assert.equal(getStats('practice', 'chords', 'easy').played, 1);
  assert.equal(getStats('practice', 'eq', 'easy').played, 0, 'EQ has played nothing');
  assert.equal(getStats('daily', 'chords', 'easy').played, 0, 'nor has the daily');
});

test('a bucket makes room for the longest tier in the suite', () => {
  assert.equal(getStats('practice', 'chords', 'easy').distribution.length, MAX_GUESSES);
});

test('corrupt storage degrades to empty stats instead of throwing', () => {
  localStorage.setItem('harmonle.stats.v1', '{not json');
  const stats = getStats('practice', 'chords', 'easy');
  assert.equal(stats.played, 0);
  assert.deepEqual(stats.distribution, new Array(MAX_GUESSES).fill(0));
});
