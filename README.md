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
```

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

## Layout

```
index.html        shell and markup
styles.css        styling, dark and light
src/theory.js     pitch classes, qualities, tiers, voicings
src/audio.js      Web Audio piano synth
src/random.js     seeded PRNG + daily/puzzle numbering
src/game.js       scoring and game state (pure, no DOM)
src/stats.js      localStorage persistence
src/share.js      emoji result grid
src/main.js       DOM wiring
tests/            node:test coverage of the logic above
```

Game logic is deliberately DOM-free so the next mode (EQ) can reuse the shell:
a mode supplies a puzzle generator, a guess picker and a scorer, and the board,
sharing and stats keep working as they are.
