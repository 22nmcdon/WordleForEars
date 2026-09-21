# Harmonle — ear-training Wordle (proof of concept)

Hear a chord, guess its root and quality, get Wordle-style coloured feedback.
This is step 1 of [the project plan](#whats-in-this-poc): **Chords mode**, piano,
no accounts, stats stored locally in the browser.

## Run it

It is a static site with no build step and no dependencies:

```bash
npm start           # python3 -m http.server 8080
# then open http://localhost:8080
```

(Any static server works. Opening `index.html` straight off disk will not — the
app uses ES modules, which browsers refuse to load over `file://`.)

```bash
npm test            # node --test — pure game/theory/stats logic
npm run artifact    # bundles the whole app into dist/harmonle.html, one file
```

`npm run artifact` folds the stylesheet and the ES modules into a single page so
it can be published or opened straight off disk. Nothing is minified and nothing
is rewritten beyond the module keywords, so the bundle reads as the source does.

## How a round works

1. **Play chord** synthesises the clue live (Web Audio, additive piano tone).
   **Arpeggiate** spreads it out; **Reference C** gives you middle C to orient by.
2. Pick a **root** and a **quality**, then submit. Six guesses.
3. Each guess scores three cells:

| Cell | 🟩 Green | 🟨 Yellow | ⬜ Grey |
| --- | --- | --- | --- |
| Root | the right root | the note is *in* the chord but is not its root | not in the chord |
| Quality | exactly right | shares an interval above the root with the answer | shares nothing |
| Notes | all of the answer's notes | some of them | none |

The third cell scores the guess as a whole — `2/3` means your chord contains two
of the answer's three notes — which is the proximity feedback the plan asks for.

## What's in this POC

- **Chords mode** with all three difficulty tiers from the plan: Easy (triads),
  Medium (6th/7th chords), Hard (extensions and altered dominants). The tier
  table is data, so tiers were nearly free once Easy worked.
- **Voicing** toggle: root position, inversions, drop-2 open voicings.
- **Daily** puzzle, seeded from the UTC date so everyone gets the same chord,
  plus unlimited **practice**. A finished daily is stored and replayed read-only
  rather than offered again.
- **Shareable grid** (copied to the clipboard) that never leaks the answer.
- **Local stats**: played / win % / streak / best, guess distribution, and the
  "you're weak on half-diminished chords" hint, kept per mode and per tier.

## Not built yet

- EQ mode, and the intervals / rhythm / panning / compression modes.
- Guitar and synth-pad timbres — the instrument toggle is present but disabled.
- Any server, account, or cross-device sync. Stats live in `localStorage`.

## The look

It follows `BRANDING.md`: a Real Book page that answers back. Cream paper, charcoal ink,
blush and gold accents, Playfair / Cormorant / Jost — and the chord symbols hand-lettered
in Kalam, because they are the one thing on the page a player would have written.

- **The five meaning colours do not move between modes.** Sage is "in the chord, in that
  slot", gold is "in the chord, somewhere else", rust is "outside the chord". Outside is
  where a note sits, not a mark against you — nothing here calls a player wrong.
- **Practice is the same page in a different light.** `body.practice` redefines the
  palette tokens and nothing else: paper drops a stop and goes cooler, the rose accent
  becomes slate. No component knows the page changed colour.
- **Three radii, each meaning something.** `1px` is paper (inputs, filled buttons), a pill
  is a state you are in (the mode switch, the puzzle chip), `50%` is a dot (the help `?`).
- **The roots are a keyboard, not a list of chips.** Picking a root is a key, which is the
  gesture the ear is already making.
- **Webfonts never block rendering.** The `<link>` carries `data-href` and is promoted by
  script only when the page is served; every family has a real fallback, so the page reads
  the same offline in the fallback faces.

Checked at 430px as well as 1280px, and with the webfonts both loaded and blocked.

## Layout

```
index.html        shell and markup
styles.css        the design system, as tokens and components
src/theory.js     pitch classes, qualities, tiers, voicings
src/audio.js      Web Audio piano synth
src/random.js     seeded PRNG + daily/puzzle numbering
src/game.js       scoring and game state (pure, no DOM)
src/stats.js      localStorage persistence
src/share.js      emoji result grid
src/engrave.js    chord symbols written the way a chart writes them
src/main.js       DOM wiring
tests/            node:test coverage of the logic above
```

Game logic is deliberately DOM-free so the next mode (EQ) can reuse the shell:
a mode supplies a puzzle generator, a guess picker and a scorer, and the board,
sharing and stats keep working as they are.
