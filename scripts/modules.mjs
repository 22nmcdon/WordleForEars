// The order every module is flattened in - worked out, not written down.
//
// It was a hand-ordered list, and it had to be: several modules read another's
// values while they are still being evaluated, so the order is an order and
// not a set. But a hand-ordered list of nearly fifty files has exactly two
// failure modes, and both of them are silent. Leave a file out and it is not a
// syntax error - the page dies at run time on the first line that uses a name
// nothing declared. Put one in the wrong place and it is not an error at all;
// it is a control that comes up empty.
//
// The imports already say what the order is. This reads them.

import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'src');

/** Where a relative import lands, as a path under `src/`. */
function resolve(from, target) {
  const folder = from.includes('/') ? from.slice(0, from.lastIndexOf('/')) : '';
  const parts = (folder ? folder.split('/') : []).concat(target.split('/'));
  const out = [];
  for (const part of parts) {
    if (part === '.' || part === '') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

/** What one file imports from inside this tree. */
const importsOf = (source) =>
  [...source.matchAll(/from\s+['"](\.[^'"]+)['"]/g)].map((m) => m[1]);

/**
 * Every file under `src/`, whether or not anything imports it.
 *
 * Only used to check the closure below covers the tree. A file nothing imports
 * is not a build error - it is a file somebody wrote and forgot to wire up,
 * which is worth saying out loud rather than silently omitting.
 */
export async function allSources(dir = SRC, prefix = '') {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...await allSources(join(dir, entry.name), path));
    else if (entry.name.endsWith('.js')) found.push(path);
  }
  return found.sort();
}

/**
 * The modules `main.js` reaches, depth first, each one after everything it
 * imports.
 *
 * A depth-first post-order over the import graph is a topological sort, and a
 * total one while the graph is acyclic - which this tree is, and which the
 * cycle check below keeps true. So the result is not "an order that works": it
 * is the only order consistent with what the files say about each other.
 */
export async function moduleOrder(entry = 'main.js') {
  const order = [];
  const state = new Map(); // path -> 'visiting' | 'done'

  async function walk(path, trail) {
    if (state.get(path) === 'done') return;
    if (state.get(path) === 'visiting') {
      throw new Error(
        `these modules import each other in a circle, so no order can satisfy them:\n  `
        + [...trail, path].join(' -> ')
        + '\nBreak the cycle by moving whatever they share into a third file.');
    }

    state.set(path, 'visiting');
    let source;
    try {
      source = await readFile(join(SRC, path), 'utf8');
    } catch {
      throw new Error(`${path} is imported but does not exist (from ${trail.at(-1) ?? 'the entry'})`);
    }

    for (const target of importsOf(source)) {
      await walk(resolve(path, target), [...trail, path]);
    }

    state.set(path, 'done');
    order.push(path);
  }

  await walk(entry, []);
  return order;
}

/** Anything under `src/` that nothing reaches from the entry point. */
export async function stranded(entry = 'main.js') {
  const reached = new Set(await moduleOrder(entry));
  return (await allSources()).filter((path) => !reached.has(path));
}

export const MODULES = await moduleOrder();
