import {
  ECHO_DEFAULTS, DIVISIONS, SYNC_DIVISIONS, MOST_FEEDBACK,
  echoProfile, timeOf, nearestDivision,
} from '../echo/line.js';
import { EchoPlugin } from '../echo/plugin.js';
import { profileDistance } from '../fx/response.js';
import { writeMs } from '../fx/panel.js';
import { HIT, NEAR, MISS, logPick, toStep, pick } from './scoring.js';

/**
 * The delay, and the one question everybody asks about one.
 *
 * **Match the delay** puts a delay on the loop and asks you to build the same
 * one, marked on how it dies away - which covers the time, the feedback, the
 * filters in the loop and the balance, all in one reading.
 *
 * **Find the time** is the question: a delay is locked to the track and you
 * have to dial yours until it locks too. There is no tempo readout and no
 * grid on the display for that one, which is not a handicap but the actual
 * job - matching a delay to a record nobody has told you the tempo of. What
 * you are listening for is the repeats falling in with the track instead of
 * walking through it, and it is the most useful thing in this mode.
 */

/** What each exercise is played on, and what the other side of the A/B is. */
const ECHO_EXERCISES = {
  match: { source: 'instrument', other: 'Target', tempo: true },
  find: { source: 'drums', other: 'Dry', tempo: false },
};

/**
 * How far two delays may be apart and still match, in decibels of decay.
 *
 * Measured against the targets this mode generates: being one note value out
 * reads between 4.5 and 7 dB, a time ten per cent off reads between 1.5 and
 * 4, and fifteen points of extra feedback reads about 4. So easy forgives ten
 * per cent, medium mostly does not, and nothing at all forgives being on the
 * wrong note.
 */
const ECHO_CLOSE = { easy: 2.6, medium: 1.9, hard: 1.2 };

/**
 * How far out the time may be when the time is the whole question, in octaves.
 *
 * The note values this mode draws from are at least a third apart, which is
 * 0.41 of an octave, so even the loosest of these lands you on one note value
 * and not its neighbour.
 */
const LOCKED = { easy: 0.16, medium: 0.1, hard: 0.06 };

export default {
  id: 'delay',
  label: 'Delay',
  blurb: 'Lock the repeats',
  surface: true,
  lede: 'A delay, and a loop running through it. Build the same one you can '
      + 'hear on the target — or find the time by ear, with nothing telling '
      + 'you the tempo.',
  opening: 'Play the loop, set the repeats, then lock it in.',
  advice: 'A delay is right when the repeats fall in with the track and wrong when they walk through it. That is the thing to listen for, and it is easier to hear on drums than on anything else.',

  help: [
    ['Play the loop, then set the repeats.',
     'The left panel is the repeats against one bar of the track: left goes up, right '
     + 'goes down, so a ping-pong reads as repeats stepping from one side to the other. '
     + 'The right panel is how the whole thing dies away.'],
    ['Finding the time is the point.',
     'In that exercise there is no tempo readout and no grid, because matching a delay '
     + 'to a record nobody has told you the tempo of is the real version of the job. '
     + 'Listen for the repeats falling in with the track rather than walking through it.'],
    ['The filters are inside the loop.',
     'Tone and low cut are applied to each repeat on its way round again, so they do not '
     + 'darken the delay once - they darken it a little more every time. That is what '
     + 'keeps a long feedback from turning into mud.'],
    ['You are judged on what comes out, not on the knobs.',
     'Two delays that die away the same way are the same delay. Auto gain is on, so more '
     + 'feedback is more repeats rather than more level.'],
  ],

  settings: [
    {
      id: 'exercise',
      label: 'Exercise',
      options: [
        { id: 'match', label: 'Match the delay' },
        { id: 'find', label: 'Find the time' },
      ],
    },
  ],

  tiers: {
    easy: { label: 'Easy', blurb: 'Time and feedback', guesses: 4, tone: false, detail: false },
    medium: { label: 'Medium', blurb: 'And their tone', guesses: 4, tone: true, detail: false },
    hard: { label: 'Hard', blurb: 'And the routing', guesses: 4, tone: true, detail: true },
  },

  /** The round is played on the plugin, so there is nothing to pick from. */
  slots() {
    return [];
  },

  makePuzzle(rng, tier, settings) {
    if (settings.exercise === 'find') {
      // Only the well-spaced note values: the question is which one, and a
      // pair twelve per cent apart is a question about a stopwatch.
      const division = pick(rng, DIVISIONS);
      return {
        answer: {
          ...ECHO_DEFAULTS,
          time: timeOf(division.beats),
          division: division.label,
          feedback: toStep(0.3 + rng() * 0.3, 0.01),
          mix: 0.35,
        },
      };
    }

    // A short tail or a long one, never the middle. The plugin opens on
    // thirty-five per cent of feedback, and a target drawn either side of
    // that is a target you have to do something to reach - without it, two
    // targets in twenty-four sat close enough to the opening settings that
    // submitting them untouched passed.
    const spec = this.tiers[tier];
    const musical = SYNC_DIVISIONS.filter((d) => d.beats !== null);
    const short = rng() < 0.5;
    const answer = {
      ...ECHO_DEFAULTS,
      time: timeOf(pick(rng, musical).beats),
      feedback: toStep(short ? 0.12 + rng() * 0.12 : 0.5 + rng() * 0.2, 0.01),
      mix: toStep(0.2 + rng() * 0.25, 0.01),
    };

    if (spec.tone) answer.tone = toStep(logPick(rng, 1500, 18000), 100);
    if (spec.detail) {
      answer.lowCut = toStep(logPick(rng, 20, 600), 5);
      answer.pingPong = rng() < 0.5;
    }

    return { answer };
  },

  /* ---------- marking ---------- */

  score(guess, answer, tier, puzzle) {
    const exercise = puzzle?.settings?.exercise ?? 'match';
    const settings = { ...ECHO_DEFAULTS, ...guess };
    // Delays are built from numbers rather than recorded, so marking needs no
    // audio and comes out the same on every machine.
    const rate = 48000;

    if (exercise === 'find') return this.scoreFind(settings, answer, tier);

    const wanted = { ...ECHO_DEFAULTS, ...answer };
    const error = profileDistance(echoProfile(rate, settings), echoProfile(rate, wanted));

    const close = ECHO_CLOSE[tier];
    const state = error <= close ? HIT : error <= close * 2.5 ? NEAR : MISS;

    // Which way it is out, in the terms the delay is set in.
    const timing = Math.log2(settings.time / wanted.time);
    const back = settings.feedback - wanted.feedback;

    return {
      correct: error <= close,
      error,
      cells: [
        { state, text: `${error.toFixed(1)} dB out` },
        {
          state,
          text: error <= close ? 'that is the delay'
            : Math.abs(timing) > 0.06 ? `${this.howFar(timing)} too ${timing > 0 ? 'long' : 'short'}`
            : Math.abs(back) > 0.1 ? `${Math.round(Math.abs(back) * 100)}% too much ${back > 0 ? 'feedback' : 'little feedback'}`
            : 'the right time, the wrong delay',
        },
      ],
    };
  },

  /**
   * Is it locked to the track?
   *
   * Only the time is read, because only the time was asked about. The
   * feedback and the tone are yours to set to whatever makes the repeats
   * easiest to hear, which is what anybody does when they are trying to find
   * a tempo.
   */
  scoreFind(settings, answer, tier) {
    // Heard as a ratio: a hundred milliseconds out is a different mistake at
    // a sixteenth than it is at a quarter.
    const off = Math.log2(settings.time / answer.time);
    const close = LOCKED[tier];
    const locked = Math.abs(off) <= close;

    return {
      correct: locked,
      error: Math.abs(off),
      cells: [
        {
          state: locked ? HIT : Math.abs(off) <= close * 2.5 ? NEAR : MISS,
          text: locked ? 'locked to the track' : `${this.howFar(off)} out`,
        },
        {
          state: locked ? HIT : Math.abs(off) <= close * 2.5 ? NEAR : MISS,
          text: locked ? `that is ${answer.division}` : `too ${off > 0 ? 'long' : 'short'}`,
        },
      ],
    };
  },

  /** How far off, as a percentage of what was wanted. */
  howFar(octaves) {
    const factor = 2 ** Math.abs(octaves);
    return `${Math.round((factor - 1) * 100)}%`;
  },

  /* ---------- the surface ---------- */

  mount(el, { engine, puzzle, onChange }) {
    const exercise = puzzle.settings.exercise;
    const spec = ECHO_EXERCISES[exercise];
    const settings = { ...ECHO_DEFAULTS };

    const plugin = new EchoPlugin(el, {
      engine, settings, onChange, source: spec.source, tempo: spec.tempo,
    });

    plugin.nameOther(spec.other);
    // In match there is a delay on the other side of the A/B. In find there
    // is nothing there: what you compare against is the loop with no repeats
    // on it, which is what tells you whether yours is falling in with it.
    plugin.setTarget(exercise === 'match'
      ? puzzle.answer
      : { ...ECHO_DEFAULTS, ...puzzle.answer });

    return {
      guess: () => ({ ...settings }),
      reveal: () => {
        plugin.showTarget({ ...ECHO_DEFAULTS, ...puzzle.answer });
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
    const settings = { ...ECHO_DEFAULTS, ...answer };

    if ((puzzle?.settings?.exercise ?? 'match') === 'find') {
      return { symbol: answer.division, name: `${writeMs(settings.time)} at this tempo` };
    }

    const near = nearestDivision(settings.time);
    return {
      symbol: near && near.off < 0.02 ? near.division.label : writeMs(settings.time),
      name: `${writeMs(settings.time)}, ${Math.round(settings.feedback * 100)}% back`
          + `${settings.pingPong ? ', ping-pong' : ''}`,
    };
  },

  weak(answer, puzzle) {
    if ((puzzle?.settings?.exercise ?? 'match') === 'find') {
      return { key: answer.division, label: `the ${answer.division} delay` };
    }

    const feedback = answer?.feedback ?? ECHO_DEFAULTS.feedback;
    const how = feedback >= MOST_FEEDBACK * 0.75 ? 'long feedback'
      : feedback >= 0.35 ? 'working feedback' : 'short delays';
    return { key: how, label: how };
  },
};
