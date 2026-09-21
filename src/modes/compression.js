import { dbToGain } from '../audio.js';
import { HIT, MISS, onScale, distanceCell, pick } from './scoring.js';

/**
 * The plan calls this one genuinely difficult even for pros, and it is - so
 * the question is asked the way an engineer would actually ask it: not "what
 * ratio" in the abstract, but "how hard is this being squashed", against the
 * same loop at the same loudness.
 *
 * Matching the loudness is the whole job. A clip that arrives louder than the
 * last one is a level test, not a compression test, and the answer would be
 * "the loud one" every time.
 *
 * `trim` is what does it, and it is measured rather than derived. Web Audio's
 * compressor applies a makeup gain of its own - it is in the node, not in the
 * spec's arithmetic - so a setting is not merely quieter than flat, it is
 * often considerably louder: 20:1 with a slow attack came back peaking at 1.8
 * where the source peaked at 0.34, which is clipping as well as a giveaway.
 * These numbers are the decibels that put each setting back on the loudness of
 * the untouched loop, rendered offline against both sources and averaged, so
 * the residual is a decibel or so either way rather than ten.
 *
 * Re-measure them if the bed changes: scripts in the repo's history render
 * every setting and print what each one needs.
 */
const squash = (id, ratio, threshold, symbol, name, trim) => ({ id, ratio, threshold, symbol, name, trim });

const NONE = squash('none', 1, 0, 'None', 'untouched', { fast: 0, slow: 0 });
const LIGHT = squash('light', 4, -18, 'Light', 'gentle', { fast: -2.3, slow: -4.9 });
const HEAVY = squash('heavy', 20, -30, 'Heavy', 'slammed', { fast: -1.1, slow: -9.0 });

const RATIOS = [
  squash('2', 2, -24, '2 : 1', 'barely leaning', { fast: -0.9, slow: -3.7 }),
  squash('4', 4, -24, '4 : 1', 'working', { fast: -1.6, slow: -5.8 }),
  squash('8', 8, -24, '8 : 1', 'holding it down', { fast: -2.0, slow: -7.0 }),
  squash('20', 20, -24, '20 : 1', 'limiting', { fast: -2.3, slow: -7.7 }),
];

const ATTACKS = [
  { id: 'fast', symbol: 'Fast', name: 'transients gone' },
  { id: 'slow', symbol: 'Slow', name: 'transients through' },
];

const find = (id) => [NONE, LIGHT, HEAVY, ...RATIOS].find((s) => s.id === id);

export default {
  id: 'compression',
  label: 'Compression',
  blurb: 'How hard is it being squashed',
  lede: 'A loop, compressed and loudness-matched so there is no level to give '
      + 'it away. Listen to what happens to the transients and the tail.',
  advice: 'The hardest mode here, and the plan says so: this one is difficult even for people who do it for a living.',

  tiers: {
    easy: { label: 'Easy', blurb: 'Is it even squashed', guesses: 2, amounts: [NONE, LIGHT, HEAVY] },
    medium: { label: 'Medium', blurb: 'Roughly what ratio', guesses: 3, amounts: RATIOS },
    hard: { label: 'Hard', blurb: 'Ratio and attack', guesses: 4, amounts: RATIOS, attack: true },
  },

  setting: {
    id: 'source',
    label: 'Source',
    options: [
      { id: 'drums', label: 'Drums' },
      { id: 'mix', label: 'Full mix' },
    ],
  },

  slots(tier) {
    const spec = this.tiers[tier];
    const slots = [{
      id: 'amount',
      heading: 'squash',
      label: spec.attack ? 'How hard is it working?' : 'How much squash?',
      options: spec.amounts,
    }];

    if (spec.attack) {
      slots.push({
        id: 'attack',
        heading: 'attack',
        label: 'Is it catching the transients?',
        options: ATTACKS,
      });
    }
    return slots;
  },

  makePuzzle(rng, tier) {
    const spec = this.tiers[tier];
    const answer = { amount: pick(rng, spec.amounts).id };
    if (spec.attack) answer.attack = pick(rng, ATTACKS).id;
    return { answer };
  },

  score(guess, answer, tier) {
    const spec = this.tiers[tier];
    const guessed = spec.amounts.findIndex((a) => a.id === guess.amount);
    const actual = spec.amounts.findIndex((a) => a.id === answer.amount);

    const cells = [{ state: onScale(guessed, actual), text: find(guess.amount).symbol }];
    let correct = guess.amount === answer.amount;

    // Whether the transients are being caught is its own question, and a
    // wrong ratio with the right attack is worth knowing about.
    if (spec.attack) {
      const right = guess.attack === answer.attack;
      correct = correct && right;
      cells.push({
        state: right ? HIT : MISS,
        text: ATTACKS.find((a) => a.id === guess.attack).symbol,
      });
    }

    // How far off the ratio was, either way: the colour says near or not, and
    // this says which side of the answer you are on.
    cells.push(distanceCell(guessed - actual, 'step'));

    return { correct, cells };
  },

  clues() {
    return [
      { id: 'processed', label: 'Play it', primary: true },
      { id: 'bypassed', label: 'Uncompressed' },
    ];
  },

  play(engine, puzzle, clue, setting, tier) {
    engine.ensure();

    if (clue === 'bypassed') {
      engine.playBed(setting, { seconds: 3.6 });
      return;
    }

    const spec = find(puzzle.answer.amount);
    const slow = this.tiers[tier].attack && puzzle.answer.attack === 'slow';

    const compressor = engine.ctx.createDynamicsCompressor();
    compressor.threshold.value = spec.threshold;
    compressor.knee.value = 6;
    compressor.ratio.value = spec.ratio;
    compressor.attack.value = slow ? 0.06 : 0.003;
    compressor.release.value = 0.16;

    // Back onto the loudness of the untouched loop - see `trim` above.
    const trim = engine.ctx.createGain();
    trim.gain.value = dbToGain(slow ? spec.trim.slow : spec.trim.fast);

    compressor.connect(trim).connect(engine.out);
    engine.playBed(setting, { seconds: 3.6, dest: compressor });
  },

  reveal(answer) {
    const spec = find(answer.amount);
    const attack = answer.attack ? `, ${ATTACKS.find((a) => a.id === answer.attack).symbol.toLowerCase()} attack` : '';
    return { symbol: spec.symbol, name: `${spec.name}${attack}` };
  },

  weak(answer) {
    return { key: answer.amount, label: find(answer.amount).symbol };
  },
};
