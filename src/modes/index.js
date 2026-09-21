import chords from './chords.js';
import pitch from './pitch.js';
import intervals from './intervals.js';
import eq from './eq.js';
import rhythm from './rhythm.js';
import panning from './panning.js';
import compression from './compression.js';

/**
 * The suite, in the order the project plan builds it: the two named modes
 * first, then the stretch ones. A mode is data and a handful of functions -
 * what it asks, how it sounds, how a guess is read - and the shell around it
 * does not know which one it is showing.
 */
export const MODES = {
  chords, pitch, intervals, eq, rhythm, panning, compression,
};

export const MODE_IDS = Object.keys(MODES);

export const modeOf = (id) => MODES[id] ?? MODES.chords;
