import {
  QUALITIES, TIERS, VOICINGS, ROOT_LABELS, voiceChord, chordName, qualityLabel,
} from './theory.js';
import {
  MAX_GUESSES, HIT, NEAR, MISS, notesState,
  createGame, submitGuess, makePuzzle, dailySeed, practiceSeed,
} from './game.js';
import { PianoEngine } from './audio.js';
import { getStats, recordGame, dailyResult, weakestQuality, resetStats } from './stats.js';
import { shareText, copyToClipboard } from './share.js';
import { puzzleNumber } from './random.js';

const $ = (sel) => document.querySelector(sel);

const piano = new PianoEngine();

const ui = {
  mode: 'daily',
  tier: 'easy',
  voicing: 'root',
  root: null,
  quality: null,
  game: null,
  plays: 0,
};

/* ---------- setup controls ---------- */

function fillSelects() {
  $('#tier').innerHTML = Object.entries(TIERS)
    .map(([id, t]) => `<option value="${id}">${t.label} — ${t.blurb}</option>`)
    .join('');
  $('#voicing').innerHTML = Object.entries(VOICINGS)
    .map(([id, v]) => `<option value="${id}">${v.label}</option>`)
    .join('');
  $('#tier').value = ui.tier;
  $('#voicing').value = ui.voicing;
}

function buildPicker() {
  $('#roots').innerHTML = ROOT_LABELS
    .map((label, i) => `<button class="chip" type="button" data-root="${i}">${label}</button>`)
    .join('');
  $('#qualities').innerHTML = TIERS[ui.tier].qualities
    .map((q) => `<button class="chip wide" type="button" data-quality="${q}">${QUALITIES[q].label}</button>`)
    .join('');
  ui.root = null;
  ui.quality = null;
  syncPicker();
}

function syncPicker() {
  for (const el of document.querySelectorAll('[data-root]')) {
    el.classList.toggle('is-picked', Number(el.dataset.root) === ui.root);
  }
  for (const el of document.querySelectorAll('[data-quality]')) {
    el.classList.toggle('is-picked', el.dataset.quality === ui.quality);
  }
  const ready = ui.root !== null && ui.quality !== null && ui.game.status === 'playing';
  $('#submit').disabled = !ready;
  $('#submit').textContent = ready
    ? `Guess ${chordName({ root: ui.root, quality: ui.quality })}`
    : 'Submit guess';
}

/* ---------- game lifecycle ---------- */

function startGame({ fresh = false } = {}) {
  const seed = ui.mode === 'daily' ? dailySeed(ui.tier) : practiceSeed(ui.tier, fresh ? Math.random() : ui.tier);
  const puzzle = makePuzzle({ tier: ui.tier, voicing: ui.voicing, seed });
  ui.game = createGame(puzzle, { mode: ui.mode });
  ui.plays = 0;
  buildPicker();

  // One daily per day: if it is already finished, replay the board read-only.
  const saved = ui.mode === 'daily' ? dailyResult(puzzle) : null;
  if (saved) {
    for (const guess of saved.guesses) ui.game = submitGuess(ui.game, guess);
    render();
    finish(ui.game, { replayAudio: false });
    $('#message').textContent = 'Today\'s chord is done — come back tomorrow, or switch to practice.';
    return;
  }

  render();
  $('#message').textContent = 'Press play to hear the chord.';
}

function currentNotes() {
  const { answer, spin, octave } = ui.game.puzzle;
  return voiceChord(answer, ui.voicing, octave, spin);
}

function playChord({ arpeggio = false } = {}) {
  piano.play(currentNotes(), { arpeggio });
  ui.plays += 1;
}

function onSubmit() {
  if (ui.root === null || ui.quality === null) return;
  const before = ui.game;
  const next = submitGuess(before, { root: ui.root, quality: ui.quality });
  ui.game = next;

  if (next.error) {
    $('#message').textContent = next.error;
    return;
  }
  if (next.guesses.length === before.guesses.length) return;

  ui.root = null;
  ui.quality = null;

  if (next.status !== 'playing') {
    recordGame(next);
    finish(next);
  } else {
    $('#message').textContent = `${MAX_GUESSES - next.guesses.length} guesses left.`;
  }
  render();
}

function finish(game, { replayAudio = true } = {}) {
  const won = game.status === 'won';
  $('#result').hidden = false;
  $('#result-title').textContent = won ? 'Nailed it 🎉' : 'Out of guesses';
  $('#result-body').textContent = won
    ? `${chordName(game.puzzle.answer)} in ${game.guesses.length} ${game.guesses.length === 1 ? 'guess' : 'guesses'}.`
    : `It was ${chordName(game.puzzle.answer)}.`;
  $('#again').hidden = false;
  $('#again').textContent = game.mode === 'daily' ? 'Try it in practice' : 'New practice chord';
  if (replayAudio) piano.play(currentNotes(), { arpeggio: true });
}

/* ---------- rendering ---------- */

function cell(state, text) {
  return `<div class="cell ${state}">${text}</div>`;
}

function render() {
  const game = ui.game;

  const rows = [];
  for (let i = 0; i < MAX_GUESSES; i += 1) {
    const played = game.guesses[i];
    if (!played) {
      rows.push(`<div class="row empty">${cell('blank', '')}${cell('blank', '')}${cell('blank', '')}</div>`);
      continue;
    }
    const { guess, score } = played;
    rows.push(`<div class="row">
      ${cell(score.root, ROOT_LABELS[guess.root])}
      ${cell(score.quality, qualityLabel(guess.quality))}
      ${cell(notesState(score.notes), `${score.notes.matched}/${score.notes.total}`)}
    </div>`);
  }
  $('#board').innerHTML = rows.join('');

  const tierLabel = TIERS[game.puzzle.tier].label;
  $('#puzzle-label').textContent = game.mode === 'daily'
    ? `Daily #${puzzleNumber()} · Chords · ${tierLabel} · ${VOICINGS[ui.voicing].label}`
    : `Practice · Chords · ${tierLabel} · ${VOICINGS[ui.voicing].label}`;

  $('#result').hidden = game.status === 'playing';
  $('#picker').classList.toggle('is-done', game.status !== 'playing');
  syncPicker();
}

/* ---------- stats dialog ---------- */

function showStats() {
  const stats = getStats(ui.mode, ui.tier);
  $('#stats-scope').textContent = `${ui.mode === 'daily' ? 'Daily' : 'Practice'} · Chords · ${TIERS[ui.tier].label}`;
  const winRate = stats.played ? Math.round((stats.won / stats.played) * 100) : 0;
  $('#stats-summary').innerHTML = [
    ['Played', stats.played],
    ['Win %', winRate],
    ['Streak', stats.streak],
    ['Best', stats.maxStreak],
  ].map(([label, value]) => `<div><strong>${value}</strong><span>${label}</span></div>`).join('');

  const max = Math.max(1, ...stats.distribution);
  $('#stats-dist').innerHTML = stats.distribution.map((count, i) => {
    const pct = Math.max(6, Math.round((count / max) * 100));
    return `<div class="dist-row"><span>${i + 1}</span>
      <div class="bar" style="width:${pct}%">${count}</div></div>`;
  }).join('');

  const weak = weakestQuality(stats);
  $('#stats-weak').textContent = weak
    ? `Weak spot: ${weak.label} — ${Math.round(weak.rate * 100)}% solved over ${weak.seen} tries.`
    : 'Play a few more rounds to see which chord qualities trip you up.';

  $('#stats').showModal();
}

/* ---------- events ---------- */

function wire() {
  $('#play').addEventListener('click', () => playChord());
  $('#arp').addEventListener('click', () => playChord({ arpeggio: true }));
  $('#ref').addEventListener('click', () => piano.playReference(60));

  for (const btn of document.querySelectorAll('.seg-btn')) {
    btn.addEventListener('click', () => {
      for (const b of document.querySelectorAll('.seg-btn')) b.classList.toggle('is-active', b === btn);
      ui.mode = btn.dataset.mode;
      startGame();
    });
  }

  $('#tier').addEventListener('change', (e) => { ui.tier = e.target.value; startGame(); });
  $('#voicing').addEventListener('change', (e) => { ui.voicing = e.target.value; ui.game.puzzle.voicing = ui.voicing; render(); });

  $('#roots').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-root]');
    if (!btn) return;
    ui.root = Number(btn.dataset.root);
    syncPicker();
  });
  $('#qualities').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-quality]');
    if (!btn) return;
    ui.quality = btn.dataset.quality;
    syncPicker();
  });

  $('#submit').addEventListener('click', onSubmit);
  $('#again').addEventListener('click', () => {
    ui.mode = 'practice';
    for (const b of document.querySelectorAll('.seg-btn')) b.classList.toggle('is-active', b.dataset.mode === 'practice');
    startGame({ fresh: true });
  });

  $('#share').addEventListener('click', async () => {
    const text = shareText(ui.game);
    const ok = await copyToClipboard(text);
    $('#share').textContent = ok ? 'Copied!' : 'Copy failed';
    setTimeout(() => { $('#share').textContent = 'Share result'; }, 1600);
  });

  $('#help-btn').addEventListener('click', () => $('#help').showModal());
  $('#stats-btn').addEventListener('click', showStats);
  $('#reset-stats').addEventListener('click', () => {
    resetStats();
    showStats();
  });

  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, select, textarea')) return;
    if (e.code === 'Space') { e.preventDefault(); playChord(); }
    if (e.key === 'Enter' && !$('#submit').disabled) onSubmit();
  });
}

fillSelects();
wire();
startGame();
if (!localStorage.getItem('harmonle.seenHelp')) {
  $('#help').showModal();
  localStorage.setItem('harmonle.seenHelp', '1');
}
