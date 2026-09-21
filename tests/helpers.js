import { MODES, MODE_IDS, modeOf } from '../src/modes/index.js';

/**
 * The answer, as a guess - or nothing, when the round does not have one.
 *
 * A mode with its own interface hands back whatever that interface builds -
 * for the EQ, a set of bands - so the answer is already in that shape and is
 * its own perfect guess.
 *
 * Two of the compressor's exercises are marked on what came out rather than
 * against a stored setting, so there is no answer to hand back: evening out a
 * loop is done when the loop sits still, and there are many compressors that
 * will do it. Those rounds say so by returning null, and the tests that want
 * a winning guess skip them - with their own tests, further down, for the
 * thing those exercises actually promise.
 */
export function answerAsGuess(puzzle) {
  const spec = modeOf(puzzle.mode);

  if (spec.surface) {
    if (!puzzle.answer) return null;
    if (RESULT_MARKED[puzzle.mode]?.includes(puzzle.settings?.exercise)) return null;
    return puzzle.answer;
  }

  return Object.fromEntries(
    spec.slots(puzzle.tier, puzzle.settings)
      .map((slot) => [slot.id, puzzle.answer[slot.id]]),
  );
}

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/**
 * The exercises that are marked on what came out rather than against a stored
 * setting, and so keep no answer that could be played back.
 *
 * Levelling a loop is done when the loop sits still and there are many
 * compressors that will do it; ducking and fitting a room to a tempo are
 * described by what they achieve. Named here rather than guessed at, because
 * the guess would have to be something like "the answer does not look like a
 * setting", and a reverb asked to answer on a sixteenth has a pre-delay in
 * its answer and looks exactly like one.
 */
const RESULT_MARKED = {
  compression: ['fix', 'duck'],
  reverb: ['tempo'],
};

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

  // A surface hands back whatever it builds, so a wrong guess has to be in
  // that shape. Both of these are a long way from any target their mode sets.
  if (spec.surface) {
    if (puzzle.mode === 'compression') {
      // Far lower and far harder than any answer this mode makes, and a
      // different threshold each time so no two attempts are the same guess.
      return { threshold: -55 + nth, ratio: 18, attack: 1, release: 30, sidechain: false };
    }

    if (puzzle.mode === 'delay') {
      // Far longer than any note value at this tempo, and swamped - which is
      // wrong for matching a delay and wrong for finding a time.
      return { time: 1300 + nth * 20, feedback: 0.75, mix: 0.9, tone: 20000, lowCut: 20 };
    }

    if (puzzle.mode === 'reverb') {
      // Longer than any room this mode asks for, answering instantly, and
      // soaked - which is wrong for matching a space and wrong for fitting a
      // tempo, since a seven second tail is never gone by the next beat.
      return { decay: 7 + nth * 0.2, preDelay: 4, mix: 0.9, damping: 1, early: 0 };
    }

    // Nothing dialled at all, then a band in the wrong place.
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
