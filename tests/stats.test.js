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
const { MODES } = await import('../src/modes/index.js');

// These used to be chord puzzles, because a chord quality is the simplest
// thing a mode can call "one kind of answer". The chords are gone, so they are
// EQ puzzles now: a single corrective band, whose frequency the EQ mode sorts
// into a named trouble zone - mud, boxiness, honk, harshness - which is
// exactly the same job the quality was doing and on a subject this app is
// actually about.
const bandAt = (frequency, gain = 6) => [{ type: 'peaking', frequency, gain, q: 1.4, on: true }];

const MUD = 250;
const HONK = 1600;
const HARSH = 4000;

const puzzleFor = (frequency, seed = 's') => (
  { mode: 'eq', tier: 'easy', settings: { exercise: 'match' }, seed, answer: bandAt(frequency) }
);

/**
 * Enough losing guesses to run a round out.
 *
 * As many as the tier allows, all of them a long way from the answer and all
 * of them different, because a repeat is refused without burning a turn.
 */
const wrongFor = (frequency, tries = MODES.eq.tiers.easy.guesses) => Array.from(
  { length: tries },
  (_, i) => bandAt(frequency > 1000 ? 50 + i * 4 : 8000 + i * 400, -11),
);

function play(puzzle, guesses, playing = 'practice') {
  let game = createGame(puzzle, { mode: playing });
  for (const guess of guesses) game = submitGuess(game, guess);
  recordGame(game);
  return game;
}

test.beforeEach(() => resetStats());

test('a win records a streak and lands in the right distribution bucket', () => {
  play(puzzleFor(MUD), [bandAt(9000, -9), bandAt(MUD)]);

  const stats = getStats('practice', 'eq', 'easy');
  assert.equal(stats.played, 1);
  assert.equal(stats.won, 1);
  assert.equal(stats.streak, 1);
  assert.equal(stats.maxStreak, 1);
  assert.equal(stats.distribution[1], 1, 'solved on guess two');
});

test('a loss breaks the streak but keeps the best', () => {
  play(puzzleFor(MUD), [bandAt(MUD)]);
  play(puzzleFor(HARSH, 's2'), wrongFor(HARSH));

  const stats = getStats('practice', 'eq', 'easy');
  assert.equal(stats.played, 2);
  assert.equal(stats.won, 1);
  assert.equal(stats.streak, 0);
  assert.equal(stats.maxStreak, 1);
});

test('a finished daily is stored so it cannot be replayed', () => {
  const puzzle = puzzleFor(HONK, 'daily:eq:easy:2026-09-21');
  assert.equal(dailyResult(puzzle), null);
  play(puzzle, [bandAt(60, -9), bandAt(HONK)], 'daily');

  const saved = dailyResult(puzzle);
  assert.equal(saved.status, 'won');
  assert.equal(saved.guesses.length, 2);
  assert.equal(saved.guesses[1][0].frequency, HONK, 'the winning guess is what was stored');
  assert.equal(dailyResult(puzzleFor(HONK, 'daily:eq:easy:2026-09-22')), null);
});

test('the weak-spot hint waits for enough data, then names the worst kind of answer', () => {
  assert.equal(weakestKind(getStats('practice', 'eq', 'easy')), null, 'no hint from one game');

  for (let i = 0; i < 3; i += 1) play(puzzleFor(HARSH, `d${i}`), wrongFor(HARSH));
  play(puzzleFor(MUD, 'm1'), [bandAt(MUD)]);

  const weak = weakestKind(getStats('practice', 'eq', 'easy'));
  assert.equal(weak.key, 'harshness');
  assert.equal(weak.label, 'harshness');
  assert.equal(weak.rate, 0);
});

test('unfinished games are not recorded', () => {
  const puzzle = makePuzzle({ mode: 'eq', tier: 'easy', seed: 'unfinished' });
  recordGame(submitGuess(createGame(puzzle), bandAt(9000, -9)));
  assert.equal(getStats('practice', 'eq', 'easy').played, 0);
});

test('a bucket is its own per mode, so the modes do not pool their streaks', () => {
  play(puzzleFor(MUD), [bandAt(MUD)]);
  assert.equal(getStats('practice', 'eq', 'easy').played, 1);
  assert.equal(getStats('practice', 'reverb', 'easy').played, 0, 'the reverb has played nothing');
  assert.equal(getStats('daily', 'eq', 'easy').played, 0, 'nor has the daily');
});

test('a bucket makes room for the longest tier in the suite', () => {
  assert.equal(getStats('practice', 'eq', 'easy').distribution.length, MAX_GUESSES);
});

test('corrupt storage degrades to empty stats instead of throwing', () => {
  localStorage.setItem('headroom.stats.v1', '{not json');
  const stats = getStats('practice', 'eq', 'easy');
  assert.equal(stats.played, 0);
  assert.deepEqual(stats.distribution, new Array(MAX_GUESSES).fill(0));
});
