import {
  QUALITIES, TIERS, VOICINGS, ROOT_LABELS,
  voiceChord, chordName, qualityLabel, rootLabel,
} from './theory.js';
import {
  MAX_GUESSES, notesState,
  createGame, submitGuess, makePuzzle, dailySeed, practiceSeed,
} from './game.js';
import { PianoEngine } from './audio.js';
import { getStats, recordGame, dailyResult, weakestQuality, resetStats } from './stats.js';
import { shareText, copyToClipboard } from './share.js';
import { puzzleNumber } from './random.js';
import { engraveSymbol, engraveNote } from './engrave.js';

const $ = (sel) => document.querySelector(sel);

/* The webfonts, promoted only when this page is being served. `rel` is set with
   the href and never before: a stylesheet with no href counts as one still on
   its way, and stalls every script after it. */
(function loadWebfonts() {
  const link = document.getElementById('webfonts');
  if (link && location.protocol.startsWith('http')) {
    link.href = link.dataset.href;
    link.rel = 'stylesheet';
  }
}());

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

/** A quality with no symbol of its own is still written on a chart. */
const symbolOf = (quality) => QUALITIES[quality].symbol || 'maj';

/* ---------- setup ---------- */

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

/** The roots, as one octave of keys - a root is a key, not a word in a list. */
function buildKeyboard() {
  const keyboard = $('#roots');
  keyboard.textContent = '';

  const whites = [];
  const blacks = [];
  for (let pc = 0; pc < 12; pc += 1) {
    (ROOT_LABELS[pc].includes('/') ? blacks : whites).push(pc);
  }

  const whiteWidth = 100 / whites.length;
  const key = (pc, black) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `key ${black ? 'black' : 'white'}`;
    button.dataset.root = String(pc);
    button.setAttribute('aria-pressed', 'false');
    button.setAttribute('aria-label', ROOT_LABELS[pc].replace('/', ' or '));
    button.title = ROOT_LABELS[pc];

    const name = document.createElement('span');
    name.className = 'key-name';
    // A black key has room for one spelling; the chart writes both.
    engraveNote(name, black ? ROOT_LABELS[pc].split('/')[0] : ROOT_LABELS[pc]);
    button.appendChild(name);
    return button;
  };

  whites.forEach((pc) => keyboard.appendChild(key(pc, false)));
  blacks.forEach((pc) => {
    const button = key(pc, true);
    const whitesBelow = whites.filter((white) => white < pc).length;
    button.style.width = `${whiteWidth * 0.6}%`;
    button.style.left = `calc(${whitesBelow * whiteWidth}% - ${whiteWidth * 0.3}%)`;
    keyboard.appendChild(button);
  });
}

/** The qualities, written the way a player writes them: the symbol, then its name. */
function buildQualities() {
  const list = $('#qualities');
  list.textContent = '';

  for (const quality of TIERS[ui.tier].qualities) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'quality';
    button.dataset.quality = quality;
    button.setAttribute('aria-pressed', 'false');
    button.setAttribute('aria-label', qualityLabel(quality));

    const symbol = document.createElement('span');
    symbol.className = 'symbol';
    engraveSymbol(symbol, symbolOf(quality));
    button.appendChild(symbol);

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = qualityLabel(quality);
    button.appendChild(name);

    list.appendChild(button);
  }
}

function syncPicker() {
  for (const el of document.querySelectorAll('[data-root]')) {
    el.setAttribute('aria-pressed', Number(el.dataset.root) === ui.root ? 'true' : 'false');
  }
  for (const el of document.querySelectorAll('[data-quality]')) {
    el.setAttribute('aria-pressed', el.dataset.quality === ui.quality ? 'true' : 'false');
  }

  const ready = ui.root !== null && ui.quality !== null && ui.game.status === 'playing';
  $('#submit').disabled = !ready;
  $('#submit').textContent = ready
    ? `Guess ${chordName({ root: ui.root, quality: ui.quality })}`
    : 'Submit guess';
}

/* ---------- lifecycle ---------- */

function startGame({ fresh = false } = {}) {
  const seed = ui.mode === 'daily'
    ? dailySeed(ui.tier)
    : practiceSeed(ui.tier, fresh ? Math.random() : ui.tier);
  const puzzle = makePuzzle({ tier: ui.tier, voicing: ui.voicing, seed });

  ui.game = createGame(puzzle, { mode: ui.mode });
  ui.plays = 0;
  $('#plays').textContent = '';
  ui.root = null;
  ui.quality = null;
  buildQualities();

  // One daily per day: if it is already finished, the board comes back read-only.
  const saved = ui.mode === 'daily' ? dailyResult(puzzle) : null;
  if (saved) {
    for (const guess of saved.guesses) ui.game = submitGuess(ui.game, guess);
    render();
    finish(ui.game, { replayAudio: false });
    say("Today's chord is done — come back tomorrow, or switch to practice.");
    return;
  }

  render();
  say('Play the chord, then name it.');
}

function say(text, { matched = false } = {}) {
  const verdict = $('#verdict');
  verdict.textContent = text;
  verdict.classList.toggle('matches', matched);
}

function currentNotes() {
  const { answer, spin, octave } = ui.game.puzzle;
  return voiceChord(answer, ui.voicing, octave, spin);
}

function playChord({ arpeggio = false } = {}) {
  piano.play(currentNotes(), { arpeggio });
  ui.plays += 1;
  $('#plays').textContent = ui.plays === 1 ? 'played once' : `played ${ui.plays} times`;
}

function onSubmit() {
  if (ui.root === null || ui.quality === null) return;

  const before = ui.game;
  const next = submitGuess(before, { root: ui.root, quality: ui.quality });
  ui.game = next;

  if (next.error) {
    say(next.error);
    return;
  }
  if (next.guesses.length === before.guesses.length) return;

  ui.root = null;
  ui.quality = null;

  if (next.status !== 'playing') {
    recordGame(next);
    finish(next);
  } else {
    const left = MAX_GUESSES - next.guesses.length;
    say(`${left} ${left === 1 ? 'guess' : 'guesses'} left.`);
  }
  render();
}

/** The dock's answer: name the chord, never mark the player. */
function finish(game, { replayAudio = true } = {}) {
  const won = game.status === 'won';
  const count = game.guesses.length;

  say(won ? `That is it — in ${count} ${count === 1 ? 'guess' : 'guesses'}.` : 'Six guesses up.',
      { matched: won });

  const played = $('#played');
  played.textContent = '';
  played.appendChild(document.createTextNode(won ? 'You heard ' : 'It was '));
  const symbol = document.createElement('span');
  symbol.className = 'symbol';
  engraveNote(symbol, rootLabel(game.puzzle.answer.root));
  symbol.appendChild(document.createTextNode(' '));
  const quality = document.createElement('span');
  engraveSymbol(quality, symbolOf(game.puzzle.answer.quality));
  symbol.appendChild(quality);
  played.appendChild(symbol);
  played.appendChild(document.createTextNode(` — ${qualityLabel(game.puzzle.answer.quality).toLowerCase()}.`));

  $('#share').hidden = false;
  $('#again').hidden = false;
  $('#again').textContent = game.mode === 'daily' ? 'Try it in practice' : 'New chord';

  if (replayAudio) piano.play(currentNotes(), { arpeggio: true });
}

/* ---------- rendering ---------- */

function cell(state, fill) {
  const node = document.createElement('div');
  node.className = `cell ${state}`;
  if (fill) fill(node);
  return node;
}

function render() {
  const game = ui.game;
  const board = $('#board');
  board.textContent = '';

  for (let i = 0; i < MAX_GUESSES; i += 1) {
    const row = document.createElement('div');
    row.className = 'row';

    const played = game.guesses[i];
    if (!played) {
      row.classList.add('empty');
      row.append(cell('blank'), cell('blank'), cell('blank'));
      board.appendChild(row);
      continue;
    }

    const { guess, score } = played;
    row.setAttribute('aria-label',
      `${chordName(guess)}: root ${score.root}, quality ${score.quality}, `
      + `${score.notes.matched} of ${score.notes.total} notes`);

    row.append(
      cell(score.root, (node) => engraveNote(node, rootLabel(guess.root))),
      cell(score.quality, (node) => {
        const symbol = document.createElement('span');
        symbol.className = 'symbol';
        engraveSymbol(symbol, symbolOf(guess.quality));
        node.appendChild(symbol);
      }),
      cell(notesState(score.notes), (node) => {
        const tally = document.createElement('span');
        tally.className = 'tally';
        tally.textContent = `${score.notes.matched}/${score.notes.total}`;
        node.appendChild(tally);
      }),
    );
    board.appendChild(row);
  }

  const status = $('#puzzleStatus');
  status.textContent = game.mode === 'daily'
    ? `Daily #${puzzleNumber()} · ${TIERS[game.puzzle.tier].label}`
    : `Practice · ${TIERS[game.puzzle.tier].label}`;
  status.dataset.state = game.status === 'playing' ? 'playing' : 'done';

  const over = game.status !== 'playing';
  $('#picker').classList.toggle('done', over);
  $('#dock').classList.toggle('done', over);
  $('#share').hidden = !over;
  $('#again').hidden = !over;
  if (!over) $('#played').textContent = '';

  syncPicker();
}

/* ---------- stats ---------- */

function showStats() {
  const stats = getStats(ui.mode, ui.tier);
  $('#stats-scope').textContent =
    `${ui.mode === 'daily' ? 'Daily' : 'Practice'} · ${TIERS[ui.tier].label} · ${TIERS[ui.tier].blurb}`;

  const solved = stats.played ? Math.round((stats.won / stats.played) * 100) : 0;
  $('#stats-summary').innerHTML = [
    ['Played', stats.played],
    ['Solved %', solved],
    ['Streak', stats.streak],
    ['Best', stats.maxStreak],
  ].map(([label, value]) => `<div><strong>${value}</strong><span>${label}</span></div>`).join('');

  const max = Math.max(1, ...stats.distribution);
  $('#stats-dist').innerHTML = stats.distribution.map((count, i) => {
    const width = Math.max(7, Math.round((count / max) * 100));
    return `<div class="dist-row"><span>${i + 1}</span>`
      + `<div class="bar" style="width:${width}%">${count}</div></div>`;
  }).join('');

  const weak = weakestQuality(stats);
  $('#stats-weak').textContent = weak
    ? `${weak.label} is the one to work on — solved ${Math.round(weak.rate * 100)}% of ${weak.seen}.`
    : 'A few more rounds and this will say which quality is worth working on.';

  $('#stats').showModal();
}

/* ---------- events ---------- */

function setMode(mode) {
  ui.mode = mode;
  for (const button of document.querySelectorAll('[data-mode]')) {
    button.setAttribute('aria-checked', button.dataset.mode === mode ? 'true' : 'false');
  }
  // One class, and the palette follows it: practice is the same page in a
  // cooler light. Nothing below here knows the page changed colour.
  document.body.classList.toggle('practice', mode === 'practice');
}

function wire() {
  $('#play').addEventListener('click', () => playChord());
  $('#arp').addEventListener('click', () => playChord({ arpeggio: true }));
  $('#ref').addEventListener('click', () => piano.playReference(60));

  for (const button of document.querySelectorAll('[data-mode]')) {
    button.addEventListener('click', () => {
      if (ui.mode === button.dataset.mode) return;
      setMode(button.dataset.mode);
      startGame();
    });
  }

  $('#tier').addEventListener('change', (e) => { ui.tier = e.target.value; startGame(); });
  $('#voicing').addEventListener('change', (e) => {
    ui.voicing = e.target.value;
    ui.game.puzzle.voicing = ui.voicing;
  });

  $('#roots').addEventListener('click', (e) => {
    const key = e.target.closest('[data-root]');
    if (!key) return;
    ui.root = Number(key.dataset.root);
    syncPicker();
  });
  $('#qualities').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-quality]');
    if (!chip) return;
    ui.quality = chip.dataset.quality;
    syncPicker();
  });

  $('#submit').addEventListener('click', onSubmit);

  $('#again').addEventListener('click', () => {
    setMode('practice');
    startGame({ fresh: true });
  });

  $('#share').addEventListener('click', async () => {
    const ok = await copyToClipboard(shareText(ui.game));
    $('#share').textContent = ok ? 'Copied' : 'Select and copy';
    setTimeout(() => { $('#share').textContent = 'Copy result'; }, 1600);
  });

  $('#help-btn').addEventListener('click', () => $('#help').showModal());
  $('#help-close').addEventListener('click', () => $('#help').close());
  $('#help-ok').addEventListener('click', () => $('#help').close());
  $('#stats-btn').addEventListener('click', showStats);
  $('#stats-close').addEventListener('click', () => $('#stats').close());
  $('#stats-ok').addEventListener('click', () => $('#stats').close());
  $('#reset-stats').addEventListener('click', () => { resetStats(); showStats(); });

  for (const dialog of document.querySelectorAll('dialog')) {
    // A click on the backdrop lands on the dialog element itself.
    dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  }

  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, select, textarea') || document.querySelector('dialog[open]')) return;
    if (e.code === 'Space') { e.preventDefault(); playChord(); }
    if (e.key === 'Enter' && !$('#submit').disabled) onSubmit();
  });
}

fillSelects();
buildKeyboard();
wire();
startGame();

if (!localStorage.getItem('harmonle.seenHelp')) {
  $('#help').showModal();
  try { localStorage.setItem('harmonle.seenHelp', '1'); } catch { /* private window */ }
}
