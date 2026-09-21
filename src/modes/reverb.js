import { VERB_DEFAULTS, makeImpulse, roomProfile } from '../verb/ir.js';
import { decayCurve, profileDistance, monoOf } from '../fx/response.js';
import { VerbPlugin, writeSeconds } from '../verb/plugin.js';
import { LOOP_BEAT } from '../audio.js';
import { HIT, NEAR, MISS, logPick, toStep, pick } from './scoring.js';

/**
 * The room, as a thing you build rather than a thing you name.
 *
 * Two exercises. **Match the space** puts a room on the loop and asks you to
 * build the same one. **Fit the tempo** asks for a room that belongs to this
 * track: one that answers on the beat and is gone before the next one lands,
 * which is what setting a reverb to a song actually consists of.
 *
 * Both are marked on the decay - how much of the room is still to come, band
 * by band, moment by moment. One reading covers every control at once: the
 * slope of it is the decay time, the flat part at the start is the pre-delay,
 * the three bands pulling apart is the damping, the first few decibels are
 * the early reflections, and where each band starts is what the send filters
 * did. So two rooms whose decays sit on each other are the same room, however
 * their knobs were arrived at - the same decision the EQ and the compressor
 * make, for the same reason.
 */

/** What each exercise is played on, and what the other side of the A/B is. */
const VERB_EXERCISES = {
  match: { source: 'instrument', other: 'Target' },
  tempo: { source: 'drums', other: 'Dry' },
};

/**
 * How far two rooms may be apart, in decibels of decay, and still match.
 *
 * Set from measurement. Over seventy of the targets this mode generates: a
 * decay fifteen per cent too long reads about 1.4 dB out, forty per cent too
 * long reads about 3.3, a mix fifteen points off reads about 3, and the
 * damping left off reads about 4.2. So easy forgives the fifteen per cent,
 * medium does not, and hard wants the pre-delay as well. The room the plugin
 * opens on is never closer than 3.5 dB to a target, so submitting it
 * untouched fails at every tier.
 *
 * The tempo numbers are how far past the window still reads as near rather
 * than as a miss; the window itself is below.
 */
const VERB_CLOSE = {
  match: { easy: 1.7, medium: 1.1, hard: 0.75 },
  tempo: { easy: 6, medium: 5, hard: 4 },
};

/** How far out the pre-delay may be, as a fraction of the subdivision. */
const IN_TIME = { easy: 0.35, medium: 0.22, hard: 0.14 };

/**
 * Where the tail has to have got to by the time the next hit lands - and how
 * much deader than that still counts.
 *
 * A range rather than a number, because a range is what the ear actually
 * gives you. Nobody hears "the tail is thirty decibels down"; what anybody
 * hears is whether the room is still ringing when the next hit arrives, and
 * that is a threshold. Asked for thirty decibels give or take two and a half,
 * the window came to about seven per cent of the decay time - finer than the
 * knob feels. Asked for gone, but no deader than it needs to be, it is the
 * judgement an engineer is actually making: as much room as the track will
 * take.
 */
const CLEARED = -30;
const STILL_A_ROOM = { easy: 20, medium: 14, hard: 9 };

/**
 * The subdivisions a reverb is asked to answer on.
 *
 * Its own list rather than the delay's: a pre-delay is a gap of a few tens of
 * milliseconds and a delay is a repeat of a few hundred, so the two want
 * different ends of the bar.
 */
const PRE_DIVISIONS = [
  { id: 'thirtysecond', label: 'a 32nd', beats: 1 / 8 },
  { id: 'sixteenth', label: 'a 16th', beats: 1 / 4 },
  { id: 'eighth', label: 'an 8th', beats: 1 / 2 },
];

export default {
  id: 'reverb',
  label: 'Reverb',
  blurb: 'Build the room',
  surface: true,
  lede: 'A reverb, and a loop running through it. Build the same room you can '
      + 'hear on the target — or a room that belongs to the track, answering on '
      + 'the beat and gone before the next one.',
  opening: 'Play the loop, build the room, then lock it in.',
  advice: 'Decay is the easy half. What people miss is the gap before the room answers, and how much shorter the top decays than the bottom.',

  help: [
    ['Play the loop, then build the room.',
     'The left panel is the room itself: the gap before it answers, the walls arriving '
     + 'one at a time, and the wash closing over them. The right panel is how it decays, '
     + 'band by band, which is also exactly what your guess is marked against.'],
    ['Pre-delay is the one to listen for.',
     'It is the gap between the sound and the room, and it is what keeps a source in '
     + 'front of its own reverb. People hear decay easily and pre-delay hardly at all, '
     + 'which is why it is on the display.'],
    ['HF decay is the other one.',
     'Real rooms lose their top before they lose their bottom, and how much shorter the '
     + 'highs ring is most of what makes a room sound like stone or like curtains. The '
     + 'three curves pulling apart is that, on the screen.'],
    ['You are judged on the decay, not the controls.',
     'Two sets of settings that decay the same way are the same room. Auto gain is on, '
     + 'so moving the mix does not change how loud it is - otherwise the wetter side of '
     + 'the A/B would win every time.'],
  ],

  settings: [
    {
      id: 'exercise',
      label: 'Exercise',
      options: [
        { id: 'match', label: 'Match the space' },
        { id: 'tempo', label: 'Fit the tempo' },
      ],
    },
  ],

  tiers: {
    easy: { label: 'Easy', blurb: 'Decay and mix', guesses: 4, shape: false, detail: false },
    medium: { label: 'Medium', blurb: 'And the gap before it', guesses: 4, shape: true, detail: false },
    hard: { label: 'Hard', blurb: 'And the walls and the tone', guesses: 4, shape: true, detail: true },
  },

  /** The round is played on the plugin, so there is nothing to pick from. */
  slots() {
    return [];
  },

  makePuzzle(rng, tier, settings) {
    if (settings.exercise === 'tempo') {
      const division = pick(rng, PRE_DIVISIONS);
      return {
        answer: {
          // How long the room may go on for: to the next beat, or the one after.
          clearBy: pick(rng, [1, 2]),
          preDelay: toStep(division.beats * LOOP_BEAT * 1000, 1),
          division: division.label,
        },
      };
    }

    // A room or a hall, never the middle. The plugin opens on a room of about
    // a second and three quarters, and a target drawn from either side of it
    // is a target you have to do something to reach - without this, one
    // target in twenty-four sat close enough to the opening settings that
    // submitting them untouched passed.
    const spec = this.tiers[tier];
    const near = rng() < 0.5;
    const answer = {
      ...VERB_DEFAULTS,
      decay: toStep(near ? logPick(rng, 0.4, 1.3) : logPick(rng, 2.5, 5.5), 0.05),
      mix: toStep(0.15 + rng() * 0.35, 0.01),
    };

    if (spec.shape) {
      answer.preDelay = toStep(rng() * 120, 1);
      answer.damping = toStep(0.25 + rng() * 0.7, 0.01);
    }
    if (spec.detail) {
      answer.size = toStep(logPick(rng, 5, 50), 1);
      answer.early = toStep(rng() * 0.6, 0.01);
      answer.lowCut = toStep(logPick(rng, 20, 500), 5);
      answer.highCut = toStep(logPick(rng, 2500, 18000), 100);
    }

    return { answer };
  },

  /* ---------- marking ---------- */

  score(guess, answer, tier, puzzle) {
    const exercise = puzzle?.settings?.exercise ?? 'match';
    const settings = { ...VERB_DEFAULTS, ...guess };
    // The rooms are built from numbers rather than recorded, so marking needs
    // no audio and gives the same answer on every machine.
    const rate = 48000;

    if (exercise === 'tempo') return this.scoreTempo(settings, answer, tier, rate);

    const mine = roomProfile(rate, settings);
    const theirs = roomProfile(rate, { ...VERB_DEFAULTS, ...answer });
    const error = profileDistance(mine, theirs);

    const close = VERB_CLOSE.match[tier];
    const state = error <= close ? HIT : error <= close * 2.5 ? NEAR : MISS;

    // Which way it is out, said in the terms the room is built in.
    const longer = this.decayOf(settings, rate) - this.decayOf({ ...VERB_DEFAULTS, ...answer }, rate);
    const gap = settings.preDelay - (answer.preDelay ?? VERB_DEFAULTS.preDelay);

    return {
      correct: error <= close,
      error,
      cells: [
        { state, text: `${error.toFixed(1)} dB out` },
        {
          state,
          text: error <= close ? 'that is the room'
            : Math.abs(longer) > 0.12 ? `${writeSeconds(Math.abs(longer))} too ${longer > 0 ? 'long' : 'short'}`
            : Math.abs(gap) > 12 ? `answers ${Math.round(Math.abs(gap))} ms too ${gap > 0 ? 'late' : 'early'}`
            : 'the right length, the wrong room',
        },
      ],
    };
  },

  /** The decay time of a room, measured off it. */
  decayOf(settings, rate) {
    const impulse = makeImpulse(rate, settings);
    const times = [];
    for (let t = 0; t < impulse.seconds; t += 0.01) times.push(t);
    const curve = decayCurve(monoOf(impulse), rate, times);

    for (let i = 0; i < curve.length; i += 1) if (curve[i] <= -30) return times[i] * 2;
    return impulse.seconds * 2;
  },

  /**
   * Does the room belong to the track?
   *
   * Two readings, both taken off the decay: where the tail has got to when
   * the next hit lands, and how long the room waits before it answers. A
   * reverb that is still going when the next beat arrives is the single most
   * common way a mix turns to soup, and a reverb that answers on the
   * subdivision is how it stops sounding bolted on.
   */
  scoreTempo(settings, answer, tier, rate) {
    const impulse = makeImpulse(rate, settings);
    const when = answer.clearBy * LOOP_BEAT;
    const left = decayCurve(monoOf(impulse), rate, [when])[0];

    const floor = CLEARED - STILL_A_ROOM[tier];
    const ringing = left - CLEARED;        // above zero is still going
    const dead = floor - left;             // above zero is deader than it needs to be
    const timing = Math.abs(settings.preDelay - answer.preDelay) / answer.preDelay;

    const clear = left <= CLEARED && left >= floor;
    const inTime = timing <= IN_TIME[tier];
    const off = Math.max(ringing, dead);

    return {
      correct: clear && inTime,
      error: Math.max(0, off),
      cells: [
        {
          state: clear ? HIT : off <= VERB_CLOSE.tempo[tier] ? NEAR : MISS,
          text: clear ? 'gone by the beat'
            : ringing > 0 ? `${left.toFixed(0)} dB left when it lands`
            : 'gone long before it',
        },
        {
          state: inTime ? HIT : timing <= IN_TIME[tier] * 2.5 ? NEAR : MISS,
          text: inTime ? `answers on ${answer.division}`
            : `answers ${Math.round(Math.abs(settings.preDelay - answer.preDelay))} ms too `
              + `${settings.preDelay > answer.preDelay ? 'late' : 'early'}`,
        },
      ],
    };
  },

  /* ---------- the surface ---------- */

  mount(el, { engine, puzzle, onChange }) {
    const exercise = puzzle.settings.exercise;
    const spec = VERB_EXERCISES[exercise];
    const settings = { ...VERB_DEFAULTS };

    const plugin = new VerbPlugin(el, { engine, settings, onChange, source: spec.source });
    plugin.nameOther(spec.other);
    // In match there is a room on the other side of the A/B. In the tempo
    // exercise there is nothing there: what you compare against is the loop
    // with no room on it at all.
    plugin.setTarget(exercise === 'match' ? puzzle.answer : { ...VERB_DEFAULTS, mix: 0 });

    return {
      guess: () => ({ ...settings }),
      reveal: () => {
        if (exercise === 'match') plugin.showTarget({ ...VERB_DEFAULTS, ...puzzle.answer });
        plugin.lock();
      },
      toggle: () => plugin.toggle(),
      destroy: () => plugin.destroy(),
    };
  },

  clues() {
    return [];
  },

  play() {
    // The loop runs inside the plugin, under the player's own hands.
  },

  reveal(answer, tier, puzzle) {
    if ((puzzle?.settings?.exercise ?? 'match') === 'tempo') {
      return {
        symbol: `${answer.clearBy === 1 ? 'one beat' : 'two beats'}`,
        name: `to clear, answering on ${answer.division}`,
      };
    }

    const settings = { ...VERB_DEFAULTS, ...answer };
    return {
      symbol: writeSeconds(settings.decay),
      name: `${Math.round(settings.preDelay)} ms in front, highs × ${settings.damping.toFixed(2)}, `
          + `${Math.round(settings.mix * 100)}% wet`,
    };
  },

  weak(answer, puzzle) {
    if ((puzzle?.settings?.exercise ?? 'match') === 'tempo') {
      return { key: 'in time', label: 'rooms that fit the track' };
    }

    const decay = (answer?.decay ?? VERB_DEFAULTS.decay);
    const room = decay < 0.8 ? 'small rooms' : decay < 2.5 ? 'rooms' : 'halls';
    return { key: room, label: room };
  },
};
