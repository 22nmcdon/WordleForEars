import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BAND_TYPES, STRIP, newStrip, bandGainAt, contributionOf, curveOf,
  averageLift, liftFrequencies, logFrequencies,
} from '../src/eq/filters.js';
import { averageSpectrum } from '../src/eq/spectrum.js';

const rate = 48000;
const on = (band) => ({ gain: 0, q: 1, on: true, ...band });

/** An AudioBuffer, near enough: the spectrum only reads these two things. */
const bufferOf = (fill, seconds = 1) => {
  const samples = new Float32Array(rate * seconds);
  for (let i = 0; i < samples.length; i += 1) samples[i] = fill(i / rate, i);
  return { sampleRate: rate, getChannelData: () => samples };
};

test('a band does exactly what it says at its own frequency', () => {
  // This is what lets a handle sit on the curve: each type contributes
  // something known where it lives.
  assert.equal(bandGainAt(on({ type: 'peaking', frequency: 1000, gain: 6, q: 2 }), 1000, rate).toFixed(3), '6.000');
  assert.equal(bandGainAt(on({ type: 'lowshelf', frequency: 200, gain: 8 }), 200, rate).toFixed(3), '4.000');
  assert.equal(bandGainAt(on({ type: 'highshelf', frequency: 5000, gain: -10 }), 5000, rate).toFixed(3), '-5.000');
  assert.equal(bandGainAt(on({ type: 'highpass', frequency: 300, q: 6 }), 300, rate).toFixed(3), '6.000');
  assert.equal(bandGainAt(on({ type: 'lowpass', frequency: 4000, q: -3 }), 4000, rate).toFixed(3), '-3.000');

  for (const [type, spec] of Object.entries(BAND_TYPES)) {
    const band = on({ type, frequency: 1000, gain: 8, q: 4 });
    const expected = spec.gain ? 8 * spec.contributes : 4;
    assert.ok(Math.abs(bandGainAt(band, 1000, rate) - expected) < 0.001,
      `${type} does not contribute what BAND_TYPES says it does`);
  }
});

test('an off band is out of the curve entirely', () => {
  const band = { type: 'peaking', frequency: 1000, gain: 12, q: 1, on: false };
  assert.equal(curveOf([band], [1000], rate)[0], 0);
  assert.equal(contributionOf(band, rate), 0);
  assert.equal(curveOf(newStrip(), logFrequencies(20), rate).every((db) => db === 0), true,
    'a fresh strip does nothing at all');
});

test('the strip is in the order an engineer reads it', () => {
  const frequencies = STRIP.map((band) => band.frequency);
  assert.deepEqual([...frequencies].sort((a, b) => a - b), frequencies, 'low to high');
  assert.equal(STRIP[0].type, 'highpass');
  assert.equal(STRIP[STRIP.length - 1].type, 'lowpass');
  for (const band of STRIP) {
    if (BAND_TYPES[band.type].resonance) {
      assert.ok(band.q <= 0, `${band.id} starts resonant; a cut should start flat`);
    }
  }
});

test('the spectrum finds where a sound actually is', () => {
  const frequencies = liftFrequencies();
  const tone = averageSpectrum(bufferOf((t) => Math.sin(2 * Math.PI * 1000 * t)), frequencies);

  const loudest = tone.indexOf(Math.max(...tone));
  assert.ok(Math.abs(frequencies[loudest] - 1000) / 1000 < 0.15,
    `a 1 kHz tone reads loudest at ${Math.round(frequencies[loudest])} Hz`);

  // And nothing an octave away from it.
  const away = frequencies.findIndex((hz) => hz > 4000);
  assert.ok(tone[away] < tone[loudest] / 1e6, 'a tone is not broadband');
});

test('auto gain knows a move is worth what the material has there', () => {
  const frequencies = liftFrequencies();
  // Something with energy only down low, as a bass-heavy loop is.
  const bass = averageSpectrum(bufferOf((t) => Math.sin(2 * Math.PI * 80 * t)), frequencies);

  const lowShelf = [{ type: 'lowshelf', frequency: 200, gain: 10, q: 0.7, on: true }];
  const highShelf = [{ type: 'highshelf', frequency: 6000, gain: 10, q: 0.7, on: true }];

  // Weighted by what is actually there, lifting the bass is a real change and
  // lifting the top is nearly nothing. Unweighted, the two look alike.
  assert.ok(averageLift(lowShelf, rate, bass) > 9, 'a shelf over the bass of a bass-heavy loop is loud');
  assert.ok(averageLift(highShelf, rate, bass) < 0.5, 'a shelf where there is no energy is not');

  const evenly = averageLift(highShelf, rate);
  assert.ok(evenly > 2, `unweighted, the same move looks like ${evenly.toFixed(1)} dB`);
});

test('auto gain is a fair trade: it never rewards boosting', () => {
  const frequencies = liftFrequencies();
  const pink = averageSpectrum(bufferOf(() => Math.random() * 2 - 1), frequencies);

  for (const gain of [3, 6, 12, 18]) {
    const boost = [{ type: 'peaking', frequency: 1000, gain, q: 0.8, on: true }];
    const cut = [{ type: 'peaking', frequency: 1000, gain: -gain, q: 0.8, on: true }];

    assert.ok(averageLift(boost, rate, pink) > 0, 'a boost lifts');
    assert.ok(averageLift(cut, rate, pink) < 0, 'a cut drops');
  }

  assert.equal(averageLift(newStrip(), rate, pink).toFixed(6), '0.000000', 'and a flat EQ does neither');
});
