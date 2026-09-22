import { COMP_DEFAULTS, analyse, runCompressor } from '../comp/dsp.js';
import { reductionReading } from '../comp/reading.js';
import { distance } from '../gap.js';
import { CompPlugin, writeTime, writeRatio } from '../comp/plugin.js';
import { HIT, NEAR, MISS, logPick, toStep } from './scoring.js';

/**
 * The compressor, as the tool it is.
 *
 * Three exercises, and none of them is a quiz about a number. **Match** puts
 * a compressor on the loop and asks you to build the same one. **Even it out**
 * hands you a loop whose hits are all over the place, which is what a
 * compressor is actually for. **Duck** gives you a bass and a kick and asks
 * you to get one out of the way of the other, which is what a sidechain is
 * actually for.
 *
 * All three are marked on what came out, not on where the knobs ended up -
 * the same decision the EQ mode makes, and for the same reason. Two settings
 * that do the same thing to the same audio are the same answer, and a game
 * that said otherwise would be teaching one plugin's layout rather than an
 * ear. It costs more than comparing numbers: marking a guess means running
 * the compressor over the loop twice. It is worth it.
 */

/** What each exercise is played on, and what it is marked on. */
const COMP_EXERCISES = {
  match: { source: 'drums', key: null, other: 'Target' },
  fix: { source: 'drums', key: null, other: 'Untreated' },
  duck: { source: 'bass', key: 'kick', other: 'Untreated' },
};

/**
 * Beats in a loop. `renderLoop` builds two bars of four, and both the
 * evenness reading and the duck reading slice the loop up by beat - each beat
 * of the drum bed carries exactly one hit, and the kick bed puts one on every
 * beat, so a beat is the right unit for both.
 */
const BEATS = 8;

/**
 * How close counts, per tier, in decibels.
 *
 * Set from measurement rather than taste. Over a hundred of the targets this
 * mode actually generates, run against the drum bed: leaving the compressor
 * alone reads at worst 1.7 dB out and usually six; a threshold two decibels
 * off reads 0.3 to 1.2; four decibels off reads 0.6 to 2.4; a ratio half as
 * much again reads under 1.9. So easy forgives a couple of decibels of
 * threshold, medium does not quite, and hard wants the timing as well - and
 * doing nothing at all fails every one of them.
 */
const COMP_CLOSE = {
  match: { easy: 1.5, medium: 1.0, hard: 0.6 },
  fix: { easy: 2.8, medium: 1.8, hard: 1.2 },
  duck: { easy: 2.4, medium: 1.6, hard: 1.1 },
};

/**
 * How much reduction is more than the job needs.
 *
 * Levelling a loop whose hits are N decibels apart takes about N decibels off
 * the loud ones. Taking off a great deal more also levels it - everything
 * squashed flat is level - so evenness on its own would mark the worst answer
 * full marks. This is the margin past the job that still counts as doing it.
 *
 * Twelve, because the reduction is read at its deepest and a fast attack on a
 * drum hit reads several decibels deeper than the work it is doing to the
 * body of the sound. Measured on the loop, the settings that level it land
 * between eighteen and twenty-four decibels at their deepest, and a limiter
 * set to flatten it reads forty-five.
 */
const OVERWORKED = 12;

/* ---------- reading what came out ---------- */

/**
 * How loud each beat is, in dB.
 *
 * Loudness rather than peak, and the distinction is the whole exercise. A
 * compressor with any attack worth the name does not touch a drum's peak -
 * the peak is over in a millisecond or two, which is what the attack knob is
 * for - it works on the body of the hit. Marked on peaks, a loop levelled by
 * a good engineer read no better than one nobody had touched, and the only
 * thing that scored was a limiter set to destroy. Marked on loudness, the
 * reading agrees with the ear.
 */
function beatLevels(samples) {
  const span = Math.floor(samples.length / BEATS);
  const levels = [];

  for (let beat = 0; beat < BEATS; beat += 1) {
    let sum = 0;
    const end = Math.min(samples.length, (beat + 1) * span);
    for (let i = beat * span; i < end; i += 1) sum += samples[i] * samples[i];
    levels.push(10 * Math.log10(sum / Math.max(1, end - beat * span) + 1e-12));
  }

  return levels;
}

/**
 * What the sidechain is doing, beat by beat: how far the signal is pushed
 * down when the key hits, and how long it takes to come back.
 *
 * Recovery is measured to within a decibel of where it started rather than
 * all the way, because the last decibel of an exponential takes forever and
 * nobody hears it arrive.
 */
function duckOf(gr, rate) {
  const span = Math.floor(gr.length / BEATS);
  const depths = [];
  const recoveries = [];
  let held = 0;   // beats that never came back up before the next one

  for (let beat = 0; beat < BEATS; beat += 1) {
    const from = beat * span;
    const to = Math.min(gr.length, from + span);

    let deepest = 0;
    let at = from;
    for (let i = from; i < to; i += 1) {
      if (gr[i] < deepest) { deepest = gr[i]; at = i; }
    }
    if (deepest > -0.5) continue;

    depths.push(-deepest);
    let back = null;
    for (let i = at; i < to; i += 1) {
      if (gr[i] > -1) { back = i; break; }
    }
    // Still down when the next one lands. Reporting the gap between kicks as
    // though it had recovered would read as a long release rather than as a
    // release so long the track never comes back up, which is a different
    // mistake and wants saying differently.
    if (back === null) { held += 1; continue; }
    recoveries.push(((back - at) / rate) * 1000);
  }

  const mean = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0);
  return {
    depth: mean(depths),
    recovery: mean(recoveries),
    hits: depths.length,
    held,
  };
}

/**
 * A stand-in for the loop, for the times the real thing is not to hand.
 *
 * The surface renders the material the moment it mounts, so in the app this
 * is never what marks a guess. It exists so that scoring is a pure function
 * that a test can call without an audio context, and so that a guess
 * submitted in the first moments of a round is read rather than dropped.
 */
function probeFor(rate, uneven = 0) {
  const seconds = 4;
  const samples = new Float32Array(Math.round(rate * seconds));
  const span = samples.length / BEATS;
  const quiet = 10 ** (-uneven / 20);

  for (let beat = 0; beat < BEATS; beat += 1) {
    const level = beat % 2 === 1 ? quiet : 1;
    const from = Math.floor(beat * span);
    const length = Math.floor(rate * 0.22);

    for (let i = 0; i < length && from + i < samples.length; i += 1) {
      const t = i / rate;
      // A struck sound: a low body under a bright edge, decaying fast.
      const body = Math.sin(2 * Math.PI * 90 * t) * Math.exp(-t * 22);
      const edge = Math.sin(2 * Math.PI * 1800 * t) * Math.exp(-t * 90);
      samples[from + i] = 0.62 * level * (body + 0.35 * edge);
    }
  }

  return samples;
}

/**
 * A track for the key to work on: sustained, the way a bass is.
 *
 * The ducking exercise needs two stems or it is not about ducking at all. A
 * compressor pointed at a train of hits ducks on every one of them whether or
 * not it is keyed, so a stand-in made of hits alone let an un-keyed
 * compressor pass for a sidechain - it measured 8.7 dB of duck and 287 ms of
 * recovery off nothing but its own transients.
 */
function steadyProbe(rate) {
  const samples = new Float32Array(Math.round(rate * 4));
  for (let i = 0; i < samples.length; i += 1) {
    const t = i / rate;
    samples[i] = 0.45 * (Math.sin(2 * Math.PI * 55 * t) + 0.35 * Math.sin(2 * Math.PI * 110 * t));
  }
  return samples;
}

/** The audio a guess is read against - the exercise's own, never the monitor's. */
function materialOf(puzzle) {
  if (puzzle?.material?.samples) return puzzle.material;

  const rate = 48000;
  if ((puzzle?.settings?.exercise ?? 'match') === 'duck') {
    const bass = steadyProbe(rate);
    return { rate, samples: bass, even: bass, key: probeFor(rate, 0) };
  }

  return {
    rate,
    samples: probeFor(rate, puzzle?.uneven ?? 0),
    even: probeFor(rate, 0),
    key: null,
  };
}

const settle = (guess) => ({ ...COMP_DEFAULTS, ...guess });

export default {
  id: 'compression',
  label: 'Compression',
  blurb: 'Work the compressor',
  surface: true,
  lede: 'A compressor, and a loop running through it. Match the one on the '
      + 'target, level out a loop that will not sit still, or key it off the '
      + 'kick and get out of the way.',
  opening: 'Play the loop, work the compressor, then lock it in.',

  help: [
    ['Play the loop, then work the compressor.',
     'Drag the display sideways to move the threshold, or drag the handle at the top '
     + 'of the curve to set the ratio. The trace beside it is what the compressor is '
     + 'doing to this loop, hit by hit, and it follows the knobs whether or not '
     + 'anything is playing.'],
    ['The detector is the half nobody touches.',
     'Peak hears transients and RMS hears loudness. The key filters decide what the '
     + 'detector is allowed to hear, which is how you stop a kick pulling a whole mix '
     + 'down every bar - press listen to hear what it is reacting to.'],
    ['Auto gain is on, and it is not being polite.',
     'A compressor changes loudness, so without it the louder side of the A/B would win '
     + 'every time and you would never hear the compression at all.'],
    ['You are judged on what it did, not on where the knobs are.',
     'Two settings that treat the loop the same way are the same answer. Evening out a '
     + 'loop has no one answer at all: it is done when the loop sits still, and '
     + 'flattening it is not the same thing as levelling it.'],
  ],
  advice: 'The hardest thing here, and the plan says so: this is difficult even for people who do it for a living. Listen to the transients, and to what happens between the hits.',

  settings: [
    {
      id: 'exercise',
      label: 'Exercise',
      options: [
        { id: 'match', label: 'Match the target' },
        { id: 'fix', label: 'Even out the loop' },
        { id: 'duck', label: 'Duck under the kick' },
      ],
    },
  ],

  tiers: {
    easy: { label: 'Easy', blurb: 'Threshold and ratio', guesses: 4, timing: false, knee: false },
    medium: { label: 'Medium', blurb: 'And the timing', guesses: 4, timing: true, knee: false },
    hard: { label: 'Hard', blurb: 'And the knee', guesses: 4, timing: true, knee: true },
  },

  /** The round is played on the plugin, so there is nothing to pick from. */
  slots() {
    return [];
  },

  makePuzzle(rng, tier, settings) {
    const spec = this.tiers[tier];

    if (settings.exercise === 'fix') {
      // The loop's hits are `uneven` dB apart. There is no set of knobs that
      // is the answer - the answer is a loop that sits still.
      return { uneven: toStep(9 + rng() * 6, 1), answer: null };
    }

    if (settings.exercise === 'duck') {
      return {
        answer: {
          depth: toStep(4 + rng() * 8, 0.5),
          recovery: toStep(logPick(rng, 120, 420), 10),
        },
      };
    }

    // The threshold sits well under the peak of the bed, because the bed is
    // drums: sparse, and quiet between the hits, so its average level is a
    // long way below the tops. Drawn from -8 dBFS down, as the obvious range,
    // most targets did under a decibel of work - and a target that does
    // nothing is one that anybody matches by doing nothing. Measured on the
    // loop: -42 does three to six decibels, -26 does one and a half to three.
    const answer = {
      ...COMP_DEFAULTS,
      threshold: toStep(-42 + rng() * 16, 0.5),
      ratio: toStep(logPick(rng, 2.5, 12), 0.1),
    };

    if (spec.timing) {
      answer.attack = toStep(logPick(rng, 1, 60), 0.5);
      answer.release = toStep(logPick(rng, 40, 600), 5);
    }
    if (spec.knee) answer.knee = toStep(rng() * 18, 0.5);

    return { answer };
  },

  /* ---------- marking ---------- */

  score(guess, answer, tier, puzzle) {
    const exercise = puzzle?.settings?.exercise ?? 'match';
    const material = materialOf(puzzle);
    const settings = settle(guess);

    if (exercise === 'fix') return this.scoreFix(settings, material, tier, puzzle);
    if (exercise === 'duck') return this.scoreDuck(settings, answer, material, tier);
    return this.scoreMatch(settings, answer, material, tier);
  },

  /**
   * Two compressors over the same audio, compared by what they did to it.
   *
   * The reduction moment by moment is the compressor's whole output - depth
   * and timing together - so the distance between two of them is the distance
   * between two settings in the only terms that matter. Framed at five
   * milliseconds first, so that a single sample of disagreement on a transient
   * does not read as a wrong answer.
   */
  scoreMatch(guess, answer, material, tier) {
    const { samples, rate, key } = material;
    // The reading is the framed form, and the framing is the reading's rather
    // than this function's. What used to be here took two settings objects,
    // ran both passes, framed both results and compared them - five steps of
    // which only the last is about marking a guess.
    const gap = distance(
      reductionReading(samples, rate, guess, key),
      reductionReading(samples, rate, answer, key),
    );

    const error = gap.off;
    const { depth, shape } = gap.detail;
    const close = COMP_CLOSE.match[tier];
    const state = error <= close ? HIT : error <= close * 2.5 ? NEAR : MISS;

    return {
      correct: error <= close,
      error,
      cells: [
        { state, text: `${error.toFixed(1)} dB out` },
        {
          state,
          text: error <= close ? 'sits on it'
            : Math.abs(depth) > shape ? `${Math.abs(depth).toFixed(1)} dB too ${depth > 0 ? 'gentle' : 'hard'}`
            : 'right depth, wrong timing',
        },
      ],
      why: [
        {
          label: 'Reduction, compared',
          value: `${error.toFixed(2)} dB RMS apart`,
          how: 'Both compressors are run over the same loop and what they did to '
             + 'it - the gain reduction, moment by moment - is framed at five '
             + 'milliseconds and compared frame by frame. Framed first so that a '
             + 'single sample of disagreement on a transient does not read as a '
             + 'wrong answer.',
        },
        {
          label: 'Amount',
          value: `${depth > 0 ? '+' : ''}${depth.toFixed(2)} dB`
               + `${Math.abs(depth) < 0.05 ? '' : depth > 0 ? ' - yours works less' : ' - yours works harder'}`,
          how: 'The average of that difference. This is threshold and ratio: how '
             + 'much reduction yours does overall, regardless of when.',
        },
        {
          label: 'Timing',
          value: `${shape.toFixed(2)} dB`,
          how: 'What is left once the amount is taken out. This is attack and '
             + 'release - the same total reduction arriving and leaving at a '
             + 'different moment - and it is the half most people find hard to '
             + 'hear.',
        },
      ],
    };
  },

  /**
   * Did the loop end up sitting still, and at what cost.
   *
   * Sitting still is not every beat at the same level. A kick and a snare are
   * not the same loudness on any record ever made, and a reading that asked
   * for it would hand full marks to the one answer an engineer would call
   * wrong - everything flattened. What is being taken out is the fault, so
   * what the result is held against is the same loop without the fault in it:
   * the profile the bed would have had, which the surface renders alongside.
   *
   * Overall level is taken out of both first. Making the loop even is the
   * question; making it loud is what the makeup gain is for.
   */
  scoreFix(guess, material, tier, puzzle) {
    const { samples, even, rate, key } = material;
    const { out, gr } = runCompressor(samples, rate, guess, key);

    const mine = beatLevels(out);
    const want = beatLevels(even);
    const mean = (list) => list.reduce((a, b) => a + b, 0) / list.length;
    const mineMean = mean(mine);
    const wantMean = mean(want);

    let sum = 0;
    for (let i = 0; i < mine.length; i += 1) {
      sum += ((mine[i] - mineMean) - (want[i] - wantMean)) ** 2;
    }
    const off = Math.sqrt(sum / mine.length);

    let deepest = 0;
    for (const value of gr) if (value < deepest) deepest = value;

    const uneven = puzzle?.uneven ?? 12;
    const ceiling = uneven + OVERWORKED;
    const close = COMP_CLOSE.fix[tier];

    const level = off <= close;
    const gentle = -deepest <= ceiling;
    const state = level && gentle ? HIT : (off <= close * 2.2 && gentle) ? NEAR : MISS;

    return {
      correct: level && gentle,
      error: off,
      cells: [
        { state, text: `${off.toFixed(1)} dB out of line` },
        {
          state: gentle ? state : MISS,
          text: !gentle ? `${(-deepest).toFixed(0)} dB of reduction — squashed`
            : level ? 'sits still'
            : off > uneven / 3 ? 'barely touched'
            : 'closer',
        },
      ],
      why: [
        {
          label: 'Beats out of line',
          value: `${off.toFixed(2)} dB, from ${uneven} dB`,
          how: 'Each beat of your output is measured and held against the same '
             + 'loop without the fault in it - not against every beat being the '
             + 'same loudness, because a kick and a snare are not the same '
             + 'loudness on any record ever made. Overall level is taken out of '
             + 'both first: making it even is the question, making it loud is '
             + 'what the makeup gain is for.',
        },
        {
          label: 'Deepest reduction',
          value: `${(-deepest).toFixed(1)} dB, ceiling ${ceiling} dB`,
          how: `The most the compressor pulled down at any moment. Flattening `
             + `everything would level the loop perfectly and throw the `
             + `performance away, so anything past ${OVERWORKED} dB more than the `
             + `fault itself fails whatever the levels came out at.`,
        },
      ],
    };
  },

  /** Did the bass get out of the way, by how much, and for how long. */
  scoreDuck(guess, answer, material, tier) {
    const { samples, rate, key } = material;
    const { gr } = analyse(samples, rate, guess, key);
    const got = duckOf(gr, rate);

    const close = COMP_CLOSE.duck[tier];
    const depthOff = Math.abs(got.depth - answer.depth);
    // Time is heard in ratios, so being out by a hundred milliseconds means
    // something different at 120 than it does at 400.
    const stuck = got.hits === 0 || got.recovery <= 0;
    const timeOff = stuck ? 4 : Math.abs(Math.log2(got.recovery / answer.recovery));

    const depthOk = depthOff <= close;
    const timeOk = timeOff <= 0.42; // a third of the way to twice as long
    const state = depthOk && timeOk ? HIT : (depthOk || timeOff <= 0.8) ? NEAR : MISS;

    return {
      correct: depthOk && timeOk,
      error: depthOff,
      cells: [
        {
          state: depthOk ? HIT : depthOff <= close * 2.5 ? NEAR : MISS,
          text: got.hits === 0 ? 'not ducking' : `${got.depth.toFixed(1)} dB of duck`,
        },
        {
          state: timeOk ? HIT : timeOff <= 0.8 ? NEAR : MISS,
          text: got.hits === 0 ? 'key it off the kick'
            : stuck ? 'never comes back up'
            : got.held ? `back in ${Math.round(got.recovery)} ms, when it comes back`
            : `back in ${Math.round(got.recovery)} ms`,
        },
      ],
      why: [
        {
          label: 'Depth',
          value: `${got.depth.toFixed(2)} dB, wanted ${answer.depth.toFixed(1)}`,
          how: 'Measured off the gain reduction at each kick rather than read off '
             + 'the threshold and ratio, because what a sidechain actually does '
             + 'depends on how loud the key signal is when it arrives.',
        },
        {
          label: 'Recovery',
          value: stuck ? 'never comes back up'
               : `${Math.round(got.recovery)} ms, wanted ${Math.round(answer.recovery)}`,
          how: 'How long it takes to climb back to within a couple of decibels of '
             + 'where it started, averaged over the kicks in the loop.',
        },
        {
          label: 'Time, as a ratio',
          value: stuck ? 'out of range' : `${timeOff.toFixed(2)} octaves out`,
          how: 'Time is heard in ratios, so this is compared in log space: a '
             + 'hundred milliseconds out means something quite different at 120 '
             + 'than it does at 400. A third of the way to twice as long is the '
             + 'window.',
        },
      ],
    };
  },

  /* ---------- the surface ---------- */

  mount(el, { engine, puzzle, onChange }) {
    const exercise = puzzle.settings.exercise;
    const spec = COMP_EXERCISES[exercise];
    const settings = { ...COMP_DEFAULTS };

    const plugin = new CompPlugin(el, {
      engine,
      settings,
      onChange,
      source: spec.source,
      key: spec.key,
      uneven: puzzle.uneven ?? 0,
    });

    plugin.nameOther(spec.other);
    // In match there is a compressor on the other side of the A/B. In the
    // other two there is nothing there: what you are comparing against is the
    // loop untouched, which is what a bypass button is.
    plugin.setTarget(exercise === 'match' ? puzzle.answer : { ...COMP_DEFAULTS, mix: 0 });

    // The audio a guess is read against, rendered once and kept on the puzzle.
    // The sample picker changes what you monitor and never what you are marked
    // on - otherwise the way to pass would be to switch to pink noise, where
    // every setting does much the same thing and every answer looks right.
    (async () => {
      try {
        const signal = await engine.renderLoop(spec.source, { uneven: puzzle.uneven ?? 0 });
        const key = spec.key ? await engine.renderLoop(spec.key) : null;
        // The same bed without the fault in it - what evening the loop out is
        // aiming at, and never played: it is the answer, not a clue.
        const even = puzzle.uneven ? await engine.renderLoop(spec.source) : signal;
        puzzle.material = {
          rate: engine.ctx.sampleRate,
          samples: signal.getChannelData(0),
          even: even.getChannelData(0),
          key: key ? key.getChannelData(0) : null,
        };
      } catch {
        // No audio yet; scoring falls back to its own probe.
      }
    })();

    return {
      guess: () => ({ ...settings }),
      reveal: ({ live = false } = {}) => {
        if (exercise === 'match') plugin.showTarget(puzzle.answer);
        if (!live) plugin.lock();
      },
      unlock: () => plugin.unlock(),
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

  /**
   * The way out, in two rungs, worked out from the answer.
   *
   * What people get wrong first on a compressor is almost never the number -
   * it is the kind of thing being asked for. So the first rung says what sort
   * of compression this is, and the second puts a region round the control
   * that is doing the work.
   */
  hints(answer, tier, puzzle) {
    const exercise = puzzle?.settings?.exercise ?? 'match';

    if (exercise === 'fix') {
      const uneven = puzzle?.uneven ?? 12;
      return [
        `The loop is about ${uneven} dB apart beat to beat, and the job is to `
          + 'close that up without flattening it.',
        'Work down from a gentle ratio rather than up from a hard one: the '
          + 'threshold is doing most of this, and there is a ceiling on how much '
          + 'reduction counts as levelling rather than squashing.',
      ];
    }

    if (exercise === 'duck') {
      return [
        'This is keyed off the kick, so the detector is listening to something '
          + 'other than what you are hearing come out.',
        `It wants around ${answer.depth.toFixed(0)} dB of duck, back up in `
          + `${answer.recovery < 180 ? 'under a fifth of a second' : answer.recovery < 320 ? 'roughly a quarter of a second' : 'something over a third of a second'}. `
          + 'The release is what sets that, not the ratio.',
      ];
    }

    const settings = settle(answer);
    const ratio = settings.ratio;
    return [
      ratio >= 8 ? 'It is working hard - a limiting sort of ratio, not a gentle one.'
        : ratio >= 4 ? 'It is a working ratio: audible, but not limiting.'
        : 'It is gentle - a low ratio doing a little, everywhere.',
      `The attack is ${settings.attack < 8 ? 'fast enough to catch the transient'
        : settings.attack < 40 ? 'middling - the transient gets through, then it clamps'
        : 'slow: it lets the hit past before it does anything'}, and the release is `
        + `${settings.release < 120 ? 'short' : settings.release < 350 ? 'medium' : 'long'}.`,
    ];
  },

  reveal(answer, tier, puzzle) {
    const exercise = puzzle?.settings?.exercise ?? 'match';

    if (exercise === 'fix') {
      return {
        symbol: `${puzzle?.uneven ?? 12} dB apart`,
        name: 'level it without flattening it',
      };
    }

    if (exercise === 'duck') {
      return {
        symbol: `${answer.depth.toFixed(1)} dB`,
        name: `of duck, back in ${Math.round(answer.recovery)} ms`,
      };
    }

    const settings = settle(answer);
    return {
      symbol: writeRatio(settings.ratio),
      name: `over ${settings.threshold.toFixed(1)} dB, `
          + `${writeTime(settings.attack)} / ${writeTime(settings.release)}`,
    };
  },

  weak(answer, puzzle) {
    const exercise = puzzle?.settings?.exercise ?? 'match';
    if (exercise === 'fix') return { key: 'levelling', label: 'levelling a loop' };
    if (exercise === 'duck') return { key: 'sidechain', label: 'sidechain ducking' };

    const ratio = settle(answer).ratio;
    const hard = ratio >= 8 ? 'hard ratios' : ratio >= 4 ? 'working ratios' : 'gentle ratios';
    return { key: hard, label: hard };
  },
};
