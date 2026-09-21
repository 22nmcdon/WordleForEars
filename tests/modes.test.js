import test from 'node:test';
import assert from 'node:assert/strict';

import { MODES, MODE_IDS, modeOf } from '../src/modes/index.js';
import { HIT, NEAR, MISS } from '../src/modes/scoring.js';
import { makePuzzle, createGame, submitGuess, combinationsFor, reveal } from '../src/game.js';

const everyTier = () => MODE_IDS.flatMap((id) => Object.keys(MODES[id].tiers).map((tier) => [id, tier]));

/** The answer, as a guess: every slot set to what the puzzle actually is. */
const answerAsGuess = (puzzle) => Object.fromEntries(
  modeOf(puzzle.mode).slots(puzzle.tier).map((slot) => [slot.id, puzzle.answer[slot.id]]),
);

test('every mode is the same shape, so the shell never has to ask which it is', () => {
  for (const [id, mode] of Object.entries(MODES)) {
    assert.equal(mode.id, id, 'a mode knows its own key');
    assert.ok(mode.label && mode.blurb && mode.lede, `${id} has to introduce itself`);
    for (const fn of ['slots', 'makePuzzle', 'score', 'clues', 'play', 'reveal', 'weak']) {
      assert.equal(typeof mode[fn], 'function', `${id} is missing ${fn}`);
    }
    assert.ok(Object.keys(mode.tiers).length >= 2, `${id} needs tiers to be a tier`);
    if (mode.setting) {
      assert.ok(mode.setting.options.length >= 2, `${id}'s setting has to be a choice`);
    }
  }
});

test('a tier gives you enough guesses to deduce and not enough to enumerate', () => {
  for (const [id, tier] of everyTier()) {
    const spec = MODES[id].tiers[tier];
    const combinations = combinationsFor(id, tier);
    assert.ok(spec.guesses >= 2, `${id}/${tier} needs at least two guesses`);
    assert.ok(spec.guesses < combinations,
      `${id}/${tier} allows ${spec.guesses} guesses at ${combinations} answers - that is enumeration`);
  }
});

test('every slot offers distinct options, and each has something to show', () => {
  for (const [id, tier] of everyTier()) {
    for (const slot of MODES[id].slots(tier)) {
      assert.ok(slot.id && slot.label, `${id}/${tier} slot needs an id and a question`);
      const ids = slot.options.map((option) => option.id);
      assert.equal(new Set(ids).size, ids.length, `${id}/${tier}/${slot.id} repeats an option`);
      for (const option of slot.options) {
        assert.ok(option.symbol, `${id}/${tier} option ${option.id} has nothing written on it`);
      }
    }
  }
});

test('generated answers are always answerable from the chips on screen', () => {
  for (const [id, tier] of everyTier()) {
    for (let i = 0; i < 60; i += 1) {
      const puzzle = makePuzzle({ mode: id, tier, seed: `${id}-${tier}-${i}` });
      for (const slot of MODES[id].slots(tier)) {
        const offered = slot.options.some((option) => option.id === puzzle.answer[slot.id]);
        assert.ok(offered, `${id}/${tier} can answer ${slot.id}=${puzzle.answer[slot.id]}, which is not on offer`);
      }
    }
  }
});

test('naming exactly what was played wins, in every mode and tier', () => {
  for (const [id, tier] of everyTier()) {
    const puzzle = makePuzzle({ mode: id, tier, seed: `win-${id}-${tier}` });
    const score = MODES[id].score(answerAsGuess(puzzle), puzzle.answer, tier);

    assert.ok(score.correct, `${id}/${tier} does not accept its own answer`);
    for (const cell of score.cells) {
      assert.equal(cell.state, HIT, `${id}/${tier} reads a perfect guess as ${cell.state}`);
    }
  }
});

test('a reading is returned for every slot, plus at least one of its own', () => {
  for (const [id, tier] of everyTier()) {
    const puzzle = makePuzzle({ mode: id, tier, seed: `cells-${id}-${tier}` });
    const slots = MODES[id].slots(tier);
    const cells = MODES[id].score(answerAsGuess(puzzle), puzzle.answer, tier).cells;

    assert.ok(cells.length > slots.length,
      `${id}/${tier} says nothing beyond repeating the guess back`);
    for (const cell of cells) {
      assert.ok([HIT, NEAR, MISS].includes(cell.state), `${id}/${tier} invented a state`);
      assert.ok(String(cell.text).length > 0, `${id}/${tier} has an empty cell`);
    }
  }
});

test('every mode can say what the answer was, and what kind of answer it is', () => {
  for (const [id, tier] of everyTier()) {
    const puzzle = makePuzzle({ mode: id, tier, seed: `reveal-${id}-${tier}` });
    const said = reveal(puzzle);
    assert.ok(said.symbol, `${id}/${tier} reveals nothing`);

    const kind = MODES[id].weak(puzzle.answer);
    assert.ok(kind.key !== undefined && kind.label, `${id}/${tier} cannot name a weak spot`);
  }
});

test('the first clue is the one that plays the thing being guessed', () => {
  for (const [id, tier] of everyTier()) {
    const clues = MODES[id].clues(tier, MODES[id].setting?.options[0].id);
    assert.ok(clues.length >= 1, `${id} offers no way to hear it`);
    assert.equal(clues.filter((clue) => clue.primary).length, 1,
      `${id} needs exactly one primary clue`);
    assert.equal(clues[0].primary, true, 'the primary clue comes first');
  }
});

test('chords: the reading is made from the shape, so the root cannot leak into it', () => {
  const low = MODES.chords.score({ quality: 'major' }, { root: 0, quality: 'minor' }, 'easy');
  const high = MODES.chords.score({ quality: 'major' }, { root: 7, quality: 'minor' }, 'easy');
  assert.deepEqual(low, high);
  assert.equal(low.cells[0].state, NEAR, 'major and minor share the fifth');
  assert.equal(low.cells[1].text, '1/2');

  const far = MODES.chords.score({ quality: 'augmented' }, { root: 3, quality: 'diminished' }, 'easy');
  assert.equal(far.cells[0].state, MISS);
});

test('eq: the next band along is close, the far end of the spectrum is not', () => {
  const answer = { band: '800', move: '10' };
  const next = MODES.eq.score({ band: '3000', move: '10' }, answer, 'easy');
  assert.equal(next.cells[0].state, NEAR, 'one zone up is a near miss');
  assert.equal(next.cells[1].state, HIT, 'the move itself was right');

  const far = MODES.eq.score({ band: '80', move: '10' }, answer, 'easy');
  assert.equal(far.cells[0].state, MISS);
  assert.match(far.cells[2].text, /oct/, 'how far off is said in octaves');

  // Boost against cut is the one thing that is simply the wrong way round.
  const wrongWay = MODES.eq.score({ band: '800', move: '-10' }, answer, 'easy');
  assert.equal(wrongWay.cells[1].state, MISS);
  const rightWay = MODES.eq.score({ band: '800', move: '3' }, { band: '800', move: '6' }, 'medium');
  assert.equal(rightWay.cells[1].state, NEAR, 'same direction, wrong amount');
});

test('pitch: how far off is the short way round the circle', () => {
  // B to C is one semitone, not eleven.
  const close = MODES.pitch.score({ note: '11' }, { note: '0' }, 'medium');
  assert.equal(close.cells[0].state, NEAR);
  assert.equal(close.cells[1].text, '1 semitone');

  const far = MODES.pitch.score({ note: '6' }, { note: '0' }, 'medium');
  assert.equal(far.cells[0].state, MISS);
  assert.equal(far.cells[1].text, '6 semitones');
});

test('intervals: a semitone out is close, a third out is not', () => {
  assert.equal(MODES.intervals.score({ interval: '6' }, { interval: '7' }, 'hard').cells[0].state, NEAR);
  assert.equal(MODES.intervals.score({ interval: '3' }, { interval: '7' }, 'hard').cells[0].state, MISS);
});

test('rhythm: getting the feel and missing the figure still says so', () => {
  const sameFeel = MODES.rhythm.score({ pattern: 'clave23' }, { pattern: 'clave32' }, 'hard');
  assert.equal(sameFeel.cells[0].state, NEAR);
  assert.equal(sameFeel.cells[1].state, HIT, 'the feel was right');
  assert.equal(sameFeel.cells[1].text, 'syncopated');

  const wrongFeel = MODES.rhythm.score({ pattern: 'eighths' }, { pattern: 'clave32' }, 'hard');
  assert.equal(wrongFeel.cells[0].state, MISS);
  assert.equal(wrongFeel.cells[1].state, MISS);
});

test('panning: one place off is close, the other side of the field is not', () => {
  assert.equal(MODES.panning.score({ spot: '0' }, { spot: '0.5' }, 'medium').cells[0].state, NEAR);
  assert.equal(MODES.panning.score({ spot: '-1' }, { spot: '1' }, 'medium').cells[0].state, MISS);
});

test('compression: every setting carries the trim that matches its loudness', () => {
  for (const tier of ['easy', 'medium', 'hard']) {
    for (const amount of MODES.compression.tiers[tier].amounts) {
      assert.equal(typeof amount.trim.fast, 'number', `${amount.id} has no fast trim`);
      assert.equal(typeof amount.trim.slow, 'number', `${amount.id} has no slow trim`);
      assert.ok(amount.trim.slow <= amount.trim.fast,
        `${amount.id}: a slow attack lets more through, so it cannot need less trim`);
    }
  }

  // The hard tier asks two questions, and both have to be right.
  const answer = { amount: '4', attack: 'fast' };
  const halfRight = MODES.compression.score({ amount: '4', attack: 'slow' }, answer, 'hard');
  assert.equal(halfRight.correct, false);
  assert.equal(halfRight.cells[0].state, HIT);
  assert.equal(halfRight.cells[1].state, MISS);
});

test('a mode plays its clue without touching the DOM', async () => {
  // Every mode's play() is handed an engine and asks it for sounds; nothing in
  // a mode reaches for the page. A recording engine proves it here, and keeps
  // the modes testable without a browser.
  const calls = [];
  const engine = {
    ensure: () => {},
    stop: () => {},
    get start() { return 0; },
    ctx: {
      createBiquadFilter: () => ({ type: '', frequency: {}, Q: {}, gain: {}, connect: () => {} }),
      createStereoPanner: () => ({ pan: {}, connect: () => {} }),
      createDynamicsCompressor: () => ({
        threshold: {}, knee: {}, ratio: {}, attack: {}, release: {}, connect: (n) => n,
      }),
      createGain: () => ({ gain: {}, connect: () => {} }),
    },
    out: {},
    note: (...args) => calls.push(['note', ...args]),
    tone: (...args) => calls.push(['tone', ...args]),
    playNotes: (...args) => calls.push(['notes', ...args]),
    playBed: (...args) => calls.push(['bed', ...args]),
    playPattern: (...args) => calls.push(['pattern', ...args]),
  };

  for (const [id, tier] of everyTier()) {
    const setting = MODES[id].setting?.options[0].id ?? null;
    const puzzle = makePuzzle({ mode: id, tier, setting, seed: `play-${id}-${tier}` });

    for (const clue of MODES[id].clues(tier, setting)) {
      calls.length = 0;
      MODES[id].play(engine, puzzle, clue.id, setting, tier);
      assert.ok(calls.length > 0, `${id}/${tier}: the ${clue.id} clue makes no sound`);
    }
  }
});

test('a whole round can be played out in every mode', () => {
  for (const [id, tier] of everyTier()) {
    const puzzle = makePuzzle({ mode: id, tier, seed: `round-${id}-${tier}` });
    let game = createGame(puzzle);
    const slots = MODES[id].slots(tier);

    // Every guess but the last is deliberately not the answer.
    for (let i = 0; i < game.allowed - 1; i += 1) {
      const guess = Object.fromEntries(slots.map((slot) => {
        const others = slot.options.filter((option) => option.id !== puzzle.answer[slot.id]);
        return [slot.id, (others[i] ?? others[0] ?? slot.options[0]).id];
      }));
      game = submitGuess(game, guess);
    }
    assert.equal(game.status, 'playing', `${id}/${tier} ended early`);

    game = submitGuess(game, answerAsGuess(puzzle));
    assert.equal(game.status, 'won', `${id}/${tier} did not accept the answer`);
  }
});
