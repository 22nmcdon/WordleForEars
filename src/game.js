import { modeOf, MODES } from './modes/index.js';
import { mulberry32, hashSeed, dayKey, puzzleNumber } from './random.js';

export { HIT, NEAR, MISS } from './modes/scoring.js';

/** The most guesses any mode's tier allows - what a stats bucket makes room for. */
export const MAX_GUESSES = Math.max(
  ...Object.values(MODES).flatMap((mode) => Object.values(mode.tiers).map((tier) => tier.guesses)),
);

export const guessesFor = (mode, tier) => modeOf(mode).tiers[tier].guesses;

/**
 * Every setting the slots of a tier can be in - what a guess count is measured
 * against. A control you dial counts the positions it can stop on, which for a
 * log control is however many steps its slider has.
 */
export function combinationsFor(mode, tier) {
  return modeOf(mode).slots(tier).reduce((total, slot) => {
    if (slot.kind !== 'range') return total * slot.options.length;
    const positions = slot.log
      ? Math.round(Math.log2(slot.max / slot.min) / 0.02)
      : Math.round((slot.max - slot.min) / slot.step) + 1;
    return total * positions;
  }, 1);
}

/** Read a guess against the answer, through the mode that asked the question. */
export function scoreGuess(guess, puzzle) {
  return modeOf(puzzle.mode).score(guess, puzzle.answer, puzzle.tier);
}

/** Whatever the mode's settings are set to, filled in from their defaults. */
export function settingsFor(mode, chosen = {}) {
  return Object.fromEntries(
    (modeOf(mode).settings ?? []).map((setting) => [
      setting.id,
      setting.options.some((option) => option.id === chosen[setting.id])
        ? chosen[setting.id]
        : setting.options[0].id,
    ]),
  );
}

/**
 * Pick a puzzle deterministically from a seed string.
 *
 * The settings go in, because some of them change the answer rather than only
 * the sound of it: an EQ exercise that hands you a fault to cure is a
 * different puzzle from one that hands you a target to match.
 */
export function makePuzzle({ mode = 'chords', tier = 'easy', settings = {}, seed }) {
  const rng = mulberry32(hashSeed(seed));
  const chosen = settingsFor(mode, settings);

  return { mode, tier, settings: chosen, seed, ...modeOf(mode).makePuzzle(rng, tier, chosen) };
}

/**
 * One puzzle per mode per tier per exercise per day, the same one for
 * everybody. The exercise is in the seed because it is a different exercise -
 * matching a target and curing a fault are not two views of one puzzle.
 */
export function dailySeed(mode, tier, settings = {}, date = new Date()) {
  const exercise = settingsFor(mode, settings).exercise;
  return `daily:${mode}:${tier}${exercise ? `:${exercise}` : ''}:${dayKey(date)}`;
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

/** What the controls start on, before anything has been dialled. */
export function startingGuess(mode, tier) {
  return Object.fromEntries(
    modeOf(mode).slots(tier).filter((slot) => slot.kind === 'range')
      .map((slot) => [slot.id, slot.start]),
  );
}

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
  return modeOf(puzzle.mode).reveal(puzzle.answer, puzzle.tier, puzzle);
}
