// Local-only persistence: no accounts, no server (per the MVP plan).
import { MAX_GUESSES } from './game.js';
import { qualityLabel } from './theory.js';

const KEY = 'harmonle.stats.v1';

function emptyBucket() {
  return {
    played: 0,
    won: 0,
    streak: 0,
    maxStreak: 0,
    distribution: Array.from({ length: MAX_GUESSES }, () => 0),
    byQuality: {}, // quality -> { seen, solved }
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

const bucketKey = (mode, tier) => `${mode}:${tier}`;

export function getStats(mode, tier) {
  const store = read();
  return store.buckets[bucketKey(mode, tier)] ?? emptyBucket();
}

/** Record a finished game. Daily results are recorded once per day. */
export function recordGame(game) {
  const { mode, puzzle, guesses, status } = game;
  if (status === 'playing') return getStats(mode, puzzle.tier);

  const store = read();
  const key = bucketKey(mode, puzzle.tier);
  const bucket = store.buckets[key] ?? emptyBucket();

  bucket.played += 1;
  const quality = puzzle.answer.quality;
  const perQuality = bucket.byQuality[quality] ?? { seen: 0, solved: 0 };
  perQuality.seen += 1;

  if (status === 'won') {
    bucket.won += 1;
    bucket.streak += 1;
    bucket.maxStreak = Math.max(bucket.maxStreak, bucket.streak);
    bucket.distribution[guesses.length - 1] += 1;
    perQuality.solved += 1;
  } else {
    bucket.streak = 0;
  }

  bucket.byQuality[quality] = perQuality;
  store.buckets[key] = bucket;
  // Keep the finished daily board so a reload restores it instead of
  // handing the player a second run at the same chord.
  if (mode === 'daily') {
    store.daily[dailyKey(puzzle)] = {
      status,
      guesses: guesses.map((g) => g.guess),
      number: game.number,
    };
  }
  write(store);
  return bucket;
}

const dailyKey = (puzzle) => `${puzzle.tier}:${puzzle.seed}`;

/** The stored result for a daily puzzle, or null if it has not been played. */
export function dailyResult(puzzle) {
  return read().daily[dailyKey(puzzle)] ?? null;
}

/**
 * The plan's "you're weak on half-diminished chords" line: surface the worst
 * quality once there is enough data for it to mean anything.
 */
export function weakestQuality(stats, minSeen = 3) {
  let worst = null;
  for (const [quality, { seen, solved }] of Object.entries(stats.byQuality)) {
    if (seen < minSeen) continue;
    const rate = solved / seen;
    if (!worst || rate < worst.rate) worst = { quality, rate, seen };
  }
  if (!worst || worst.rate >= 0.9) return null;
  return { ...worst, label: qualityLabel(worst.quality) };
}

export function resetStats() {
  write(emptyStore());
}
