import { MODES, MODE_IDS, modeOf } from '../src/modes/index.js';

/**
 * The answer, as a guess.
 *
 * A mode with its own interface hands back whatever that interface builds -
 * for the EQ, a set of bands - so the answer is already in that shape and is
 * its own perfect guess.
 */
export const answerAsGuess = (puzzle) => (modeOf(puzzle.mode).surface
  ? puzzle.answer
  : Object.fromEntries(
    modeOf(puzzle.mode).slots(puzzle.tier, puzzle.settings)
      .map((slot) => [slot.id, puzzle.answer[slot.id]]),
  ));

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/**
 * The nth guess that is not the answer.
 *
 * For a control, far enough outside its own tolerance to be read as a miss,
 * and a different distance each time so no two attempts are the same guess.
 * For chips, every combination in order with the answer taken out - a mode
 * with two slots has more wrong answers than either slot has options, and
 * picking per slot runs out and starts repeating itself, which the game
 * rejects as a guess already tried.
 */
export function wrongGuess(puzzle, nth = 0) {
  const spec = modeOf(puzzle.mode);

  // Nothing dialled at all, then a band in the wrong place - both a long way
  // from any target this mode sets.
  if (spec.surface) {
    return nth === 0 ? [] : [{
      type: 'peaking', frequency: 60 * (nth + 1), gain: 12, q: 1 + nth, on: true,
    }];
  }

  const slots = spec.slots(puzzle.tier, puzzle.settings);

  const dialled = slots.filter((slot) => slot.kind === 'range');
  if (dialled.length) {
    return Object.fromEntries(dialled.map((slot) => {
      const answer = puzzle.answer[slot.id];
      const off = slot.near + 0.5 + nth * 0.25;
      const wrong = slot.unit === 'oct' || slot.unit === 'x'
        ? answer * 2 ** (answer * 2 ** off <= slot.max ? off : -off)
        : answer + (answer + off <= slot.max ? off : -off);
      return [slot.id, clamp(wrong, slot.min, slot.max)];
    }));
  }

  let combinations = [{}];
  for (const slot of slots) {
    combinations = combinations.flatMap((partial) =>
      slot.options.map((option) => ({ ...partial, [slot.id]: option.id })));
  }

  const wrong = combinations.filter((guess) =>
    slots.some((slot) => guess[slot.id] !== puzzle.answer[slot.id]));

  return wrong[nth % wrong.length];
}

/** Every mode and tier, with every exercise a mode offers. */
export function everyRound() {
  const rounds = [];

  for (const id of MODE_IDS) {
    const exercise = (MODES[id].settings ?? []).find((setting) => setting.id === 'exercise');
    const exercises = exercise ? exercise.options.map((option) => option.id) : [null];

    for (const tier of Object.keys(MODES[id].tiers)) {
      for (const which of exercises) {
        rounds.push([id, tier, which ? { exercise: which } : {}]);
      }
    }
  }

  return rounds;
}
