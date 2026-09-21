/** Deterministic PRNG so a daily puzzle is the same for everyone, everywhere. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hash a string into a 32-bit seed (FNV-1a). */
export function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export const EPOCH = Date.UTC(2026, 0, 1);
const DAY_MS = 86400000;

/** UTC day key, e.g. "2026-09-21" — everyone gets the same puzzle at the same time. */
export function dayKey(date = new Date()) {
  return new Date(date).toISOString().slice(0, 10);
}

/** Puzzle number, counting from the game's epoch. */
export function puzzleNumber(date = new Date()) {
  const utcMidnight = Date.UTC(
    date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(),
  );
  return Math.floor((utcMidnight - EPOCH) / DAY_MS) + 1;
}
