import {
  ECHO_DEFAULTS, DIVISIONS, SYNC_DIVISIONS, MOST_FEEDBACK,
  echoProfile, timeOf, nearestDivision,
} from '../echo/line.js';
import { decayReading } from '../fx/response.js';
import { distance } from '../gap.js';
import { writeMs } from '../fx/panel.js';
import { LOOP_BEAT } from '../audio.js';
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

/**
 * The two exercises, in the shape a session can set up.
 *
 * In match there is a delay on the other side of the A/B. In find there is
 * nothing there: what you compare against is the loop with no repeats on it,
 * which is what tells you whether yours is falling in with it.
 */
export const ECHO_EXERCISES = {
  match: {
    id: 'match',
    label: 'Match the delay',
    source: 'instrument',
    sourceOptions: { tempo: true },
    other: 'Target',
    targetOf: (puzzle) => puzzle.answer,
  },
  find: {
    id: 'find',
    label: 'Find the time',
    source: 'drums',
    sourceOptions: { tempo: false },
    other: 'Dry',
    targetOf: (puzzle) => ({ ...ECHO_DEFAULTS, ...puzzle.answer }),
  },
};

export const ECHO_WORK = {
  tool: 'delay',
  opening: 'Play the loop, set the repeats, then lock it in.',

  settings: [
    {
      id: 'exercise',
      label: 'Exercise',
      options: Object.values(ECHO_EXERCISES).map(({ id, label }) => ({ id, label })),
    },
  ],

  exercises: ECHO_EXERCISES,

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

  score(state, puzzle) {
    const { answer, tier } = puzzle;
    const guess = state;
    const exercise = puzzle?.settings?.exercise ?? 'match';
    const settings = { ...ECHO_DEFAULTS, ...guess };
    // Delays are built from numbers rather than recorded, so marking needs no
    // audio and comes out the same on every machine.
    const rate = 48000;

    if (exercise === 'find') return this.scoreFind(settings, answer, tier);

    const wanted = { ...ECHO_DEFAULTS, ...answer };
    // The same kind of reading the reverb takes, on purpose: a room and a
    // repeat are the same sort of object here, so "is this delay as long as
    // that room" is a question that can be asked at all.
    const mine = decayReading('delay', echoProfile(rate, settings), { state: settings });
    const theirs = decayReading('delay', echoProfile(rate, wanted), { state: wanted });
    const gap = distance(mine, theirs);
    const error = gap.off;

    const close = ECHO_CLOSE[tier];
    const mark = error <= close ? HIT : error <= close * 2.5 ? NEAR : MISS;

    // Which way it is out, in the terms the delay is set in.
    const timing = Math.log2(settings.time / wanted.time);
    const back = settings.feedback - wanted.feedback;

    return {
      correct: error <= close,
      error,
      cells: [
        { state: mark, text: `${error.toFixed(1)} dB out` },
        {
          state: mark,
          text: error <= close ? 'that is the delay'
            : Math.abs(timing) > 0.06 ? `${this.howFar(timing)} too ${timing > 0 ? 'long' : 'short'}`
            : Math.abs(back) > 0.1 ? `${Math.round(Math.abs(back) * 100)}% too much ${back > 0 ? 'feedback' : 'little feedback'}`
            : 'the right time, the wrong delay',
        },
      ],
      why: [
        {
          label: 'Repeats, compared',
          value: `${error.toFixed(2)} dB apart, worst in ${gap.where}`,
          how: 'Both delays are built and their repeats read in three bands over '
             + 'time - where each echo lands, how loud it is, and what the tone '
             + 'control has taken off it by then. Built from numbers rather than '
             + 'recorded, so this comes out the same on every machine.',
        },
        {
          label: 'Time',
          value: `${this.howFar(timing)} too ${timing > 0 ? 'long' : 'short'}`,
          how: 'Compared as a ratio, not in milliseconds: a hundred milliseconds '
             + 'out is a different mistake at a sixteenth than it is at a quarter.',
        },
        {
          label: 'Feedback',
          value: `${Math.round(Math.abs(back) * 100)}% too ${back > 0 ? 'much' : 'little'}`,
          how: 'How much of each repeat goes back in - how many you get before '
             + 'they die away, rather than how loud the first one is.',
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
      why: [
        {
          label: 'Time',
          value: `${writeMs(settings.time)}, wanted ${writeMs(answer.time)}`,
          how: `The answer is ${answer.division} at this tempo, worked out from the `
             + 'loop rather than from the number on the control - which is why '
             + 'the delay reads as locked when it falls in with the drums and '
             + 'not when it lands on a round figure.',
        },
        {
          label: 'Out by',
          value: `${off.toFixed(3)} octaves - ${this.howFar(off)}`,
          how: 'Heard as a ratio, so compared as one. Only the time is read, '
             + 'because only the time was asked about: the feedback and the tone '
             + 'are yours to set to whatever makes the repeats easiest to hear, '
             + 'which is what anybody does when they are hunting for a tempo.',
        },
        {
          label: 'Locked at',
          value: `${(close * 100).toFixed(1)}% of an octave`,
          how: 'How far off the subdivision still counts as in time. It tightens '
             + 'with the tier.',
        },
      ],
    };
  },

  /** How far off, as a percentage of what was wanted. */
  howFar(octaves) {
    const factor = 2 ** Math.abs(octaves);
    return `${Math.round((factor - 1) * 100)}%`;
  },

  hints(puzzle) {
    const { answer, tier } = puzzle;
    const settings = { ...ECHO_DEFAULTS, ...answer };

    if ((puzzle?.settings?.exercise ?? 'match') === 'find') {
      const beats = answer.time / (LOOP_BEAT * 1000);
      return [
        `It is a ${beats >= 0.9 ? 'long' : beats >= 0.45 ? 'medium' : 'short'} `
          + 'subdivision - count it against the drums rather than reading the '
          + 'number.',
        `It is ${answer.division.includes('triplet') ? 'a triplet'
          : answer.division.includes('dotted') ? 'dotted' : 'straight'}, `
          + `and around ${writeMs(answer.time)} at this tempo.`,
      ];
    }

    const near = nearestDivision(settings.time);
    return [
      `The time is about ${writeMs(settings.time)}`
        + `${near && near.off < 0.02 ? ` - which is ${near.division.label}` : ''}.`,
      `Around ${Math.round(settings.feedback * 100)}% going back in, so `
        + `${settings.feedback > 0.55 ? 'a long tail of repeats'
          : settings.feedback > 0.3 ? 'a few audible repeats' : 'barely more than a slap'}`
        + `${settings.pingPong ? ', and it alternates across the stereo field' : ''}.`,
    ];
  },

  reveal(puzzle) {
    const { answer } = puzzle;
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

  weak(puzzle) {
    const { answer } = puzzle;
    if ((puzzle?.settings?.exercise ?? 'match') === 'find') {
      return { key: answer.division, label: `the ${answer.division} delay` };
    }

    const feedback = answer?.feedback ?? ECHO_DEFAULTS.feedback;
    const how = feedback >= MOST_FEEDBACK * 0.75 ? 'long feedback'
      : feedback >= 0.35 ? 'working feedback' : 'short delays';
    return { key: how, label: how };
  },
};
