import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MODE_IDS } from '../src/modes/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const run = promisify(execFile);

/**
 * The published page is the bundle, not the modules - so the bundle is what
 * has to be known-good. It went out broken once: two modules had grown a
 * function of the same name, which is nothing in separate scopes and a
 * SyntaxError in one, and a script that does not parse leaves a page whose
 * every control is empty. Nothing about that is visible in the source.
 */
test('the bundle builds, parses, and carries the whole app', async () => {
  await run(process.execPath, [join(root, 'scripts', 'build-artifact.mjs')]);
  const page = await readFile(join(root, 'dist', 'harmonle.html'), 'utf8');

  assert.match(page, /<title>Harmonle<\/title>/, 'the artifact keeps its name');
  assert.ok(!/<!doctype|<html|<body/i.test(page), 'an artifact brings its own skeleton');
  assert.ok(!/^import\s|^export\s/m.test(page), 'module keywords cannot survive into one scope');

  for (const mode of MODE_IDS) {
    assert.match(page, new RegExp(`const ${mode} = \\{`), `${mode} is missing from the bundle`);
  }
}, { timeout: 30000 });

test('no two modules declare the same top-level name', async () => {
  // The same check the bundler runs, asserted here so the failure arrives with
  // the test suite rather than at publishing time.
  const sources = await Promise.all(
    ['theory.js', 'random.js', 'engrave.js', 'audio.js', 'game.js', 'stats.js', 'share.js', 'main.js',
     'modes/scoring.js', 'modes/index.js', 'modes/chords.js', 'modes/pitch.js', 'modes/intervals.js',
     'modes/eq.js', 'modes/rhythm.js', 'modes/panning.js', 'modes/compression.js']
      .map(async (path) => [path, await readFile(join(root, 'src', path), 'utf8')]),
  );

  const owner = new Map();
  for (const [path, source] of sources) {
    for (const [, name] of source.matchAll(/^(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm)) {
      assert.ok(!owner.has(name) || owner.get(name) === path,
        `${name} is declared in both ${owner.get(name)} and ${path}`);
      owner.set(name, path);
    }
  }
});
