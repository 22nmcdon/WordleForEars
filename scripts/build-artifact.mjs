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

// Dependency order. Two modules read another's values while they are still
// being evaluated - share.js builds its emoji table out of game.js's tiers -
// so this is an order, not a list.
const MODULES = [
  'theory.js', 'random.js', 'engrave.js', 'audio.js',
  'game.js', 'stats.js', 'share.js', 'main.js',
];

/** Strips the module keywords. Every module here exports names and imports
    names, so once they share one scope the keywords are all that has to go. */
function flatten(source) {
  return source
    .replace(/^import\s+[\s\S]*?from\s+['"][^'"]+['"];\s*$/gm, '')
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
for (const name of MODULES) {
  const source = await readFile(join(root, 'src', name), 'utf8');
  code.push(`/* ---- src/${name} ---- */\n${flatten(source)}`);
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
