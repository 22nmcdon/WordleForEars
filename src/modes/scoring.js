// What the modes have in common when they score a guess.
//
// Most of these questions are "pick one off an ordered scale" - a frequency
// band, a pan position, a ratio - where the next-door answer is a near miss
// and two along is not. That reading is written once, here.

export const HIT = 'hit'; // sage - that is it
export const NEAR = 'near'; // gold - close, or partly right
export const MISS = 'miss'; // rust - nothing in common

/** Hit on the answer, near next door to it, miss beyond that. */
export function onScale(guessIndex, answerIndex, { near = 1 } = {}) {
  const steps = Math.abs(guessIndex - answerIndex);
  if (steps === 0) return HIT;
  return steps <= near ? NEAR : MISS;
}

/** Hit on the answer, near when it leans the same way, miss when it does not. */
export function bySign(guess, answer) {
  if (guess === answer) return HIT;
  return Math.sign(guess) === Math.sign(answer) ? NEAR : MISS;
}

/** How far off, said in the units of the thing being guessed. */
export function distanceCell(steps, unit) {
  const away = Math.abs(steps);
  return {
    state: away === 0 ? HIT : away === 1 ? NEAR : MISS,
    text: away === 0 ? 'spot on' : `${away} ${unit}${away === 1 ? '' : 's'}`,
    narrow: true,
  };
}

/** Pick one of a list, deterministically. */
export const pick = (rng, list) => list[Math.floor(rng() * list.length)];

/** Every combination of the slots' options - what "enough to deduce" is measured against. */
export function combinations(slots) {
  return slots.reduce((total, slot) => total * slot.options.length, 1);
}
