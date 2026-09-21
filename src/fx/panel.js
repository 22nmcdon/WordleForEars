import { LONGEST_TAIL, DECAY_FLOOR } from './response.js';

// The parts of a plugin's face that are the same in all of them.
//
// Three plugins now draw on a canvas and three of them turn a set of knobs
// into a set of sliders, and neither of those is a thing any one of them
// should own. What is here is what was written out three times: setting a
// canvas up for the screen it is on, turning a knob's range into a slider's
// and back, and the axis that a decay is drawn against.

/** A knob's range, as a slider's. Log knobs are dialled in octaves. */
export const dialOf = (knob, value) => (knob.log
  ? {
    min: Math.log2(knob.min),
    max: Math.log2(knob.max),
    step: 0.005,
    at: Math.log2(Math.max(knob.min, value)),
  }
  : { min: knob.min, max: knob.max, step: knob.step, at: value });

/** And back again. */
export const offDial = (knob, raw) => (knob.log ? 2 ** Number(raw) : Number(raw));

/** What a canvas is, on the page. */
export function sizeOf(canvas) {
  const box = canvas.getBoundingClientRect();
  return { width: box.width, height: box.height };
}

/**
 * A canvas set up for its own pixels, and a context to draw in.
 *
 * Returns nothing when the canvas has no size yet, which happens on the first
 * draw of a panel that has not been laid out - every caller checks for it.
 */
export function readyCanvas(canvas) {
  const { width, height } = sizeOf(canvas);
  if (!width || !height) return null;

  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(width * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }

  const c = canvas.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, width, height);
  return { c, width, height };
}

/**
 * Where a moment and a level sit on a decay display.
 *
 * Time runs logarithmically because a decay is heard as a ratio - the
 * difference between a third of a second and half a second is a different
 * room, and the difference between five seconds and five and a bit is
 * nothing at all.
 */
export const DECAY_FROM = 0.004;

export const decayX = (t, width) => (t <= DECAY_FROM
  ? 0
  : (Math.log2(t / DECAY_FROM) / Math.log2(LONGEST_TAIL / DECAY_FROM)) * width);

export const decayY = (db, height) => (db / DECAY_FLOOR) * height;

/** A length of time, said the way a plugin says it. */
export const writeMs = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`);
