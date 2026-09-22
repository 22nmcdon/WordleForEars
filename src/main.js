import { MODES, MODE_IDS, modeOf } from './modes/index.js';
import {
  createGame, submitGuess, makePuzzle, dailySeed, practiceSeed, reveal, guessesFor,
  settingsFor, startingGuess,
} from './game.js';
import { Engine } from './audio.js';
import { getStats, recordGame, dailyResult, weakestKind, resetStats } from './stats.js';
import { shareText, copyToClipboard } from './share.js';
import { puzzleNumber } from './random.js';
import { engraveNote } from './engrave.js';
import { renderPicker, syncPicker, pickerState, dialValue } from './bench/picker.js';
import { notesFor } from './notes/index.js';

const $ = (sel) => document.querySelector(sel);

/** A reading only ever needs its accidentals: "3.15k", "B♭", "−4.5 dB". */
const writeSymbol = (target, text) => engraveNote(target, text);

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
  surface: null, // a mode that brings its own interface, mounted
  mode: 'eq',
  tier: 'easy',
  chosen: {}, // settings, per mode, so switching back finds them as you left them
  guess: {},
  game: null,
  plays: 0,
};

const mode = () => modeOf(ui.mode);
const settings = () => settingsFor(ui.mode, ui.chosen[ui.mode] ?? {});

/* ---------- setup row ---------- */

/** The tools, on the page rather than behind a click. */
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

function fillSettings() {
  const chosen = settings();
  $('#settings').innerHTML = (mode().settings ?? []).map((setting) => `
    <label class="field">
      <span class="field-label">${setting.label}</span>
      <select data-setting="${setting.id}">${setting.options
        .map((option) => `<option value="${option.id}"`
          + `${option.id === chosen[setting.id] ? ' selected' : ''}>${option.label}</option>`)
        .join('')}</select>
    </label>`).join('');
}

/* ---------- the picker ---------- */

function buildPicker() {
  const picker = $('#picker');

  // Chips are cleared between guesses; controls are not. A producer works from
  // where they got to last time, not from the middle of the range again.
  const dialled = startingGuess(ui.mode, ui.tier);
  ui.guess = { ...dialled, ...Object.fromEntries(
    Object.entries(ui.guess).filter(([id]) => id in dialled)) };

  renderPicker(picker, mode().slots(ui.tier), ui.guess, { write: writeSymbol });

  syncAnswer();
}

/**
 * Repaint the controls, and the button under them.
 *
 * The picker draws itself; what is left here is the part that is about the
 * round rather than about the controls - whether there is anything left to
 * submit, and what the button should say.
 */
function syncAnswer() {
  const submit = $('#submit');

  if (mode().surface) {
    const live = ui.game.status === 'playing';
    submit.disabled = !live;
    submit.textContent = live ? 'Lock it in' : 'Submitted';
    return;
  }

  const slots = mode().slots(ui.tier);
  syncPicker($('#picker'), slots, ui.guess);

  const { complete, dialling, summary } = pickerState(slots, ui.guess);
  const ready = complete && ui.game.status === 'playing';

  submit.disabled = !ready;
  submit.textContent = ready
    ? `${dialling ? 'Lock in' : 'Guess'} ${summary}`
    : slots.length > 1 ? 'Pick one of each' : 'Submit guess';
}

/* ---------- the clue ---------- */

/** A mode with its own interface gets the sheet; everything else is hidden. */
function mountSurface() {
  ui.surface?.destroy();
  ui.surface = null;

  const surface = $('#surface');
  const own = mode().surface;

  surface.hidden = !own;
  $('#clue').hidden = !!own;
  $('#picker').hidden = !!own;
  // Not the advice. It is a line about the tool, and the tools with a surface
  // are exactly the ones that have any - so this used to hide all of it, every
  // time, in the same synchronous pass that buildClue had just written it.
  // Five paragraphs, set and never seen by anybody.

  if (!own) {
    surface.textContent = '';
    return;
  }

  ui.surface = mode().mount(surface, {
    engine,
    puzzle: ui.game.puzzle,
    tier: ui.tier,
    settings: settings(),
    onChange: () => syncAnswer(),
  });
}

function buildClue() {
  const row = $('#clue');
  row.textContent = '';

  for (const clue of mode().clues(ui.tier, settings())) {
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
  buildNotes();
}

/**
 * What the tool is for, as opposed to how to work it.
 *
 * Closed until asked for. The help dialog says which button does what; this
 * says what a pre-delay is, why even harmonics sound like an octave, and what
 * summing to mono actually costs - the half of this project that was written
 * down years' worth of commits ago and addressed only to whoever was next to
 * change the code.
 */
function buildNotes() {
  const notes = notesFor(ui.mode);
  const panel = $('#notes');

  panel.hidden = !notes;
  if (!notes) return;

  panel.open = false;
  $('#notesOpen').textContent = `Notes on ${notes.title.toLowerCase()}`;
  $('#notesBody').innerHTML = notes.sections
    .map((section) => `<section><h3>${section.heading}</h3>${section.body
      .split('\n\n').map((line) => `<p>${line}</p>`).join('')}</section>`)
    .join('');
}

function playClue(id) {
  const clues = mode().clues(ui.tier, settings());
  const clue = clues.find((c) => c.id === id) ?? clues[0];

  engine.ensure();
  engine.stop();
  mode().play(engine, {
    puzzle: ui.game.puzzle,
    clue: clue.id,
    settings: settings(),
    tier: ui.tier,
    // What the controls are on right now, so "play yours" is yours.
    guess: { ...ui.guess },
  });

  ui.plays += 1;
  $('#plays').textContent = ui.plays === 1 ? 'played once' : `played ${ui.plays} times`;
}

/* ---------- lifecycle ---------- */

function startGame({ fresh = false } = {}) {
  const chosen = settings();
  const seed = ui.playing === 'daily'
    ? dailySeed(ui.mode, ui.tier, chosen)
    : practiceSeed(ui.mode, ui.tier, fresh ? Math.random() : ui.tier);

  const puzzle = makePuzzle({ mode: ui.mode, tier: ui.tier, settings: chosen, seed });
  ui.game = createGame(puzzle, { mode: ui.playing });
  ui.plays = 0;

  engine.stop();
  buildClue();
  buildPicker();
  mountSurface();

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
  // A mode with its own interface is not answered by naming anything.
  say(mode().opening ?? 'Play it, then name what you heard.');
}

function say(text, { matched = false } = {}) {
  const verdict = $('#verdict');
  verdict.textContent = text;
  verdict.classList.toggle('matches', matched);
}

function onSubmit() {
  const slots = mode().slots(ui.tier, settings());
  const own = mode().surface;
  if (!own && !slots.every((slot) => ui.guess[slot.id] !== undefined)) return;

  const before = ui.game;
  const next = submitGuess(before, own ? ui.surface.guess() : { ...ui.guess });
  ui.game = next;

  if (next.error) {
    say(next.error);
    return;
  }
  if (next.guesses.length === before.guesses.length) return;

  // Chips start again; controls stay where they were put, because the next
  // attempt is an adjustment of this one.
  ui.guess = Object.fromEntries(
    Object.entries(ui.guess).filter(([id]) =>
      mode().slots(ui.tier).find((slot) => slot.id === id)?.kind === 'range'));

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
  symbol.className = 'symbol';
  writeSymbol(symbol, answer.symbol);
  played.appendChild(symbol);
  played.appendChild(document.createTextNode(answer.name ? ` — ${answer.name}.` : '.'));

  // A mode with its own interface shows the answer on it - the curve you were
  // chasing, drawn over the one you built.
  if (mode().surface) {
    ui.surface?.reveal();
    return;
  }

  if (replay) playClue(mode().clues(ui.tier, settings())[0].id);
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
    : previewCells(slots, mode());

  const head = document.createElement('div');
  head.className = 'board-head';
  head.style.gridTemplateColumns = columns(sample);
  for (const [i, cell] of sample.entries()) {
    const span = document.createElement('span');
    span.textContent = headings(slots, mode())[i] ?? '';
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
      .map((cell, n) => `${headings(slots, mode())[n] ?? 'reading'}: ${cell.text}, ${cell.state}`)
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

  syncAnswer();
}

/**
 * What a row will look like before one has been played.
 *
 * A control's cell is already a reading - "0.4 oct low" - so a mode made of
 * controls returns one cell per control. Chips are not: the cell repeats the
 * pick, so those modes add a reading of their own beside it. Getting this
 * wrong shows up as a column on the empty board that no guess ever fills.
 */
const dialling = (slots) => slots.some((slot) => slot.kind === 'range');

const extraReading = (slots) => !dialling(slots) || slots.some((slot) => slot.extraReading);

function previewCells(slots, spec) {
  // A mode with its own interface has no slots to preview: it reports how
  // close the thing you built came, and where it came apart.
  if (spec.surface) return [{ state: 'blank', text: '' }, { state: 'blank', text: '' }];

  const cells = slots.map((slot) => ({ state: 'blank', text: '', narrow: slot.narrowReading }));
  if (extraReading(slots)) cells.push({ state: 'blank', text: '', narrow: true });
  return cells;
}

const headings = (slots, spec) => (spec?.surface
  ? ['how close', 'where']
  : slots.map((slot) => slot.heading ?? slot.id).concat(extraReading(slots) ? ['close'] : []));

const columns = (cells) => cells.map((cell) => (cell.narrow ? '0.45fr' : '1fr')).join(' ');

function drawCell(cell) {
  const node = document.createElement('div');
  node.className = `cell ${cell.state}`;

  const value = document.createElement('span');
  value.className = 'value';
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

  const clues = mode().clues(ui.tier, settings());
  const slots = mode().slots(ui.tier, settings());
  const tier = mode().tiers[ui.tier];

  // A mode that brings its own interface explains its own interface: there is
  // nothing useful the shell can say about a plugin it has never seen.
  const entries = mode().help ? mode().help.map((entry) => [...entry]) : mode().surface ? [
    ['Play the loop, then work the plugin.',
     'Yours and the other side swap instantly, so you can flip while it runs.'],
    ['You are judged on what comes out, not on the controls.',
     'Two different ways of arriving at the same result are the same answer.'],
  ] : [
    ['Press ' + clues[0].label.toLowerCase() + ', then name what you heard.',
     clues.length > 1
       ? `${clues.slice(1).map((c) => c.label).join(' and ')} ${clues.length > 2 ? 'are' : 'is'} there `
         + 'to compare against. Play it as many times as you like.'
       : 'Play it as many times as you like.'],
    [slots.some((slot) => slot.kind === 'range')
      ? (slots.length > 1 ? `${slots.length} controls to dial.` : 'One control to dial.')
      : (slots.length > 1 ? 'Two things to name.' : 'One thing to name.'),
     slots.map((slot) => slot.label.replace(/\?$/, '')).join(', and ')
       + `. ${tier.guesses} ${tier.guesses === 1 ? 'guess' : 'guesses'} on ${tier.label}.`],
  ];

  for (const spec of mode().settings ?? []) {
    entries.push([`${spec.label}: ${spec.options.map((o) => o.label).join(', ')}.`,
      spec.id === 'exercise'
        ? `${spec.options.length} different exercises, not ${spec.options.length} views of one `
          + '- each has its own daily.'
        : 'Up in the setup row, and it changes what you are listening to rather than how hard it is.']);
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
    fillSettings();
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
    fillSettings();
    startGame();
    document.querySelector(`[data-train="${next}"]`).focus();
  });
  $('#tier').addEventListener('change', (e) => { ui.tier = e.target.value; startGame(); });
  $('#settings').addEventListener('change', (e) => {
    const select = e.target.closest('[data-setting]');
    if (!select) return;

    ui.chosen[ui.mode] = { ...ui.chosen[ui.mode], [select.dataset.setting]: select.value };
    // A setting is part of what the clue sounds like - and an exercise is part
    // of what the answer is - so the round starts again rather than changing
    // under a board that was scored against the old one.
    fillSettings();
    startGame();
  });

  $('#picker').addEventListener('click', (e) => {
    const chosen = e.target.closest('[data-option]');
    if (!chosen) return;
    ui.guess[chosen.dataset.slot] = chosen.dataset.option;
    syncAnswer();
  });

  $('#picker').addEventListener('input', (e) => {
    const dial = e.target.closest('[data-dial]');
    if (!dial) return;

    const slot = mode().slots(ui.tier).find((s) => s.id === dial.dataset.dial);
    ui.guess[slot.id] = dialValue(slot, dial.value);
    syncAnswer();
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
      // Space is the transport wherever a musician meets one.
      if (mode().surface) ui.surface?.toggle?.();
      else playClue(mode().clues(ui.tier, settings())[0].id);
    }
    if (e.key === 'Enter' && !$('#submit').disabled) onSubmit();
  });
}

fillModes();
fillTiers();
fillSettings();
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
