import {
  QUALITIES, TIERS, chordPitchClasses, chordName, rootLabel, qualityLabel,
} from './theory.js';
import { mulberry32, hashSeed, dayKey, puzzleNumber } from './random.js';

export const MAX_GUESSES = 6;

/** Feedback states, borrowed from Wordle. */
export const HIT = 'hit'; // green  — right component, right slot
export const NEAR = 'near'; // yellow — right component, wrong slot / near miss
export const MISS = 'miss'; // gray   — not in the chord at all

/**
 * Score one guess against the answer.
 *
 *  root    — hit when the roots match; near when the guessed root is a note of
 *            the answer but not its root; miss otherwise.
 *  quality — hit when identical; near when the two qualities share at least one
 *            interval above the root (a structural near miss); miss otherwise.
 *  notes   — how many of the answer's pitch classes the guessed chord actually
 *            contains, as proximity feedback on the guess as a whole.
 */
export function scoreGuess(guess, answer) {
  const answerNotes = chordPitchClasses(answer);
  const guessNotes = chordPitchClasses(guess);

  let root = MISS;
  if (guess.root === answer.root) root = HIT;
  else if (answerNotes.has(guess.root % 12)) root = NEAR;

  let quality = MISS;
  if (guess.quality === answer.quality) {
    quality = HIT;
  } else {
    const answerShape = new Set(QUALITIES[answer.quality].intervals);
    const shared = QUALITIES[guess.quality].intervals
      .filter((i) => i !== 0 && answerShape.has(i));
    if (shared.length > 0) quality = NEAR;
  }

  let matched = 0;
  for (const pc of answerNotes) if (guessNotes.has(pc)) matched += 1;

  return {
    root,
    quality,
    notes: { matched, total: answerNotes.size },
    correct: root === HIT && quality === HIT,
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
    number: mode === 'daily' ? puzzleNumber(date) : null,
    guesses: [],
    status: 'playing', // 'playing' | 'won' | 'lost'
  };
}

/** Apply a guess; returns a new state (the caller owns rendering). */
export function submitGuess(game, guess) {
  if (game.status !== 'playing') return game;

  const already = game.guesses.some(
    (g) => g.guess.root === guess.root && g.guess.quality === guess.quality,
  );
  if (already) return { ...game, error: 'You already tried that chord.' };

  const score = scoreGuess(guess, game.puzzle.answer);
  const guesses = [...game.guesses, { guess, score }];
  let status = 'playing';
  if (score.correct) status = 'won';
  else if (guesses.length >= MAX_GUESSES) status = 'lost';

  return { ...game, guesses, status, error: null };
}

export function answerName(game) {
  return chordName(game.puzzle.answer);
}

export function guessName(guess) {
  return `${rootLabel(guess.root)} ${qualityLabel(guess.quality)}`;
}
