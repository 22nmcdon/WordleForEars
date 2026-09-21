# Harmonle — ear-training Wordle (proof of concept)

Hear something and name what it was, with Wordle-style coloured feedback.
**Seven modes**, three tiers each, a daily puzzle per mode and unlimited
practice. No accounts; stats stay in the browser.

| Mode | The question | Tiers run from |
| --- | --- | --- |
| **Chords** | What kind of chord is that | triads → altered dominants |
| **Pitch** | Name the note you heard | white notes → all twelve, no reference |
| **Intervals** | How far apart were they | octave and 5th → the tritone and the m2 |
| **EQ** | Where did the move happen | five wide zones at ±10 dB → nine surgical ones at ±2 |
| **Rhythm** | What is it playing | subdivisions → clave and polyrhythm |
| **Panning** | Where is it in the stereo field | left/centre/right → seven positions |
| **Compression** | How hard is it being squashed | is it even → ratio and attack |

## Run it

A static site with no build step and no dependencies:

```bash
npm start           # python3 -m http.server 8080
# then open http://localhost:8080
```

(Any static server works. Opening `index.html` straight off disk will not — the
app uses ES modules, which browsers refuse to load over `file://`.)

```bash
npm test            # node --test — the modes, the round, the stats
npm run artifact    # bundles the whole app into dist/harmonle.html, one file
```

`npm run artifact` folds the stylesheet and the ES modules into a single page so
it can be published or opened straight off disk. Nothing is minified and nothing
is rewritten beyond the module keywords, so the bundle reads as the source does.

Flattening seven modules into one scope has one hazard, and it shipped once: two
modules had each grown a `write`, which is nothing in separate scopes and a
SyntaxError in one — and a script that does not parse leaves a page whose every
control comes up empty. The bundler now refuses to emit a bundle whose modules
would collide, names both files when they do, and parses its own output before
writing it; `tests/bundle.test.js` runs the whole thing on every `npm test`.

## How a round works

1. Press the clue. Most modes offer something to compare against — EQ plays the
   same bars **flat**, compression plays them **uncompressed**, chords will
   **arpeggiate**, pitch and intervals offer a **reference C**.
2. Name what you heard. Some modes ask one thing, some ask two: an EQ move is a
   band *and* a gain.
3. Two to four guesses depending on the tier — enough to deduce, never enough to
   press every button. A test enforces exactly that.

Every guess comes back as coloured readings: 🟩 that is it, 🟨 close, 🟥 not
close. What "close" means is each mode's own business, and the last column
spells it out — `2/3` notes shared, `1 semitone`, `1.3 oct`, `2 steps`,
`syncopated`.

Nothing here tells you that you are wrong. "Outside the chord", "1.3 octaves
off" — the reading names where the thing sits, which is the ear-training answer
and also the house style.

## What's in this POC

- **All seven modes above**, each with three tiers, a daily seeded from the UTC
  date (the same puzzle for everybody) and unlimited practice.
- **Every sound synthesised live** — no samples to host. A piano built from
  additive partials, a kit built from filtered noise, and a four-piece bed
  (kick, bass, chord, hats) for the modes that need something broadband to judge
  a move against.
- **A setting per mode** that changes *what* you are listening to rather than
  how hard it is: the chord's voicing, the EQ source, melodic against harmonic
  intervals, the tempo, a reference tone or none.
- **Shareable grids**, per-mode stats (streaks, distribution, and which kind of
  answer keeps catching you out), and a finished daily that comes back read-only
  instead of being offered twice.

## Not built yet

- **Guitar and synth-pad timbres** for chords — the plan's third variable. One
  piano for now.
- **Stereo width** in panning, and **release** in compression: both are in the
  plan's sketch of those modes, and both are one more slot when wanted.
- **EQ's continuous-Hz guess** on the hard tier. It is nine zones with a
  tolerance, not a free number with a tolerance window.
- Any server, account or cross-device sync. Stats live in `localStorage`.

## Adding a mode

A mode is data and seven functions in `src/modes/`, registered in
`src/modes/index.js`. It says what it asks (`slots`), how to make a puzzle
(`makePuzzle`), how to read a guess (`score`), what to play (`clues` + `play`),
and what the answer was (`reveal`, `weak`). Nothing else in the app knows which
mode is showing — the board, the picker, the share grid and the stats are all
built from what the mode returns.

`tests/modes.test.js` holds every mode to that contract: that its own answer
scores green in every cell, that every answer it can generate is answerable from
the chips on screen, that it says something beyond repeating the guess back, and
that each of its clues actually makes a sound.

## The look

It follows `BRANDING.md`: a Real Book page that answers back. Cream paper,
charcoal ink, blush and gold accents, Playfair / Cormorant / Jost — and chord
symbols hand-lettered in Kalam, because they are the one thing on the page a
player would have written.

- **The five meaning colours do not move between modes.** Sage is "that is it",
  gold is "close", rust is "not close" — the same three readings whether the
  thing being read is a chord, a frequency or a clave.
- **Practice is the same page in a different light.** `body.practice` redefines
  the palette tokens and nothing else: paper drops a stop and goes cooler, the
  rose accent becomes slate. No component knows the page changed colour.
- **Three radii, each meaning something.** `1px` is paper (inputs, filled
  buttons), a pill is a state you are in, `50%` is a dot (the help `?`).
- **The hand face is for chord symbols only** — so is the raised-extension
  treatment that goes with it. A frequency or an interval is set in the serif,
  on the line, with tabular figures.
- **Webfonts never block rendering.** The `<link>` carries `data-href` and is
  promoted by script only when the page is served; every family has a real
  fallback, so the page reads the same offline in the fallback faces.

Checked at 430px as well as 1280px, and with the webfonts both loaded and
blocked.

## Layout

```
index.html          shell and markup
styles.css          the design system, as tokens and components
src/audio.js        the whole suite's sound: piano, kit, bed, patterns
src/theory.js       pitch classes, chord qualities, voicings
src/random.js       seeded PRNG + daily/puzzle numbering
src/modes/          one file per mode, plus the shared scoring vocabulary
src/game.js         the round, over whichever mode is asking (pure, no DOM)
src/stats.js        localStorage persistence, per mode and tier
src/share.js        emoji result grid
src/engrave.js      chord symbols written the way a chart writes them
src/main.js         DOM wiring
scripts/            the single-file bundler
tests/              node:test coverage of all of the above
```

Game logic is deliberately DOM-free, which is what let one shell serve seven
modes — and what lets the modes be tested without a browser.

The audio was checked by rendering it, not by listening hopefully: every mode's
clue goes through an `OfflineAudioContext` and gets measured. That is how the EQ
move was confirmed to land on its own band (+10 dB at 3 kHz, −0.7 dB two zones
away), how panning was confirmed to be a real stereo image rather than a level
difference, and how two genuine bugs were found — the rhythm clue peaking at
0.06 where the rest of the suite peaks near 0.35, and compression clipping at
1.8 because Web Audio's compressor applies a makeup gain of its own on top of
the one the mode was adding. Compression's `trim` numbers come straight out of
that measurement: every setting now sits within ±1.4 dB of the untouched loop,
so the mode is a compression test rather than a loudness test.
