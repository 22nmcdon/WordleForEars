// The order every module is flattened in, and the one thing the bundler and
// the tests have to agree about.
//
// It lived inside build-artifact.mjs, which is a script rather than a module:
// importing it runs a build. So the test that checks for duplicate top-level
// names kept its own hand-copied version of this list, and that copy went
// stale the moment a file was added or removed - which is the exact failure
// the check exists to catch.

// Dependency order. Several modules read another's values while they are still
// being evaluated - the registry builds itself out of the seven modes, and the
// game's guess ceiling out of the registry - so this is an order, not a list.
export const MODULES = [
  'random.js', 'engrave.js',
  'bench/picker.js',
  'notes/eq.js', 'notes/comp.js', 'notes/image.js',
  'notes/verb.js', 'notes/echo.js', 'notes/heat.js', 'notes/index.js',
  'audio.js',
  'fx/fft.js',
  'eq/filters.js', 'eq/spectrum.js', 'eq/player.js', 'eq/plugin.js',
  'comp/dsp.js', 'comp/node.js', 'comp/player.js', 'comp/plugin.js',
  'fx/response.js', 'fx/panel.js', 'fx/player.js', 'fx/worklet.js',
  'verb/ir.js', 'verb/plugin.js',
  'echo/line.js', 'echo/plugin.js',
  'image/field.js', 'image/node.js', 'image/player.js', 'image/plugin.js',
  'heat/shape.js', 'heat/node.js', 'heat/player.js', 'heat/plugin.js',
  'modes/scoring.js',
  'modes/eq.js', 'modes/panning.js', 'modes/compression.js', 'modes/reverb.js',
  'modes/delay.js', 'modes/saturation.js',
  'modes/index.js',
  'game.js', 'stats.js', 'share.js', 'main.js',
];
