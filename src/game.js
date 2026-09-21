import { TIERS, shapeOf, chordName, qualityLabel } from './theory.js';
import { mulberry32, hashSeed, dayKey, puzzleNumber } from './random.js';

/** The most guesses any tier allows - what a stats bucket has to make room for. */
export const MAX_GUESSES = Math.max(...Object.values(TIERS).map((t) => t.guesses));

export const guessesFor = (tier) => TIERS[tier].guesses;

/** Feedback states, borrowed from Wordle. */
export const HIT = 'hit'; // sage - the quality being played
export const NEAR = 'near'; // gold - shares structure with it
export const MISS = 'miss'; // rust - shares nothing above the root

/**
 * Score one guess against the answer.
 *
 * The chord's root is not part of this: naming the root by ear is absolute
 * pitch, which is a different skill and gets its own mode. What is being asked
 * here is what the chord *is* - major, minor, half-diminished - so the puzzle
 * is rooted wherever the seed put it and every reading below is made from the
 * shape above that root.
 *
 *  quality — hit when it is the chord being played; near when it shares a note
 *            above the root with it; miss when it shares nothing.
 *  notes   — how many of the answer's notes above the root your chord has,
 *            which is the proximity reading: "2/3" is a guess with the right
 *            third and fifth and the wrong seventh.
 */
export function scoreGuess(guess, answer) {
  const answerShape = shapeOf(answer.quality);
  const guessShape = shapeOf(guess.quality);

  let matched = 0;
  for (const note of answerShape) if (guessShape.has(note)) matched += 1;

  let quality = MISS;
  if (guess.quality === answer.quality) quality = HIT;
  else if (matched > 0) quality = NEAR;

  return {
    quality,
    notes: { matched, total: answerShape.size },
    correct: quality === HIT,
  };
}

export function notesState({ matched, total }) {
  if (matched === total) return HIT;
  if (matched > 0) return NEAR;
  return MISS;
}

/** Pick a puzzle deterministically from a seed string. */
export function makePuzzle({ tier = 'easy', voicing = 'root', seed }) {
  const rng = mulberry32(hashSeed(seed));
  const qualities = TIERS[tier].qualities;
  // The root is for sounding the chord, never for guessing - and it moves every
  // puzzle, so nobody can anchor on "the daily is always in C".
  const root = Math.floor(rng() * 12);
  const quality = qualities[Math.floor(rng() * qualities.length)];
  const spin = Math.floor(rng() * 3);
  const octave = 3 + Math.floor(rng() * 2);
  return { answer: { root, quality }, tier, voicing, spin, octave, seed };
}

export function dailySeed(tier, date = new Date()) {
  return `daily:${tier}:${dayKey(date)}`;
}

export function practiceSeed(tier, salt = Math.random()) {
  return `practice:${tier}:${salt}:${Date.now()}`;
}

/** Fresh game state around a puzzle. */
export function createGame(puzzle, { mode = 'practice', date = new Date() } = {}) {
  return {
    puzzle,
    mode,
    allowed: guessesFor(puzzle.tier),
    number: mode === 'daily' ? puzzleNumber(date) : null,
    guesses: [],
    status: 'playing', // 'playing' | 'won' | 'lost'
  };
}

/** Apply a guess; returns a new state (the caller owns rendering). */
export function submitGuess(game, guess) {
  if (game.status !== 'playing') return game;

  const already = game.guesses.some((g) => g.guess.quality === guess.quality);
  if (already) return { ...game, error: 'You already tried that one.' };

  const score = scoreGuess(guess, game.puzzle.answer);
  const guesses = [...game.guesses, { guess, score }];
  let status = 'playing';
  if (score.correct) status = 'won';
  else if (guesses.length >= game.allowed) status = 'lost';

  return { ...game, guesses, status, error: null };
}

/** The chord as it would be written on a chart, root and all. */
export function answerName(game) {
  return chordName(game.puzzle.answer);
}

export function guessName(guess) {
  return qualityLabel(guess.quality);
}
