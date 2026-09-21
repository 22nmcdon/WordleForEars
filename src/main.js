import { MODES, MODE_IDS, modeOf } from './modes/index.js';
import {
  createGame, submitGuess, makePuzzle, dailySeed, practiceSeed, reveal, guessesFor,
} from './game.js';
import { Engine } from './audio.js';
import { getStats, recordGame, dailyResult, weakestKind, resetStats } from './stats.js';
import { shareText, copyToClipboard } from './share.js';
import { puzzleNumber } from './random.js';
import { engraveSymbol, engraveNote } from './engrave.js';

const $ = (sel) => document.querySelector(sel);

/** Chord symbols are engraved; everything else only needs its accidentals. */
const writeSymbol = (target, text) =>
  (mode().handLettered ? engraveSymbol(target, text) : engraveNote(target, text));

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

const engine = new Engine();

const ui = {
  playing: 'daily', // 'daily' | 'practice'
  mode: 'chords',
  tier: 'easy',
  setting: {}, // per mode, so switching back finds it as you left it
  guess: {},
  game: null,
  plays: 0,
};

const mode = () => modeOf(ui.mode);
const settingOf = (id) => {
  const spec = MODES[id].setting;
  return spec ? (ui.setting[id] ?? spec.options[0].id) : null;
};

/* ---------- setup row ---------- */

/** The seven, on the page rather than behind a click. */
function fillModes() {
  $('#modes').innerHTML = MODE_IDS
    .map((id) => `<button class="mode-pill" type="button" role="radio" data-train="${id}"`
      + ` aria-checked="${id === ui.mode}" title="${MODES[id].blurb}">${MODES[id].label}</button>`)
    .join('');
}

function syncModes() {
  for (const pill of document.querySelectorAll('[data-train]')) {
    pill.setAttribute('aria-checked', pill.dataset.train === ui.mode ? 'true' : 'false');
  }
}

function fillTiers() {
  const spec = mode();
  $('#tier').innerHTML = Object.entries(spec.tiers)
    .map(([id, tier]) => `<option value="${id}">${tier.label} — ${tier.blurb}</option>`)
    .join('');
  if (!spec.tiers[ui.tier]) ui.tier = Object.keys(spec.tiers)[0];
  $('#tier').value = ui.tier;
}

function fillSetting() {
  const spec = mode().setting;
  $('#settingField').hidden = !spec;
  if (!spec) return;

  $('#settingLabel').textContent = spec.label;
  $('#setting').innerHTML = spec.options
    .map((option) => `<option value="${option.id}">${option.label}</option>`)
    .join('');
  $('#setting').value = settingOf(ui.mode);
}

/* ---------- the picker ---------- */

/** One chip: what a player would write, over what it is called. */
function chip(slotId, option) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'option';
  button.dataset.slot = slotId;
  button.dataset.option = option.id;
  button.setAttribute('aria-pressed', 'false');
  button.setAttribute('aria-label', option.name ? `${option.symbol}, ${option.name}` : option.symbol);

  const symbol = document.createElement('span');
  // Chord symbols are the one thing set in the hand face, and the one thing
  // whose figures ride above the line. Everything else - a frequency, an
  // interval, a clave - is set in the serif, on the line, with its accidentals
  // still borrowed from the serif.
  symbol.className = mode().handLettered ? 'symbol hand' : 'symbol';
  writeSymbol(symbol, option.symbol);
  button.appendChild(symbol);

  if (option.name) {
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = option.name;
    button.appendChild(name);
  }
  return button;
}

function buildPicker() {
  const picker = $('#picker');
  picker.textContent = '';
  ui.guess = {};

  for (const slot of mode().slots(ui.tier)) {
    const group = document.createElement('div');
    group.className = 'picker-group';

    const label = document.createElement('p');
    label.className = 'eyebrow';
    label.textContent = slot.label;
    group.appendChild(label);

    const options = document.createElement('div');
    options.className = 'options';
    options.setAttribute('role', 'group');
    options.setAttribute('aria-label', slot.label);
    for (const option of slot.options) options.appendChild(chip(slot.id, option));

    group.appendChild(options);
    picker.appendChild(group);
  }
}

function syncPicker() {
  for (const button of document.querySelectorAll('[data-option]')) {
    const picked = ui.guess[button.dataset.slot] === button.dataset.option;
    button.setAttribute('aria-pressed', picked ? 'true' : 'false');
  }

  const slots = mode().slots(ui.tier);
  const complete = slots.every((slot) => ui.guess[slot.id] !== undefined);
  const ready = complete && ui.game.status === 'playing';

  $('#submit').disabled = !ready;
  $('#submit').textContent = ready
    ? `Guess ${slots.map((slot) => label(slot, ui.guess[slot.id])).join(' · ')}`
    : slots.length > 1 ? 'Pick one of each' : 'Submit guess';
}

const label = (slot, optionId) => {
  const option = slot.options.find((o) => o.id === optionId);
  return option ? option.symbol : '';
};

/* ---------- the clue ---------- */

function buildClue() {
  const row = $('#clue');
  row.textContent = '';

  for (const clue of mode().clues(ui.tier, settingOf(ui.mode))) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = clue.primary ? 'play-btn' : 'link-btn';
    button.dataset.clue = clue.id;
    button.textContent = clue.label;
    row.appendChild(button);
  }

  const plays = document.createElement('span');
  plays.className = 'plays';
  plays.id = 'plays';
  row.appendChild(plays);

  const advice = mode().advice;
  $('#advice').hidden = !advice;
  $('#advice').textContent = advice ?? '';
  $('#lede').textContent = mode().lede;
}

function playClue(id) {
  const clues = mode().clues(ui.tier, settingOf(ui.mode));
  const clue = clues.find((c) => c.id === id) ?? clues[0];

  engine.ensure();
  engine.stop();
  mode().play(engine, ui.game.puzzle, clue.id, settingOf(ui.mode), ui.tier);

  ui.plays += 1;
  $('#plays').textContent = ui.plays === 1 ? 'played once' : `played ${ui.plays} times`;
}

/* ---------- lifecycle ---------- */

function startGame({ fresh = false } = {}) {
  const setting = settingOf(ui.mode);
  const seed = ui.playing === 'daily'
    ? dailySeed(ui.mode, ui.tier)
    : practiceSeed(ui.mode, ui.tier, fresh ? Math.random() : ui.tier);

  const puzzle = makePuzzle({ mode: ui.mode, tier: ui.tier, setting, seed });
  ui.game = createGame(puzzle, { mode: ui.playing });
  ui.plays = 0;

  engine.stop();
  buildClue();
  buildPicker();

  // One daily per mode per day: a finished one comes back read-only.
  const saved = ui.playing === 'daily' ? dailyResult(puzzle) : null;
  if (saved) {
    for (const guess of saved.guesses) ui.game = submitGuess(ui.game, guess);
    render();
    finish(ui.game, { replay: false });
    say("Today's is done — come back tomorrow, or switch to practice.");
    return;
  }

  render();
  say(`Play it, then name what you heard.`);
}

function say(text, { matched = false } = {}) {
  const verdict = $('#verdict');
  verdict.textContent = text;
  verdict.classList.toggle('matches', matched);
}

function onSubmit() {
  const slots = mode().slots(ui.tier);
  if (!slots.every((slot) => ui.guess[slot.id] !== undefined)) return;

  const before = ui.game;
  const next = submitGuess(before, { ...ui.guess });
  ui.game = next;

  if (next.error) {
    say(next.error);
    return;
  }
  if (next.guesses.length === before.guesses.length) return;

  ui.guess = {};

  if (next.status !== 'playing') {
    recordGame(next);
    finish(next);
  } else {
    const left = next.allowed - next.guesses.length;
    say(`${left} ${left === 1 ? 'guess' : 'guesses'} left.`);
  }
  render();
}

/** The dock's answer: name the thing, never mark the player. */
function finish(game, { replay = true } = {}) {
  const won = game.status === 'won';
  const count = game.guesses.length;
  const answer = reveal(game.puzzle);

  say(won ? `That is it — in ${count} ${count === 1 ? 'guess' : 'guesses'}.`
          : `${game.allowed} guesses up.`, { matched: won });

  const played = $('#played');
  played.textContent = '';
  played.appendChild(document.createTextNode(won ? 'You heard ' : 'It was '));

  const symbol = document.createElement('span');
  symbol.className = mode().handLettered ? 'symbol hand' : 'symbol';
  writeSymbol(symbol, answer.symbol);
  played.appendChild(symbol);
  played.appendChild(document.createTextNode(answer.name ? ` — ${answer.name}.` : '.'));

  if (replay) playClue(mode().clues(ui.tier, settingOf(ui.mode))[0].id);
}

/* ---------- rendering ---------- */

function render() {
  const game = ui.game;
  const slots = mode().slots(ui.tier);
  const board = $('#board');
  board.textContent = '';

  // The head names the columns the mode actually reads, so a board with two
  // readings and a board with three are both legible without a legend.
  const sample = game.guesses[0]
    ? game.guesses[0].score.cells
    : previewCells(slots);

  const head = document.createElement('div');
  head.className = 'board-head';
  head.style.gridTemplateColumns = columns(sample);
  for (const [i, cell] of sample.entries()) {
    const span = document.createElement('span');
    span.textContent = headings(slots)[i] ?? '';
    head.appendChild(span);
  }
  board.appendChild(head);

  for (let i = 0; i < game.allowed; i += 1) {
    const row = document.createElement('div');
    row.className = 'row';
    row.style.gridTemplateColumns = columns(sample);

    const played = game.guesses[i];
    if (!played) {
      row.classList.add('empty');
      for (const cell of sample) row.appendChild(blankCell(cell));
      board.appendChild(row);
      continue;
    }

    row.setAttribute('aria-label', played.score.cells
      .map((cell, n) => `${headings(slots)[n] ?? 'reading'}: ${cell.text}, ${cell.state}`)
      .join('; '));

    for (const cell of played.score.cells) row.appendChild(drawCell(cell));
    board.appendChild(row);
  }

  const status = $('#puzzleStatus');
  status.textContent = ui.playing === 'daily'
    ? `Daily #${puzzleNumber()} · ${mode().tiers[game.puzzle.tier].label}`
    : `Practice · ${mode().tiers[game.puzzle.tier].label}`;
  status.dataset.state = game.status === 'playing' ? 'playing' : 'done';

  $('#modeMark').textContent = mode().label;
  $('#modeBlurb').textContent = mode().blurb.toLowerCase();

  const over = game.status !== 'playing';
  $('#picker').classList.toggle('done', over);
  $('#dock').classList.toggle('done', over);
  $('#share').hidden = !over;
  $('#again').hidden = !over;
  $('#again').textContent = ui.playing === 'daily' ? 'Try it in practice' : 'Another one';
  if (!over) $('#played').textContent = '';

  syncPicker();
}

/** What a row will look like before one has been played. */
function previewCells(slots) {
  const cells = slots.map(() => ({ state: 'blank', text: '' }));
  // Every mode adds one reading of its own beyond what was picked.
  cells.push({ state: 'blank', text: '', narrow: true });
  return cells;
}

const headings = (slots) => slots.map((slot) => slot.heading ?? slot.id).concat(['close']);

const columns = (cells) => cells.map((cell) => (cell.narrow ? '0.45fr' : '1fr')).join(' ');

function drawCell(cell) {
  const node = document.createElement('div');
  node.className = `cell ${cell.state}`;

  const value = document.createElement('span');
  value.className = cell.symbol && mode().handLettered ? 'value hand' : 'value';
  writeSymbol(value, cell.text);
  node.appendChild(value);
  return node;
}

const blankCell = (cell) => {
  const node = document.createElement('div');
  node.className = 'cell blank';
  if (cell.narrow) node.classList.add('narrow');
  return node;
};

/* ---------- stats ---------- */

function showStats() {
  const stats = getStats(ui.playing, ui.mode, ui.tier);
  const tier = mode().tiers[ui.tier];

  $('#statsMode').textContent = mode().label;
  $('#stats-scope').textContent =
    `${ui.playing === 'daily' ? 'Daily' : 'Practice'} · ${tier.label} · ${tier.blurb}`;

  const solved = stats.played ? Math.round((stats.won / stats.played) * 100) : 0;
  $('#stats-summary').innerHTML = [
    ['Played', stats.played],
    ['Solved %', solved],
    ['Streak', stats.streak],
    ['Best', stats.maxStreak],
  ].map(([text, value]) => `<div><strong>${value}</strong><span>${text}</span></div>`).join('');

  // Only the rows this tier can reach: a bucket makes room for the longest
  // tier anywhere in the suite, and empty rows under it say nothing.
  const rows = stats.distribution.slice(0, guessesFor(ui.mode, ui.tier));
  const max = Math.max(1, ...rows);
  $('#stats-dist').innerHTML = rows.map((count, i) => {
    const width = Math.max(7, Math.round((count / max) * 100));
    return `<div class="dist-row"><span>${i + 1}</span>`
      + `<div class="bar" style="width:${width}%">${count}</div></div>`;
  }).join('');

  const weak = weakestKind(stats);
  $('#stats-weak').textContent = weak
    ? `${weak.label} is the one to work on — solved ${Math.round(weak.rate * 100)}% of ${weak.seen}.`
    : 'A few more rounds and this will say which one is worth working on.';

  $('#stats').showModal();
}

/* ---------- the cheat sheet ---------- */

function fillHelp() {
  $('#helpMode').textContent = mode().label;
  $('#helpLede').textContent = mode().lede;

  const clues = mode().clues(ui.tier, settingOf(ui.mode));
  const slots = mode().slots(ui.tier);
  const tier = mode().tiers[ui.tier];
  const spec = mode().setting;

  const entries = [
    ['Press ' + clues[0].label.toLowerCase() + ', then name what you heard.',
     clues.length > 1
       ? `${clues.slice(1).map((c) => c.label).join(' and ')} ${clues.length > 2 ? 'are' : 'is'} there `
         + 'to compare against. Play it as many times as you like.'
       : 'Play it as many times as you like.'],
    [slots.length > 1 ? 'Two things to name.' : 'One thing to name.',
     slots.map((slot) => slot.label.replace(/\?$/, '')).join(', and ')
       + `. ${tier.guesses} ${tier.guesses === 1 ? 'guess' : 'guesses'} on ${tier.label}.`],
  ];

  if (spec) {
    entries.push([`${spec.label}: ${spec.options.map((o) => o.label).join(', ')}.`,
      'Up in the setup row, and it changes what you are listening to rather than how hard it is.']);
  }

  $('#helpList').innerHTML = entries
    .map(([lead, detail]) => `<li><b>${lead}</b><span>${detail}</span></li>`)
    .join('');
}

/* ---------- events ---------- */

function setPlaying(playing) {
  ui.playing = playing;
  for (const button of document.querySelectorAll('[data-mode]')) {
    button.setAttribute('aria-checked', button.dataset.mode === playing ? 'true' : 'false');
  }
  // One class, and the palette follows it: practice is the same page in a
  // cooler light. Nothing below here knows the page changed colour.
  document.body.classList.toggle('practice', playing === 'practice');
}

function wire() {
  $('#clue').addEventListener('click', (e) => {
    const button = e.target.closest('[data-clue]');
    if (button) playClue(button.dataset.clue);
  });

  for (const button of document.querySelectorAll('[data-mode]')) {
    button.addEventListener('click', () => {
      if (ui.playing === button.dataset.mode) return;
      setPlaying(button.dataset.mode);
      startGame();
    });
  }

  $('#modes').addEventListener('click', (e) => {
    const pill = e.target.closest('[data-train]');
    if (!pill || pill.dataset.train === ui.mode) return;

    ui.mode = pill.dataset.train;
    syncModes();
    fillTiers();
    fillSetting();
    startGame();
  });

  // Arrow keys walk the strip, the way a radio group is expected to.
  $('#modes').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();

    const step = e.key === 'ArrowRight' ? 1 : -1;
    const next = MODE_IDS[(MODE_IDS.indexOf(ui.mode) + step + MODE_IDS.length) % MODE_IDS.length];
    ui.mode = next;
    syncModes();
    fillTiers();
    fillSetting();
    startGame();
    document.querySelector(`[data-train="${next}"]`).focus();
  });
  $('#tier').addEventListener('change', (e) => { ui.tier = e.target.value; startGame(); });
  $('#setting').addEventListener('change', (e) => {
    ui.setting[ui.mode] = e.target.value;
    // The setting is part of what the clue sounds like, so the round restarts
    // rather than changing under a board that was scored against the old one.
    startGame();
  });

  $('#picker').addEventListener('click', (e) => {
    const chosen = e.target.closest('[data-option]');
    if (!chosen) return;
    ui.guess[chosen.dataset.slot] = chosen.dataset.option;
    syncPicker();
  });

  $('#submit').addEventListener('click', onSubmit);

  $('#again').addEventListener('click', () => {
    setPlaying('practice');
    startGame({ fresh: true });
  });

  $('#share').addEventListener('click', async () => {
    const ok = await copyToClipboard(shareText(ui.game));
    $('#share').textContent = ok ? 'Copied' : 'Select and copy';
    setTimeout(() => { $('#share').textContent = 'Copy result'; }, 1600);
  });

  $('#help-btn').addEventListener('click', () => { fillHelp(); $('#help').showModal(); });
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
    if (e.code === 'Space') {
      e.preventDefault();
      playClue(mode().clues(ui.tier, settingOf(ui.mode))[0].id);
    }
    if (e.key === 'Enter' && !$('#submit').disabled) onSubmit();
  });
}

fillModes();
fillTiers();
fillSetting();
wire();
startGame();

// A first visit gets the rules. Failing open is the right way round: a private
// window forgets and shows them again, where guessing "seen" would hide the one
// thing a first visitor needs.
function seenHelp() {
  try { return localStorage.getItem('harmonle.seenHelp') === '1'; } catch { return false; }
}

if (!seenHelp()) {
  fillHelp();
  $('#help').showModal();
  try { localStorage.setItem('harmonle.seenHelp', '1'); } catch { /* private window */ }
}
