import { HIT, NEAR } from './modes/scoring.js';
import { modeOf } from './modes/index.js';

const SQUARE = { [HIT]: '🟩', [NEAR]: '🟨', miss: '⬜' };

/** Wordle-style result grid: one row per guess, one square per reading. */
export function shareText(game, { title = 'Harmonle' } = {}) {
  const { mode: playing, puzzle, guesses, status, number } = game;
  const spec = modeOf(puzzle.mode);
  const label = playing === 'daily' ? `#${number}` : 'Practice';
  const score = status === 'won' ? `${guesses.length}/${game.allowed}` : `X/${game.allowed}`;

  const grid = guesses
    .map(({ score: s }) => s.cells.map((cell) => SQUARE[cell.state]).join(''))
    .join('\n');

  return `${title} ${spec.label} ${label} · ${spec.tiers[puzzle.tier].label} ${score}\n\n${grid}`;
}

export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
