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

const { getStats, recordGame, weakestKind, resetStats, ATTEMPT_BANDS, attemptBand } =
  await import('../src/stats.js');
const { createGame, submitGuess, makePuzzle, showAnswer } = await import('../src/game.js');

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
 * Guesses a long way from the answer, all of them different.
 *
 * There is no number of these that ends a round any more, so what they are
 * for is getting to the point where somebody gives up and asks - which is the
 * only way a round is now recorded without being solved.
 */
const wrongFor = (frequency, tries = 4) => Array.from(
  { length: tries },
  (_, i) => bandAt(frequency > 1000 ? 50 + i * 4 : 8000 + i * 400, -11),
);

function play(puzzle, guesses, { playing = 'practice', give = false } = {}) {
  let game = createGame(puzzle, { mode: playing });
  for (const guess of guesses) game = submitGuess(game, guess);
  if (give) game = showAnswer(game);
  recordGame(game);
  return game;
}

test.beforeEach(() => resetStats());

test('a solve records a streak and lands in the right attempt band', () => {
  play(puzzleFor(MUD), [bandAt(9000, -9), bandAt(MUD)]);

  const stats = getStats('practice', 'eq', 'easy');
  assert.equal(stats.played, 1);
  assert.equal(stats.won, 1);
  assert.equal(stats.streak, 1);
  assert.equal(stats.maxStreak, 1);
  assert.equal(stats.attempts['2'], 1, 'solved on the second attempt');
});

test('the attempt bands are open-ended, and band at the edges', () => {
  // The whole reason they are bands: there is no ceiling to size an array to
  // any more, and eleven attempts against fourteen is not a signal worth
  // keeping apart. Three against four is.
  assert.equal(attemptBand(1).id, '1');
  assert.equal(attemptBand(3).id, '3');
  assert.equal(attemptBand(4).id, '4-5');
  assert.equal(attemptBand(5).id, '4-5');
  assert.equal(attemptBand(6).id, '6-9');
  assert.equal(attemptBand(9).id, '6-9');
  assert.equal(attemptBand(10).id, '10+');
  assert.equal(attemptBand(400).id, '10+', 'the top band has no top');

  const covered = ATTEMPT_BANDS.flatMap((band) =>
    Array.from({ length: Math.min(band.to, 40) - band.from + 1 }, (_, i) => band.from + i));
  assert.deepEqual(covered, Array.from({ length: 40 }, (_, i) => i + 1),
    'the bands tile the counts with no gap and no overlap');
});

test('asking to be shown counts as played, never as solved', () => {
  play(puzzleFor(MUD), [bandAt(MUD)]);
  play(puzzleFor(HARSH, 's2'), wrongFor(HARSH), { give: true });

  const stats = getStats('practice', 'eq', 'easy');
  assert.equal(stats.played, 2);
  assert.equal(stats.won, 1, 'being shown is not a solve');
  assert.equal(stats.streak, 0, 'and it breaks the run');
  assert.equal(stats.maxStreak, 1);

  // And it does not land in an attempt band: it did not take four attempts to
  // get there, it took four attempts and then the answer.
  const banded = Object.values(stats.attempts).reduce((a, b) => a + b, 0);
  assert.equal(banded, 1, 'only the solve is counted among the attempts');
});

test('the weak-spot hint waits for enough data, then names the worst kind of answer', () => {
  assert.equal(weakestKind(getStats('practice', 'eq', 'easy')), null, 'no hint from one game');

  for (let i = 0; i < 3; i += 1) play(puzzleFor(HARSH, `d${i}`), wrongFor(HARSH), { give: true });
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

test('the daily is no longer locked once it has been played', () => {
  // It stays the same puzzle for everybody on the same day, which is the whole
  // of what made it worth having. What it no longer does is refuse a second
  // run - there is no scarce resource left to protect, and the restore that
  // used to enforce it re-scored stored guesses against audio that loads
  // asynchronously, so it could print different text than had been shown.
  const puzzle = puzzleFor(HONK, 'daily:eq:easy:2026-09-21');
  play(puzzle, [bandAt(60, -9), bandAt(HONK)], { playing: 'daily' });

  const again = createGame(puzzle, { mode: 'daily' });
  assert.equal(again.status, 'playing', 'the same daily opens fresh');
  assert.equal(again.guesses.length, 0);

  assert.equal(getStats('daily', 'eq', 'easy').played, 1);
  assert.ok(!('daily' in JSON.parse(localStorage.getItem('headroom.stats.v2'))),
    'nothing is kept per-puzzle any more');
});

test('a stored bucket from an older shape is filled in rather than thrown on', () => {
  // What comes back from a browser was written by whatever version of this
  // file the browser last ran. Reading a field added since should give a zero.
  localStorage.setItem('headroom.stats.v2', JSON.stringify({
    buckets: { 'practice:eq:easy': { played: 3, won: 2 } },
  }));

  const stats = getStats('practice', 'eq', 'easy');
  assert.equal(stats.played, 3);
  assert.equal(stats.won, 2);
  assert.deepEqual(stats.attempts, Object.fromEntries(ATTEMPT_BANDS.map((b) => [b.id, 0])));
  assert.deepEqual(stats.byAnswer, {});
});

test('corrupt storage degrades to empty stats instead of throwing', () => {
  localStorage.setItem('headroom.stats.v2', '{not json');
  const stats = getStats('practice', 'eq', 'easy');
  assert.equal(stats.played, 0);
  assert.deepEqual(stats.attempts, Object.fromEntries(ATTEMPT_BANDS.map((b) => [b.id, 0])));
});
