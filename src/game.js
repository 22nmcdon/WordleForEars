import { modeOf, MODES } from './modes/index.js';
import { mulberry32, hashSeed, dayKey, puzzleNumber } from './random.js';

export { HIT, NEAR, MISS } from './modes/scoring.js';

/** The most guesses any mode's tier allows - what a stats bucket makes room for. */
export const MAX_GUESSES = Math.max(
  ...Object.values(MODES).flatMap((mode) => Object.values(mode.tiers).map((tier) => tier.guesses)),
);

export const guessesFor = (mode, tier) => modeOf(mode).tiers[tier].guesses;

/** Every combination the slots of a tier offer - what a guess count is measured against. */
export function combinationsFor(mode, tier) {
  return modeOf(mode).slots(tier).reduce((total, slot) => total * slot.options.length, 1);
}

/** Read a guess against the answer, through the mode that asked the question. */
export function scoreGuess(guess, puzzle) {
  return modeOf(puzzle.mode).score(guess, puzzle.answer, puzzle.tier);
}

/** Pick a puzzle deterministically from a seed string. */
export function makePuzzle({ mode = 'chords', tier = 'easy', setting = null, seed }) {
  const rng = mulberry32(hashSeed(seed));
  const spec = modeOf(mode);
  const chosen = setting ?? (spec.setting ? spec.setting.options[0].id : null);

  return { mode, tier, setting: chosen, seed, ...spec.makePuzzle(rng, tier) };
}

/** One puzzle per mode per tier per day, the same one for everybody. */
export function dailySeed(mode, tier, date = new Date()) {
  return `daily:${mode}:${tier}:${dayKey(date)}`;
}

export function practiceSeed(mode, tier, salt = Math.random()) {
  return `practice:${mode}:${tier}:${salt}:${Date.now()}`;
}

/** Fresh game state around a puzzle. */
export function createGame(puzzle, { mode = 'practice', date = new Date() } = {}) {
  return {
    puzzle,
    mode, // 'daily' or 'practice' - the puzzle carries which training mode it is
    allowed: guessesFor(puzzle.mode, puzzle.tier),
    number: mode === 'daily' ? puzzleNumber(date) : null,
    guesses: [],
    status: 'playing', // 'playing' | 'won' | 'lost'
  };
}

/** Two guesses are the same guess when every slot of them agrees. */
const sameGuess = (a, b) => Object.keys(b).every((slot) => a[slot] === b[slot]);

/** Apply a guess; returns a new state (the caller owns rendering). */
export function submitGuess(game, guess) {
  if (game.status !== 'playing') return game;

  if (game.guesses.some((played) => sameGuess(played.guess, guess))) {
    return { ...game, error: 'You already tried that one.' };
  }

  const score = scoreGuess(guess, game.puzzle);
  const guesses = [...game.guesses, { guess, score }];
  let status = 'playing';
  if (score.correct) status = 'won';
  else if (guesses.length >= game.allowed) status = 'lost';

  return { ...game, guesses, status, error: null };
}

/** What the answer was, for the reveal line. */
export function reveal(puzzle) {
  return modeOf(puzzle.mode).reveal(puzzle.answer, puzzle.tier);
}
