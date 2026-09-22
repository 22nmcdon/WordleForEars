import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import { NOTES, notesFor } from '../src/notes/index.js';
import { MODES } from '../src/modes/index.js';
import { MODULES } from '../scripts/modules.mjs';

// Prose that nobody can reach is prose nobody wrote.
//
// This project shipped five paragraphs of coaching that were rendered into the
// page and hidden again in the same synchronous pass, for months, because
// nothing ever asserted that what was written could be read. These are the
// assertions that were missing.

const TOOLS = Object.keys(NOTES);

test('every tool has notes, and every note says something', () => {
  for (const id of TOOLS) {
    const notes = notesFor(id);
    assert.ok(notes, `${id} has no notes`);
    assert.ok(notes.title?.trim(), `${id} has no title`);
    assert.ok(notes.sections.length >= 3, `${id} has only ${notes.sections.length} sections`);

    for (const section of notes.sections) {
      assert.ok(section.heading?.trim(), `${id} has a section with no heading`);
      // Long enough to be an explanation rather than a label. The shortest
      // real one here is about forty words.
      const words = section.body.trim().split(/\s+/).length;
      assert.ok(words >= 30, `${id} / "${section.heading}" is only ${words} words`);
    }
  }
});

test('the notes cover every tool the app offers, and nothing it does not', () => {
  const surfaces = Object.entries(MODES)
    .filter(([, spec]) => spec.surface)
    .map(([id]) => id);

  for (const id of surfaces) {
    assert.ok(notesFor(id), `${id} is a tool with no notes`);
  }
  for (const id of TOOLS) {
    assert.ok(MODES[id], `notes exist for ${id}, which is not a mode`);
  }
});

test('nothing reaches across and hides what another function owns', () => {
  // The specific bug, as a guard. mountSurface used to do
  //
  //     $('#advice').hidden = $('#advice').hidden || !!own
  //
  // reaching past buildClue, which had written that element three lines
  // earlier, and hiding it for exactly the modes that had anything to put in
  // it. Five paragraphs, dark for months, because nothing ever asserted that
  // what was written could be read.
  //
  // So: mountSurface may hide the things it owns, and nothing else.
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

  const from = main.indexOf('function mountSurface()');
  const to = main.indexOf('function buildClue()');
  assert.ok(from > 0 && to > from, 'mountSurface is no longer where this test looks');

  const hidden = [...main.slice(from, to).matchAll(/\$\('(#[\w-]+)'\)\.hidden\s*=/g)]
    .map((m) => m[1])
    .sort();

  assert.deepEqual(hidden, ['#clue', '#picker'],
    `mountSurface writes .hidden on ${hidden.join(', ') || 'nothing'}`);
});

test('each tool’s DSP points at the notes that explain it', () => {
  // The two are different documents for different readers, and they are meant
  // to stay that way - but somebody arriving at the code should be told the
  // other one exists.
  const pairs = [
    ['src/eq/filters.js', 'src/notes/eq.js'],
    ['src/comp/dsp.js', 'src/notes/comp.js'],
    ['src/image/field.js', 'src/notes/image.js'],
    ['src/verb/ir.js', 'src/notes/verb.js'],
    ['src/echo/line.js', 'src/notes/echo.js'],
    ['src/heat/shape.js', 'src/notes/heat.js'],
  ];

  for (const [code, notes] of pairs) {
    const source = readFileSync(new URL(`../${code}`, import.meta.url), 'utf8');
    assert.ok(source.includes(notes), `${code} does not point at ${notes}`);
  }
});

test('every notes file is in the bundle', () => {
  // The list is derived from what main.js imports now, so a file can no longer
  // be left out by hand - but it can be left unimported, which comes to the
  // same thing: a page where that tool silently has no notes.
  for (const file of readdirSync(new URL('../src/notes', import.meta.url))) {
    assert.ok(MODULES.includes(`notes/${file}`), `notes/${file} is not reachable from main.js`);
  }
});
