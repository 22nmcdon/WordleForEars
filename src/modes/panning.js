import { onScale, distanceCell, pick } from './scoring.js';

/** Where it sits, from hard left to hard right. */
const spot = (pan, symbol, name) => ({ id: String(pan), pan, symbol, name });

const HARD_LEFT = spot(-1, 'L', 'hard left');
const HALF_LEFT = spot(-0.5, '50% L', 'half left');
const CENTRE = spot(0, 'C', 'centre');
const HALF_RIGHT = spot(0.5, '50% R', 'half right');
const HARD_RIGHT = spot(1, 'R', 'hard right');

export default {
  id: 'panning',
  label: 'Panning',
  blurb: 'Where is it in the stereo field',
  lede: 'The same few bars, placed somewhere across the stereo field. '
      + 'Say where.',
  advice: 'Headphones, for this one — a laptop speaker has almost no stereo field to point at.',

  tiers: {
    easy: { label: 'Easy', blurb: 'Left, centre, right', guesses: 2, spots: [HARD_LEFT, CENTRE, HARD_RIGHT] },
    medium: { label: 'Medium', blurb: 'Five positions', guesses: 3,
              spots: [HARD_LEFT, HALF_LEFT, CENTRE, HALF_RIGHT, HARD_RIGHT] },
    hard: { label: 'Hard', blurb: 'Seven positions', guesses: 4,
            spots: [HARD_LEFT, spot(-0.7, '70% L', 'well left'), spot(-0.35, '35% L', 'a little left'),
                    CENTRE, spot(0.35, '35% R', 'a little right'), spot(0.7, '70% R', 'well right'), HARD_RIGHT] },
  },

  setting: {
    id: 'source',
    label: 'Source',
    options: [
      { id: 'instrument', label: 'One instrument' },
      { id: 'mix', label: 'Full mix' },
    ],
  },

  slots(tier) {
    return [{ id: 'spot', heading: 'place', label: 'Where is it sitting?', options: this.tiers[tier].spots }];
  },

  makePuzzle(rng, tier) {
    return { answer: { spot: pick(rng, this.tiers[tier].spots).id } };
  },

  score(guess, answer, tier) {
    const spots = this.tiers[tier].spots;
    const guessed = spots.findIndex((s) => s.id === guess.spot);
    const actual = spots.findIndex((s) => s.id === answer.spot);
    const steps = guessed - actual;

    return {
      correct: guess.spot === answer.spot,
      cells: [
        { state: onScale(guessed, actual), text: spots[guessed].symbol },
        distanceCell(steps, 'place'),
      ],
    };
  },

  clues() {
    return [{ id: 'play', label: 'Play it', primary: true }];
  },

  play(engine, puzzle, clue, setting) {
    engine.ensure();

    // StereoPannerNode is equal-power and constant-width, which is what a pan
    // control on a desk does. A plain gain difference would be a balance
    // control, and would read as a level change rather than a placing.
    const panner = engine.ctx.createStereoPanner();
    panner.pan.value = Number(puzzle.answer.spot);
    panner.connect(engine.out);

    engine.playBed(setting, { seconds: 3.6, dest: panner });
  },

  reveal(answer) {
    const all = this.tiers.hard.spots.concat(this.tiers.medium.spots);
    const found = all.find((s) => s.id === answer.spot);
    return { symbol: found.symbol, name: found.name };
  },

  weak(answer) {
    const all = this.tiers.hard.spots.concat(this.tiers.medium.spots);
    return { key: answer.spot, label: all.find((s) => s.id === answer.spot).name };
  },
};
