import eq from './eq.js';
import panning from './panning.js';
import compression from './compression.js';
import reverb from './reverb.js';
import delay from './delay.js';
import saturation from './saturation.js';

/**
 * The tools.
 *
 * There were four more until recently - name the chord, name the note, name
 * the interval, name the figure - and they went because they were the wrong
 * subject. A producer can have a very good pair of ears and never name a
 * half-diminished seventh; that is musicianship, and this is not a
 * musicianship trainer.
 *
 * What replaces them asks the same shape of question about the right subject:
 * which band is boosted, how much reduction is that, even harmonics or odd.
 * That is production, it is what an ear actually has to learn here, and it is
 * measurable with the DSP already in this repository.
 */
export const MODES = {
  eq, compression, panning, reverb, delay, saturation,
};

export const MODE_IDS = Object.keys(MODES);

export const modeOf = (id) => MODES[id] ?? MODES.eq;
