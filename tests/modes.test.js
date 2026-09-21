import test from 'node:test';
import assert from 'node:assert/strict';

import { MODES, MODE_IDS, modeOf } from '../src/modes/index.js';
import { HIT, NEAR, MISS } from '../src/modes/scoring.js';
import {
  makePuzzle, createGame, submitGuess, combinationsFor, reveal, settingsFor, startingGuess,
} from '../src/game.js';
import { answerAsGuess, wrongGuess, everyRound } from './helpers.js';

const ROUNDS = everyRound();

test('every mode is the same shape, so the shell never has to ask which it is', () => {
  for (const [id, mode] of Object.entries(MODES)) {
    assert.equal(mode.id, id, 'a mode knows its own key');
    assert.ok(mode.label && mode.blurb && mode.lede, `${id} has to introduce itself`);
    for (const fn of ['slots', 'makePuzzle', 'score', 'clues', 'play', 'reveal', 'weak']) {
      assert.equal(typeof mode[fn], 'function', `${id} is missing ${fn}`);
    }
    assert.ok(Object.keys(mode.tiers).length >= 2, `${id} needs tiers to be a tier`);
    for (const setting of mode.settings ?? []) {
      assert.ok(setting.options.length >= 2, `${id}'s ${setting.id} has to be a choice`);
    }
  }
});

test('a tier gives you enough guesses to deduce and not enough to enumerate', () => {
  for (const [id, tier] of ROUNDS) {
    const spec = MODES[id].tiers[tier];
    const combinations = combinationsFor(id, tier);
    assert.ok(spec.guesses >= 2, `${id}/${tier} needs at least two guesses`);
    assert.ok(spec.guesses < combinations,
      `${id}/${tier} allows ${spec.guesses} guesses at ${combinations} answers - that is enumeration`);
  }
});

test('a slot is either options to pick or a control to dial, and says which', () => {
  for (const [id, tier, settings] of ROUNDS) {
    for (const slot of MODES[id].slots(tier, settingsFor(id, settings))) {
      assert.ok(slot.id && slot.label, `${id}/${tier} slot needs an id and a question`);

      if (slot.kind === 'range') {
        assert.ok(slot.max > slot.min, `${id}/${tier}/${slot.id} has no range`);
        assert.ok(slot.log || slot.step > 0, `${id}/${tier}/${slot.id} has no step`);
        assert.equal(typeof slot.format, 'function', `${id}/${tier}/${slot.id} cannot write itself down`);
        assert.ok(slot.hit < slot.near, `${id}/${tier}/${slot.id}: close has to be wider than right`);
        assert.ok(slot.below && slot.above, `${id}/${tier}/${slot.id} cannot say which way to turn`);
        assert.ok(slot.start >= slot.min && slot.start <= slot.max,
          `${id}/${tier}/${slot.id} starts off its own scale`);
        continue;
      }

      const ids = slot.options.map((option) => option.id);
      assert.equal(new Set(ids).size, ids.length, `${id}/${tier}/${slot.id} repeats an option`);
      for (const option of slot.options) {
        assert.ok(option.symbol, `${id}/${tier} option ${option.id} has nothing written on it`);
      }
    }
  }
});

test('generated answers are always reachable from the controls on screen', () => {
  for (const [id, tier, settings] of ROUNDS) {
    const chosen = settingsFor(id, settings);
    for (let i = 0; i < 40; i += 1) {
      const puzzle = makePuzzle({ mode: id, tier, settings: chosen, seed: `${id}-${tier}-${i}` });

      for (const slot of MODES[id].slots(tier, chosen)) {
        const answer = puzzle.answer[slot.id];
        if (slot.kind === 'range') {
          assert.ok(answer >= slot.min && answer <= slot.max,
            `${id}/${tier} answers ${slot.id}=${answer}, off its own control`);
        } else {
          assert.ok(slot.options.some((option) => option.id === answer),
            `${id}/${tier} answers ${slot.id}=${answer}, which is not on offer`);
        }
      }
    }
  }
});

test('matching exactly what was played wins, in every mode, tier and exercise', () => {
  for (const [id, tier, settings] of ROUNDS) {
    const chosen = settingsFor(id, settings);
    const puzzle = makePuzzle({ mode: id, tier, settings: chosen, seed: `win-${id}-${tier}` });
    const score = MODES[id].score(answerAsGuess(puzzle), puzzle.answer, tier);

    assert.ok(score.correct, `${id}/${tier} does not accept its own answer`);
    for (const cell of score.cells) {
      assert.equal(cell.state, HIT, `${id}/${tier} reads a perfect guess as ${cell.state}`);
    }
  }
});

test('a wrong guess is read as wrong, and says which way to move', () => {
  for (const [id, tier, settings] of ROUNDS) {
    const chosen = settingsFor(id, settings);
    const puzzle = makePuzzle({ mode: id, tier, settings: chosen, seed: `miss-${id}-${tier}` });
    const score = MODES[id].score(wrongGuess(puzzle), puzzle.answer, tier);

    assert.ok(!score.correct, `${id}/${tier} accepted a guess outside every tolerance`);

    const dialled = MODES[id].slots(tier, chosen).filter((slot) => slot.kind === 'range');
    if (!dialled.length) continue;

    // A control that is out says how far and which way, or the next attempt is
    // a guess rather than an adjustment.
    for (const [i, slot] of dialled.entries()) {
      const cell = score.cells[i];
      if (cell.state === HIT) continue;
      assert.match(cell.text, new RegExp(`${slot.below}|${slot.above}`),
        `${id}/${tier}/${slot.id} says "${cell.text}", which does not say which way`);
    }
  }
});

test('a reading comes back for every slot, and never fewer than two', () => {
  for (const [id, tier, settings] of ROUNDS) {
    const chosen = settingsFor(id, settings);
    const puzzle = makePuzzle({ mode: id, tier, settings: chosen, seed: `cells-${id}-${tier}` });
    const slots = MODES[id].slots(tier, chosen);
    const cells = MODES[id].score(answerAsGuess(puzzle), puzzle.answer, tier).cells;

    assert.ok(cells.length >= slots.length, `${id}/${tier} drops a slot from the board`);
    assert.ok(cells.length >= 2, `${id}/${tier} has nothing to make a row out of`);

    // Picking from chips: the cell is the pick, so a mode that only does that
    // owes the player a reading of its own beyond it.
    if (slots.every((slot) => slot.kind !== 'range')) {
      assert.ok(cells.length > slots.length,
        `${id}/${tier} says nothing beyond repeating the guess back`);
    }

    for (const cell of cells) {
      assert.ok([HIT, NEAR, MISS].includes(cell.state), `${id}/${tier} invented a state`);
      assert.ok(String(cell.text).length > 0, `${id}/${tier} has an empty cell`);
    }
  }
});

test('every mode can say what the answer was, and what kind of answer it is', () => {
  for (const [id, tier, settings] of ROUNDS) {
    const puzzle = makePuzzle({ mode: id, tier, settings: settingsFor(id, settings), seed: `reveal-${id}-${tier}` });
    assert.ok(reveal(puzzle).symbol, `${id}/${tier} reveals nothing`);

    const kind = MODES[id].weak(puzzle.answer);
    assert.ok(kind.key !== undefined && kind.label, `${id}/${tier} cannot name a weak spot`);
  }
});

test('the first clue is the one that plays the thing being worked on', () => {
  for (const [id, tier, settings] of ROUNDS) {
    const clues = MODES[id].clues(tier, settingsFor(id, settings));
    assert.ok(clues.length >= 1, `${id} offers no way to hear it`);
    assert.equal(clues.filter((clue) => clue.primary).length, 1, `${id} needs exactly one primary clue`);
    assert.equal(clues[0].primary, true, 'the primary clue comes first');
  }
});

test('a production mode lets you hear your own settings, not only the target', () => {
  for (const [id, tier, settings] of ROUNDS) {
    const chosen = settingsFor(id, settings);
    const dialled = MODES[id].slots(tier, chosen).some((slot) => slot.kind === 'range');
    if (!dialled) continue;

    const ids = MODES[id].clues(tier, chosen).map((clue) => clue.id);
    assert.ok(ids.includes('mine'),
      `${id}/${tier}/${chosen.exercise ?? '-'} gives you controls and no way to hear them`);
  }
});

test('the fix exercise hands you a fault, and the answer cures it', () => {
  for (const tier of Object.keys(MODES.eq.tiers)) {
    const puzzle = makePuzzle({ mode: 'eq', tier, settings: { exercise: 'fix' }, seed: `fix-${tier}` });

    assert.ok(puzzle.fault, 'the sample has to be faulty for there to be anything to fix');
    assert.equal(puzzle.answer.frequency, puzzle.fault.frequency, 'cure it where it is');
    assert.equal(puzzle.answer.gain, -puzzle.fault.gain, 'the cure is the inverse of the fault');
    assert.equal(puzzle.answer.q, puzzle.fault.q, 'and as wide as the fault is');
    assert.ok(puzzle.answer.gain < 0, 'a resonance is cut, not boosted');
  }

  // Matching hands you no fault: the sample is clean and the move is the target's.
  const match = makePuzzle({ mode: 'eq', tier: 'easy', settings: { exercise: 'match' }, seed: 'm' });
  assert.equal(match.fault, undefined);
});

test('evening out a loop asks for the settings that measurably even it out', () => {
  for (const seed of ['even', 'even-2', 'even-3']) {
    const puzzle = makePuzzle({ mode: 'compression', tier: 'medium', settings: { exercise: 'fix' }, seed });

    assert.ok(puzzle.uneven >= 9 && puzzle.uneven <= 15, 'the loop has to be uneven to need evening');

    // Well under the quiet hits, and harder than the paper arithmetic - which
    // is what the rendered grid says it takes. See the mode for why.
    assert.equal(puzzle.answer.threshold, -6 - puzzle.uneven - 9);
    assert.ok(Math.abs(puzzle.answer.ratio - puzzle.uneven / 2.5) <= 0.5);
    assert.ok(puzzle.answer.ratio > puzzle.uneven / 4, 'a gentle ratio does not level anything');
  }
});

test('chords: the reading is made from the shape, so the root cannot leak into it', () => {
  const low = MODES.chords.score({ quality: 'major' }, { root: 0, quality: 'minor' }, 'easy');
  const high = MODES.chords.score({ quality: 'major' }, { root: 7, quality: 'minor' }, 'easy');
  assert.deepEqual(low, high);
  assert.equal(low.cells[0].state, NEAR, 'major and minor share the fifth');
  assert.equal(low.cells[1].text, '1/2');
});

test('eq: an octave out is close, a decade out is not, and both say which way', () => {
  const answer = { frequency: 1000, gain: -6, q: 1.4 };
  const close = MODES.eq.score({ frequency: 2000, gain: -6, q: 1.4 }, answer, 'easy');
  assert.equal(close.cells[0].state, NEAR);
  assert.match(close.cells[0].text, /high$/, 'dialled above the answer');
  assert.equal(close.cells[1].state, HIT, 'the gain itself was right');

  const far = MODES.eq.score({ frequency: 120, gain: -6, q: 1.4 }, answer, 'easy');
  assert.equal(far.cells[0].state, MISS);
  assert.match(far.cells[0].text, /low$/);

  // Boosting where a cut was wanted is the one thing that is simply backwards.
  const backwards = MODES.eq.score({ frequency: 1000, gain: 6, q: 1.4 }, answer, 'easy');
  assert.equal(backwards.cells[1].state, MISS);
  assert.match(backwards.cells[1].text, /hot$/);
});

test('compression: too gentle and too hard are told apart', () => {
  const answer = { threshold: -20, ratio: 8, attack: 10 };
  const soft = MODES.compression.score({ threshold: -20, ratio: 2, attack: 10 }, answer, 'medium');
  assert.equal(soft.cells[1].state, MISS);
  assert.match(soft.cells[1].text, /soft$/);

  const nearly = MODES.compression.score({ threshold: -20, ratio: 16, attack: 10 }, answer, 'medium');
  assert.equal(nearly.cells[1].state, NEAR);
  assert.match(nearly.cells[1].text, /hard$/);
});

test('panning: the reading says how far off and on which side', () => {
  const off = MODES.panning.score({ pan: -50 }, { pan: 0 }, 'hard');
  assert.equal(off.cells[0].state, MISS);
  assert.match(off.cells[1].text, /left$/);
  assert.equal(MODES.panning.score({ pan: 5 }, { pan: 0 }, 'hard').cells[0].state, HIT);
});

test('rhythm: getting the feel and missing the figure still says so', () => {
  const sameFeel = MODES.rhythm.score({ pattern: 'clave23' }, { pattern: 'clave32' }, 'hard');
  assert.equal(sameFeel.cells[0].state, NEAR);
  assert.equal(sameFeel.cells[1].state, HIT, 'the feel was right');
});

test('pitch and intervals: how far off is the short way round', () => {
  assert.equal(MODES.pitch.score({ note: '11' }, { note: '0' }, 'medium').cells[1].text, '1 semitone');
  assert.equal(MODES.intervals.score({ interval: '6' }, { interval: '7' }, 'hard').cells[0].state, NEAR);
});

test('a mode plays every one of its clues, without touching the DOM', () => {
  // Every mode's play() is handed an engine and asks it for sounds; nothing in
  // a mode reaches for the page. A recording engine proves it here, and keeps
  // the modes testable without a browser.
  const calls = [];
  const node = () => ({ connect: (next) => next ?? {}, gain: {}, pan: {}, frequency: {}, Q: {},
                        threshold: {}, knee: {}, ratio: {}, attack: {}, release: {}, type: '' });
  const engine = {
    ensure: () => {},
    stop: () => {},
    get start() { return 0; },
    ctx: {
      createBiquadFilter: node,
      createStereoPanner: node,
      createDynamicsCompressor: node,
      createGain: node,
    },
    out: {},
    note: (...args) => calls.push(['note', ...args]),
    tone: (...args) => calls.push(['tone', ...args]),
    playNotes: (...args) => calls.push(['notes', ...args]),
    playBed: (...args) => calls.push(['bed', ...args]),
    playPattern: (...args) => calls.push(['pattern', ...args]),
  };

  for (const [id, tier, settings] of ROUNDS) {
    const chosen = settingsFor(id, settings);
    const puzzle = makePuzzle({ mode: id, tier, settings: chosen, seed: `play-${id}-${tier}` });
    const guess = { ...startingGuess(id, tier), ...answerAsGuess(puzzle) };

    for (const clue of MODES[id].clues(tier, chosen)) {
      calls.length = 0;
      MODES[id].play(engine, { puzzle, clue: clue.id, settings: chosen, tier, guess });
      assert.ok(calls.length > 0, `${id}/${tier}: the ${clue.id} clue makes no sound`);
    }
  }
});

test('a whole round can be played out in every mode, tier and exercise', () => {
  for (const [id, tier, settings] of ROUNDS) {
    const chosen = settingsFor(id, settings);
    const puzzle = makePuzzle({ mode: id, tier, settings: chosen, seed: `round-${id}-${tier}` });
    let game = createGame(puzzle);

    for (let i = 0; i < game.allowed - 1; i += 1) game = submitGuess(game, wrongGuess(puzzle, i));
    assert.equal(game.status, 'playing', `${id}/${tier} ended early`);

    game = submitGuess(game, answerAsGuess(puzzle));
    assert.equal(game.status, 'won', `${id}/${tier} did not accept the answer`);
  }
});
