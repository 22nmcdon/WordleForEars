import { MODES, MODE_IDS, modeOf } from './modes/index.js';
import {
  createGame, submitGuess, makePuzzle, dailySeed, practiceSeed, reveal,
  settingsFor, startingGuess, hintFor, hintsLeft, takeHint, showAnswer,
} from './game.js';
import { Engine } from './audio.js';
import { getStats, recordGame, weakestKind, resetStats, ATTEMPT_BANDS } from './stats.js';
import { puzzleNumber } from './random.js';
import { engraveNote } from './engrave.js';
import { renderPicker, syncPicker, pickerState, dialValue } from './bench/picker.js';
import { makeLog } from './bench/log.js';
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
  log: null, // what has been tried this round, newest first
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
    // There is no "out of guesses" any more, so the only thing that closes the
    // button is having got there.
    const live = ui.game.status !== 'solved';
    submit.disabled = !live;
    submit.textContent = live ? 'Lock it in' : 'That is it';
    return;
  }

  const slots = mode().slots(ui.tier);
  syncPicker($('#picker'), slots, ui.guess);

  const { complete, dialling, summary } = pickerState(slots, ui.guess);
  const ready = complete && ui.game.status !== 'solved';

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
  buildLog();

  // The daily is no longer locked once it has been played. It stays the same
  // puzzle for everybody on the same day - which is the whole of what made it
  // worth having - but there is nothing left to protect it from: with the
  // guess ceiling gone there is no scarce resource, and the restore this
  // replaces re-ran the scoring over stored guesses and could print different
  // text than had been shown, because the audio it marks against loads after
  // the board does.
  render();
  // A mode with its own interface is not answered by naming anything.
  say(mode().opening ?? 'Play it, then name what you heard.');
}

/**
 * The log, sized to whatever this tool's readings are called.
 *
 * Rebuilt per round rather than cleared, because a different tool has
 * different columns - and the headings are for a screen reader only: with one
 * attempt per line and the units inside every cell, a head row would be a
 * third thing to size and would say what the cells already say.
 */
function buildLog() {
  ui.log = makeLog($('#log'), {
    write: writeSymbol,
    headings: mode().surface
      ? ['how close', 'where']
      : mode().slots(ui.tier).map((slot) => slot.heading ?? slot.id),
  });
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

  const attempt = next.guesses[next.guesses.length - 1];
  const n = ui.log.add(attempt.score);

  if (next.status === 'solved') {
    recordGame(next);
    finish(next);
  } else if (attempt.score.correct) {
    // Arrived, but with the answer already in front of you. The reading is
    // still true and still worth saying; what it is not is a solve.
    say('That is it — with the answer up.', { matched: true });
  } else {
    say(`Attempt ${n}. ${closeness(attempt.score)}`);
  }
  render();
}

/**
 * A word for how the last attempt went, now that there is no count to report.
 *
 * What was here said "two guesses left", which was the only thing the dock had
 * to say and was about the game rather than about the audio. The cells carry
 * the number; this carries the direction of travel.
 */
function closeness(score) {
  const worst = score.cells.map((cell) => cell.state);
  if (worst.every((state) => state === 'hit')) return 'Very close.';
  if (worst.includes('hit') || worst.includes('near')) return 'Getting there.';
  return 'Not there yet.';
}

/** The dock's answer: name the thing, never mark the player. */
function finish(game) {
  const solved = game.status === 'solved';
  const count = game.guesses.length;
  const answer = reveal(game.puzzle);

  if (solved) {
    say(`That is it — in ${count} ${count === 1 ? 'attempt' : 'attempts'}.`, { matched: true });
  }

  const played = $('#played');
  played.textContent = '';
  played.appendChild(document.createTextNode(solved ? 'You built ' : 'It was '));

  const symbol = document.createElement('span');
  symbol.className = 'symbol';
  writeSymbol(symbol, answer.symbol);
  played.appendChild(symbol);
  played.appendChild(document.createTextNode(answer.name ? ` — ${answer.name}.` : '.'));

  // A mode with its own interface shows the answer on it - the curve you were
  // chasing, drawn over the one you built. Asked for rather than arrived at,
  // the controls stay live: the point of being shown a target is to be able to
  // move onto it and hear what closing the gap sounds like.
  if (mode().surface) ui.surface?.reveal({ live: !solved });
}

/* ---------- the way out ---------- */

/**
 * A rung of the ladder, on request.
 *
 * Unbounded attempts removed the only thing that ever revealed an answer, so
 * something has to take its place - and two things, rather than one, because
 * being stuck and wanting to be finished are different states. A hint says
 * what kind of move it is and roughly where; it does not say the number.
 */
function onHint() {
  const line = hintFor(ui.game);
  if (!line) return;

  ui.game = takeHint(ui.game);
  const hint = $('#hint-line');
  hint.hidden = false;
  hint.textContent = line;
  render();
}

/** Show me: the answer drawn on the tool, and the controls left alive. */
function onShow() {
  if (ui.game.status !== 'playing') return;

  ui.game = showAnswer(ui.game);
  recordGame(ui.game);
  say('There it is. The controls are still live — work your way onto it.');
  finish(ui.game);
  render();
}

/* ---------- rendering ---------- */

/**
 * Everything on the page that is about the round rather than the readings.
 *
 * The readings are the log's, and the log is append-only: `render` no longer
 * draws them and never redraws them. What went with that is an entire
 * apparatus for sizing an empty board - a head row, a preview cell, a column
 * count, a chip-or-dial branch to decide how many readings a row would carry -
 * all of it in service of drawing four rows of nothing before anything had
 * been played. A log has nothing to draw until there is something to draw.
 */
function render() {
  const game = ui.game;

  const status = $('#puzzleStatus');
  status.textContent = ui.playing === 'daily'
    ? `Daily #${puzzleNumber()} · ${mode().tiers[game.puzzle.tier].label}`
    : `Practice · ${mode().tiers[game.puzzle.tier].label}`;
  status.dataset.state = game.status === 'playing' ? 'playing' : 'done';

  $('#modeMark').textContent = mode().label;
  $('#modeBlurb').textContent = mode().blurb.toLowerCase();

  const solved = game.status === 'solved';
  $('#picker').classList.toggle('done', solved);
  $('#dock').classList.toggle('done', solved);
  $('#again').hidden = !solved && game.status !== 'shown';
  $('#again').textContent = ui.playing === 'daily' ? 'Try it in practice' : 'Another one';
  if (game.status === 'playing') $('#played').textContent = '';

  // Both ways out are there from the first attempt and stay there. Hiding them
  // until somebody has struggled enough would be the ceiling again, wearing a
  // different hat.
  const left = hintsLeft(game);
  const hint = $('#hint');
  hint.hidden = left === 0 || solved;
  hint.textContent = game.hinted === 0 ? 'Hint' : `Another hint (${left} left)`;
  $('#hint-line').hidden = game.hinted === 0;

  const show = $('#show');
  show.hidden = game.status !== 'playing';

  syncAnswer();
}

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

  // Six bands, always all six. What was here sliced the rows to the tier's
  // guess ceiling, which no longer exists - and converging in two rather than
  // nine is the clearest signal of improvement this app has, so the bands stay
  // fixed and comparable rather than shifting with the tool.
  const counts = ATTEMPT_BANDS.map((band) => stats.attempts[band.id] ?? 0);
  const max = Math.max(1, ...counts);
  $('#stats-dist').innerHTML = ATTEMPT_BANDS.map((band, i) => {
    const width = Math.max(7, Math.round((counts[i] / max) * 100));
    return `<div class="dist-row"><span>${band.label}</span>`
      + `<div class="bar" style="width:${width}%">${counts[i]}</div></div>`;
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
       + `. ${tier.label}: ${tier.blurb.toLowerCase()}.`],
  ];

  entries.push(['Try it as many times as you like.',
    'There is no limit and nothing to run out of - the whole of the value is '
    + 'moving something, hearing what it did to the reading, and moving it '
    + 'again. Hint says what kind of move it is; Show me draws the answer on '
    + 'the tool and leaves the controls live, so you can hear your way onto it.']);

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

  $('#hint').addEventListener('click', onHint);
  $('#show').addEventListener('click', onShow);

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
  try { return localStorage.getItem('headroom.seenHelp') === '1'; } catch { return false; }
}

if (!seenHelp()) {
  fillHelp();
  $('#help').showModal();
  try { localStorage.setItem('headroom.seenHelp', '1'); } catch { /* private window */ }
}
