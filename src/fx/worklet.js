// Getting a piece of DSP onto the audio thread without writing it twice.
//
// Every processor in this app that is not a filter is a function written once
// in a module and then needed in three places: the audio thread that makes
// the sound, the scoring that reads a guess, and the tests that measure it.
// Keeping a second copy of it in a template literal would mean two
// processors, and the day they drifted apart the game would be marking people
// against a sound nobody made.
//
// So the worklet is written out of the module's own source: the functions are
// stringified and handed to the audio thread verbatim. What each processor
// still owns is its own process() - what its inputs mean and what it reports
// back - because that part really does differ.

/**
 * A worklet module, as source.
 *
 * `constants` are the module-level values the functions read, written out as
 * a table rather than spelled into a template, for two reasons. The values
 * come from the real constants, so the audio thread cannot drift from the
 * module. And the declarations never appear as source in the calling file,
 * which keeps the bundler's duplicate-name check from reading a string as a
 * second declaration of something a module already owns.
 */
export function workletModule({ constants = {}, parts = [], processor }) {
  const prelude = Object.entries(constants)
    .map(([name, value]) => `const ${name} = ${value};`)
    .join('\n');

  return `${prelude}

${parts.map((part) => part.toString()).join('\n\n')}

${processor}`;
}

/** Loads a worklet into a context once, and remembers whether it took. */
const loaded = new WeakMap();

export function installWorklet(ctx, source) {
  if (loaded.has(ctx)) return loaded.get(ctx);

  const attempt = (async () => {
    if (!ctx.audioWorklet) return false;
    const url = URL.createObjectURL(new Blob([source], { type: 'application/javascript' }));
    try {
      await ctx.audioWorklet.addModule(url);
      return true;
    } catch {
      // Blocked, or an older browser. Whoever asked has a fallback.
      return false;
    } finally {
      URL.revokeObjectURL(url);
    }
  })();

  loaded.set(ctx, attempt);
  return attempt;
}
