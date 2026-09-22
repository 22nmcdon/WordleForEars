// Local-only persistence: no accounts, no server (per the MVP plan).
import { MAX_GUESSES } from './game.js';
import { modeOf } from './modes/index.js';

const KEY = 'headroom.stats.v1';

function emptyBucket() {
  return {
    played: 0,
    won: 0,
    streak: 0,
    maxStreak: 0,
    distribution: Array.from({ length: MAX_GUESSES }, () => 0),
    byAnswer: {}, // what the mode counts as one kind of answer -> { seen, solved, label }
  };
}

function emptyStore() {
  return { buckets: {}, daily: {} };
}

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw);
    return { buckets: parsed.buckets ?? {}, daily: parsed.daily ?? {} };
  } catch {
    return emptyStore();
  }
}

function write(store) {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* private mode / quota — stats are a nicety, never block play */
  }
}

/** Three things decide a bucket: daily or practice, which mode, which tier. */
const bucketKey = (playing, mode, tier) => `${playing}:${mode}:${tier}`;

export function getStats(playing, mode, tier) {
  const store = read();
  return store.buckets[bucketKey(playing, mode, tier)] ?? emptyBucket();
}

/** Record a finished game. Daily results are recorded once per day. */
export function recordGame(game) {
  const { mode: playing, puzzle, guesses, status } = game;
  if (status === 'playing') return getStats(playing, puzzle.mode, puzzle.tier);

  const store = read();
  const key = bucketKey(playing, puzzle.mode, puzzle.tier);
  const bucket = store.buckets[key] ?? emptyBucket();

  bucket.played += 1;
  // What counts as "one kind of answer" is the mode's to say: a chord quality,
  // a frequency band, a clave.
  const kind = modeOf(puzzle.mode).weak(puzzle.answer, puzzle);
  const perKind = bucket.byAnswer[kind.key] ?? { seen: 0, solved: 0, label: kind.label };
  perKind.seen += 1;

  if (status === 'won') {
    bucket.won += 1;
    bucket.streak += 1;
    bucket.maxStreak = Math.max(bucket.maxStreak, bucket.streak);
    bucket.distribution[guesses.length - 1] += 1;
    perKind.solved += 1;
  } else {
    bucket.streak = 0;
  }

  bucket.byAnswer[kind.key] = perKind;
  store.buckets[key] = bucket;
  // Keep the finished daily board so a reload restores it instead of
  // handing the player a second run at the same puzzle.
  if (playing === 'daily') {
    store.daily[dailyKey(puzzle)] = {
      status,
      guesses: guesses.map((g) => g.guess),
      number: game.number,
    };
  }
  write(store);
  return bucket;
}

const dailyKey = (puzzle) => `${puzzle.mode}:${puzzle.tier}:${puzzle.seed}`;

/** The stored result for a daily puzzle, or null if it has not been played. */
export function dailyResult(puzzle) {
  return read().daily[dailyKey(puzzle)] ?? null;
}

/**
 * The "you keep missing the mud band" line, for whichever tool is showing:
 * surface the worst kind of answer once there is enough data for it to mean
 * anything.
 */
export function weakestKind(stats, minSeen = 3) {
  let worst = null;
  for (const [key, { seen, solved, label }] of Object.entries(stats.byAnswer)) {
    if (seen < minSeen) continue;
    const rate = solved / seen;
    if (!worst || rate < worst.rate) worst = { key, rate, seen, label };
  }
  if (!worst || worst.rate >= 0.9) return null;
  return worst;
}

export function resetStats() {
  write(emptyStore());
}
