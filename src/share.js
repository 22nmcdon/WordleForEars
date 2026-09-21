import { HIT, NEAR, notesState } from './game.js';
import { TIERS } from './theory.js';

const SQUARE = { [HIT]: '🟩', [NEAR]: '🟨', miss: '⬜' };

/** Wordle-style result grid: one row per guess, root / quality / note-match. */
export function shareText(game, { title = 'Harmonle' } = {}) {
  const { mode, puzzle, guesses, status, number } = game;
  const label = mode === 'daily' ? `#${number}` : 'Practice';
  const tier = TIERS[puzzle.tier].label;
  const score = status === 'won' ? `${guesses.length}/6` : 'X/6';

  const grid = guesses
    .map(({ score: s }) => SQUARE[s.root] + SQUARE[s.quality] + SQUARE[notesState(s.notes)])
    .join('\n');

  return `${title} ${label} · Chords ${tier} ${score}\n\n${grid}`;
}

export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
