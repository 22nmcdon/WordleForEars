// Bundles the app into one self-contained HTML page.
//
// The same page, with the stylesheet and the ES modules folded in: an artifact
// is published as a single file, and a page that fetched ./src/game.js from
// somewhere it is not would simply do nothing. Nothing is minified and nothing
// is rewritten beyond the module keywords, so the bundle is the source read
// top to bottom.

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Dependency order. Several modules read another's values while they are still
// being evaluated - the registry builds itself out of the seven modes, and the
// game's guess ceiling out of the registry - so this is an order, not a list.
const MODULES = [
  'theory.js', 'random.js', 'engrave.js',
  'modes/scoring.js',
  'modes/chords.js', 'modes/pitch.js', 'modes/intervals.js', 'modes/eq.js',
  'modes/rhythm.js', 'modes/panning.js', 'modes/compression.js',
  'modes/index.js',
  'audio.js', 'game.js', 'stats.js', 'share.js', 'main.js',
];

/**
 * Strips the module keywords, so that files written to import and export each
 * other's names can share one scope instead.
 *
 * A default export has no name of its own, so it takes its file's - which is
 * exactly the name the importing file already uses for it, and is why nothing
 * in this tree imports anything under an alias.
 */
function flatten(source, name) {
  return source
    .replace(/^export\s*\{[^}]*\}\s*from\s*['"][^'"]+['"];\s*$/gm, '')
    .replace(/^import\s+[\s\S]*?from\s+['"][^'"]+['"];\s*$/gm, '')
    .replace(/^export\s+default\s+/gm, `const ${name} = `)
    .replace(/^export\s+/gm, '')
    .trim();
}

const page = await readFile(join(root, 'index.html'), 'utf8');
const styles = await readFile(join(root, 'styles.css'), 'utf8');

const body = page
  .slice(page.indexOf('<body>') + '<body>'.length, page.indexOf('</body>'))
  .replace(/<script type="module"[\s\S]*?<\/script>/, '')
  .trim();

const fonts = /<link id="webfonts"[\s\S]*?>/.exec(page)[0];

// The name alone. In a gallery the title is how the page is picked out, and
// the half after the dash is an explainer - which belongs in the description
// the gallery card already prints underneath.
const title = 'Harmonle';

const code = [];
for (const path of MODULES) {
  const source = await readFile(join(root, 'src', path), 'utf8');
  const name = path.split('/').pop().replace(/\.js$/, '');
  code.push(`/* ---- src/${path} ---- */\n${flatten(source, name)}`);
}

// One scope, so the bundle cannot leak names into the host page.
const script = `<script type="module">\n(function () {\n${code.join('\n\n')}\n}());\n</script>`;

// No <!doctype>, <html>, <head> or <body>: an artifact is wrapped in its own
// skeleton at publish time, and a second one nested inside it is not a page.
const bundle = `<title>${title}</title>
${fonts}
<style>
${styles.trim()}
</style>

${body}

${script}
`;

await writeFile(join(root, 'dist', 'harmonle.html'), bundle);
console.log(`dist/harmonle.html — ${(bundle.length / 1024).toFixed(1)} KB`);
