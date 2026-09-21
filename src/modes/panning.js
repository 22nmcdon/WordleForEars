import { dialled, toStep } from './scoring.js';

const writePan = (pan) => {
  const at = Math.round(pan);
  if (Math.abs(at) < 3) return 'Centre';
  return `${Math.abs(at)}% ${at < 0 ? 'left' : 'right'}`;
};

export default {
  id: 'panning',
  label: 'Panning',
  blurb: 'Place it where the target sits',
  lede: 'The pan control is yours. Move it until your placement sits on top of '
      + 'the target — and you can flip between the two as often as you like.',
  advice: 'Headphones, for this one — a laptop speaker has almost no stereo field to point at.',

  settings: [
    {
      id: 'source',
      label: 'Source',
      options: [
        { id: 'instrument', label: 'One instrument' },
        { id: 'mix', label: 'Full mix' },
      ],
    },
  ],

  tiers: {
    easy: { label: 'Easy', blurb: 'Hard left, centre, hard right', guesses: 3, places: [-100, 0, 100], hit: 12, near: 40 },
    medium: { label: 'Medium', blurb: 'Anywhere, in steps of 25', guesses: 4, step: 25, hit: 12, near: 30 },
    hard: { label: 'Hard', blurb: 'Anywhere at all', guesses: 4, step: 5, hit: 8, near: 20 },
  },

  slots(tier) {
    const spec = this.tiers[tier];
    return [{
      kind: 'range',
      id: 'pan',
      heading: 'placement',
      extraReading: true,
      label: 'Where is it sitting?',
      min: -100, max: 100, step: spec.step ?? 25, start: 0,
      format: writePan,
      unit: '%', below: 'left', above: 'right',
      hit: spec.hit, near: spec.near,
    }];
  },

  makePuzzle(rng, tier) {
    const spec = this.tiers[tier];
    const pan = spec.places
      ? spec.places[Math.floor(rng() * spec.places.length)]
      : toStep(-100 + rng() * 200, spec.step);

    return { answer: { pan } };
  },

  score(guess, answer, tier) {
    const slot = this.slots(tier)[0];
    const reading = dialled(guess.pan, answer.pan, slot);

    return {
      correct: reading.state === 'hit',
      cells: [
        { state: reading.state, text: writePan(guess.pan) },
        { ...reading, narrow: true },
      ],
    };
  },

  clues() {
    return [
      { id: 'target', label: 'Play the target', primary: true },
      { id: 'mine', label: 'Play yours' },
    ];
  },

  play(engine, { puzzle, clue, settings, guess }) {
    engine.ensure();

    // StereoPannerNode is equal-power and constant-width, which is what a pan
    // control on a desk does. A gain difference would be a balance control,
    // and would read as a level change rather than a placing.
    const panner = engine.ctx.createStereoPanner();
    panner.pan.value = (clue === 'target' ? puzzle.answer.pan : guess.pan) / 100;
    panner.connect(engine.out);

    engine.playBed(settings.source, { seconds: 3.6, dest: panner });
  },

  reveal(answer) {
    return { symbol: writePan(answer.pan), name: '' };
  },

  weak(answer) {
    const side = answer.pan < -20 ? 'the left' : answer.pan > 20 ? 'the right' : 'the centre';
    return { key: side, label: side };
  },
};
