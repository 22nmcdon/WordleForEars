// Local-only persistence: no accounts, no server (per the MVP plan).
import { toolOf } from './bench/registry.js';

// v2: the attempt counts became open-ended buckets when the guess ceiling went,
// and the finished-daily lock-out went with it. A v1 store is not migrated -
// its `distribution` is indexed by a ceiling that no longer exists, and the
// numbers under it were a different measurement.
const KEY = 'headroom.stats.v2';

/**
 * How many attempts it took, in bands rather than in rows.
 *
 * What was here was an array as long as the most guesses any tier allowed,
 * indexed by the count. Without a ceiling there is no length to give it - so
 * the top band is open, and the lower ones are narrow where the difference
 * matters. Arriving in two rather than nine is the clearest signal of
 * improvement this app has; arriving in eleven rather than fourteen is not a
 * signal at all.
 */
export const ATTEMPT_BANDS = [
  { id: '1', label: '1', from: 1, to: 1 },
  { id: '2', label: '2', from: 2, to: 2 },
  { id: '3', label: '3', from: 3, to: 3 },
  { id: '4-5', label: '4-5', from: 4, to: 5 },
  { id: '6-9', label: '6-9', from: 6, to: 9 },
  { id: '10+', label: '10+', from: 10, to: Infinity },
];

/** Which band an attempt count falls in. */
export const attemptBand = (attempts) =>
  ATTEMPT_BANDS.find((band) => attempts >= band.from && attempts <= band.to)
  ?? ATTEMPT_BANDS[ATTEMPT_BANDS.length - 1];

function emptyBucket() {
  return {
    played: 0,
    won: 0,
    streak: 0,
    maxStreak: 0,
    attempts: Object.fromEntries(ATTEMPT_BANDS.map((band) => [band.id, 0])),
    byAnswer: {}, // what the mode counts as one kind of answer -> { seen, solved, label }
  };
}

function emptyStore() {
  return { buckets: {} };
}

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw);
    return { buckets: parsed.buckets ?? {} };
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

/**
 * A stored bucket, with anything it is missing filled in.
 *
 * A bucket comes back from a browser's storage, which is to say from a version
 * of this file that may not be this one. Reading a field that was added since
 * it was written should give a zero, not throw on the way to drawing a chart.
 */
const fill = (stored) => ({
  ...emptyBucket(),
  ...stored,
  attempts: { ...emptyBucket().attempts, ...(stored?.attempts ?? {}) },
  byAnswer: { ...(stored?.byAnswer ?? {}) },
});

export function getStats(playing, mode, tier) {
  const store = read();
  return fill(store.buckets[bucketKey(playing, mode, tier)]);
}

/**
 * Record a finished round.
 *
 * Finished means solved, or given up on and shown. A round being shown counts
 * as played and never as solved, and its attempts are not banded: it did not
 * take five attempts to get there, it took five attempts and then the answer.
 * Keeping that straight here is what lets the mastery table mean something
 * later, without a flag having to be invented for it.
 */
export function recordGame(game) {
  const { mode: playing, puzzle, guesses, status } = game;
  if (status === 'playing') return getStats(playing, puzzle.mode, puzzle.tier);

  const store = read();
  const key = bucketKey(playing, puzzle.mode, puzzle.tier);
  const bucket = fill(store.buckets[key]);

  bucket.played += 1;
  // What counts as "one kind of answer" is the mode's to say: a band of
  // trouble, a kind of room, how hard something is driven.
  const kind = toolOf(puzzle.mode).weak(puzzle);
  const perKind = bucket.byAnswer[kind.key] ?? { seen: 0, solved: 0, label: kind.label };
  perKind.seen += 1;

  if (status === 'solved') {
    bucket.won += 1;
    bucket.streak += 1;
    bucket.maxStreak = Math.max(bucket.maxStreak, bucket.streak);
    bucket.attempts[attemptBand(guesses.length).id] += 1;
    perKind.solved += 1;
  } else {
    bucket.streak = 0;
  }

  bucket.byAnswer[kind.key] = perKind;
  store.buckets[key] = bucket;
  write(store);
  return bucket;
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
