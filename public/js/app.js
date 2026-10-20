import {
  DAILY_ROUNDS,
  ENDLESS_ROUNDS,
  LIVES,
  MODES,
  PUZZLE_VERSION,
  SCORE_BUCKETS,
  STAT_BLOCK,
  buildPuzzle,
  dailySeed,
  dateKey,
  emojiGrid,
  isCorrect,
  isOver,
  livesLeft,
  modeKey,
  puzzleNumber,
  score,
  shareText,
  summarize,
} from './game.js';
import { formatStat, statsFor } from './stats.js';

const STORAGE_KEY = 'mlbhl:v1';
const REVEAL_MS = 1250;

const $ = (sel) => document.querySelector(sel);
const game = $('#game');

// ---- Persistence ------------------------------------------------------------

function loadStore() {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (s && typeof s === 'object') return { daily: {}, history: {}, endlessBest: {}, ...s };
  } catch {
    /* private mode or corrupted — start fresh */
  }
  return { daily: {}, history: {}, endlessBest: {} };
}

function saveStore() {
  // Keep a week of daily runs; history (scores only) is kept forever.
  const keys = Object.keys(store.daily).sort();
  for (const k of keys.slice(0, -7)) delete store.daily[k];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* storage full or blocked — the game still works for this session */
  }
}

const store = loadStore();

// ---- App state --------------------------------------------------------------

const state = {
  today: dateKey(),
  group: store.lastGroup ?? 'hitting',
  scope: store.lastScope ?? 'season',
  play: 'daily',
  meta: null,
  pools: new Map(),
  run: null, // { puzzle, guesses, phase: 'guess' | 'reveal' | 'over' }
  busy: false,
};

const mode = () => modeKey(state.group, state.scope);
const seasonLabel = () => (state.meta ? `${state.meta.season} Season` : 'This Season');
const modeLabel = (m = mode()) => `${MODES[m].who} · ${MODES[m].scope === 'season' ? seasonLabel() : 'All-Time'}`;
const defsFor = (m) => new Map(statsFor(MODES[m].group, MODES[m].scope).map((d) => [d.key, d]));

async function loadPool(m) {
  if (!state.pools.has(m)) {
    const res = await fetch(`data/${m}.json`);
    if (!res.ok) throw new Error(`Couldn't load ${m} (${res.status})`);
    state.pools.set(m, (await res.json()).players);
  }
  return state.pools.get(m);
}

function dailyEntry(m, day = state.today) {
  return store.daily[day]?.[m];
}

// The data job publishes each day's puzzles (data/daily/YYYY-MM-DD.json) so every player
// gets the same chain even if the player pools are refreshed partway through their day.
// If that file is missing, the puzzle is built locally from the pool with the same seed.
const publishedDays = new Map();
function loadPublished(day) {
  if (!publishedDays.has(day)) {
    publishedDays.set(
      day,
      fetch(`data/daily/${day}.json`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    );
  }
  return publishedDays.get(day);
}

// A stored or published puzzle is only usable if every stat still exists.
const usable = (puzzle, m) =>
  puzzle?.v === PUZZLE_VERSION &&
  puzzle.mode === m && puzzle.rounds?.length > 0 && puzzle.rounds.every((r) => defsFor(m).has(r.stat));

async function dailyPuzzle(m, day) {
  const published = (await loadPublished(day))?.puzzles?.[m];
  if (usable(published, m)) return published;
  return buildPuzzle(await loadPool(m), m, dailySeed(day, m), DAILY_ROUNDS);
}

let runToken = 0;
async function startRun() {
  const token = ++runToken;
  const m = mode();
  // Park the old run so nothing can be guessed on it while the new one loads.
  state.run = null;
  state.busy = false;
  let run;
  if (state.play === 'daily') {
    state.today = dateKey();
    const day = state.today;
    let entry = dailyEntry(m, day);
    if (!entry || !usable(entry.puzzle, m)) {
      const puzzle = await dailyPuzzle(m, day);
      if (token !== runToken) return;
      // Another load may have created the entry while we waited; never clobber progress.
      entry = dailyEntry(m, day);
      if (!entry || !usable(entry.puzzle, m)) {
        // Snapshot the puzzle so a later data refresh can't change a run in progress.
        entry = { puzzle, guesses: [] };
        (store.daily[day] ??= {})[m] = entry;
        saveStore();
      }
    }
    run = { puzzle: entry.puzzle, guesses: entry.guesses, phase: isOver(entry.puzzle, entry.guesses) ? 'over' : 'guess' };
  } else {
    const seed = `endless|${Date.now()}|${Math.random()}`;
    const puzzle = buildPuzzle(await loadPool(m), m, seed, ENDLESS_ROUNDS);
    run = { puzzle, guesses: [], phase: 'guess' };
  }
  if (token !== runToken) return;
  state.run = run;
  render();
}

// ---- Rendering --------------------------------------------------------------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// "Cal Ripken Jr." -> "Ripken"
const lastName = (name) => {
  const parts = name.split(' ');
  while (parts.length > 1 && /^(jr\.?|sr\.?|ii|iii|iv)$/i.test(parts.at(-1))) parts.pop();
  return parts.at(-1);
};

const livesHtml = (left, losing = false) =>
  Array.from({ length: LIVES }, (_, k) => {
    const cls = k < left ? 'on' : k === left && losing ? 'losing' : '';
    return `<i class="heart ${cls}" aria-hidden="true">♥</i>`;
  }).join('');

const headshot = (id) =>
  `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_240,q_auto:best/v1/people/${id}/headshot/67/current`;

function playerHead(p) {
  const meta = [p.pos, p.meta].filter(Boolean).map(esc).join(' · ');
  return `
    <div class="photo"><img src="${headshot(p.id)}" alt="" loading="eager" width="120" height="120" /></div>
    <h3 class="pname">${esc(p.name)}</h3>
    <p class="pmeta">${meta}</p>`;
}

function renderTabs() {
  for (const b of document.querySelectorAll('#group-tabs button')) b.setAttribute('aria-selected', b.dataset.group === state.group);
  for (const b of document.querySelectorAll('#scope-tabs button')) {
    b.setAttribute('aria-selected', b.dataset.scope === state.scope);
    const m = modeKey(state.group, b.dataset.scope);
    b.classList.toggle('done', !!(dailyEntry(m) && isOver(dailyEntry(m).puzzle, dailyEntry(m).guesses)));
  }
  for (const b of document.querySelectorAll('#play-tabs button')) b.setAttribute('aria-selected', b.dataset.play === state.play);
  $('#season-tab').textContent = state.meta ? `${state.meta.season} Season` : 'This Season';
  $('#puzzle-label').textContent =
    state.play === 'daily'
      ? `Daily #${puzzleNumber(state.today)} · ${new Date(`${state.today}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
      : 'Endless mode';
}

function render({ slide = false } = {}) {
  renderTabs();
  const { run } = state;
  if (!run) return;
  if (run.phase === 'over') return renderOver();

  const i = run.guesses.length;
  const round = run.puzzle.rounds[i];
  const def = defsFor(run.puzzle.mode).get(round.stat);
  const inBlock = run.puzzle.rounds.slice(0, i + 1).filter((r) => r.block === round.block).length;
  const next = run.puzzle.rounds[i + 1];
  const lastInBlock = next && next.block !== round.block;
  const blockLeft = run.puzzle.rounds.slice(i).filter((r) => r.block === round.block).length;
  const s = score(run.puzzle, run.guesses);
  const left = livesLeft(run.puzzle, run.guesses);
  const scope = MODES[run.puzzle.mode].scope;
  const statPhrase = `${scope === 'career' ? 'career ' : ''}${def.unit}`;

  const pips = Array.from({ length: STAT_BLOCK }, (_, k) => `<i class="${k < inBlock ? 'on' : ''}"></i>`).join('');
  const isNewStat = inBlock === 1 && i > 0;

  game.innerHTML = `
    <div class="statbar ${isNewStat ? 'new-stat' : ''}">
      <div class="stat-kicker">${isNewStat ? 'New stat' : 'Stat'}</div>
      <div class="stat-name">${esc(def.label)}</div>
      ${def.lowerBetter ? '<div class="lower-better">Lower is better<span class="lb-extra"> · the lower number takes over</span></div>' : ''}
      <div class="stat-block" title="The stat switches every ${STAT_BLOCK} guesses">
        <span class="pips">${pips}</span>
        <span>${!next ? 'Final call' : lastInBlock ? 'Stat switches after this one' : `${blockLeft} left on this stat`}</span>
      </div>
    </div>

    <div class="arena">
      <article class="card known ${slide === 'swap' ? 'slide-in-left' : ''}">
        <div class="reign" title="Stays on top until a challenger has a higher number, or for ${round.reignMax} challengers">
          <span>${round.reign === 1 ? 'On top' : `Holding · ${round.reign - 1} down`}</span>
          <span class="pips">${Array.from({ length: round.reignMax }, (_, k) => `<i class="${k < round.reign ? 'on' : ''}"></i>`).join('')}</span>
        </div>
        ${playerHead(round.a)}
        <p class="has">has</p>
        <div class="value">${formatStat(def, round.a.value)}</div>
        <p class="unit"><span class="unit-stat">${esc(statPhrase)}</span></p>
      </article>

      <div class="vs" aria-hidden="true">VS</div>

      <article class="card hidden-card ${slide ? 'slide-in-right' : ''}" id="card-b">
        ${playerHead(round.b)}
        <p class="has">has</p>
        <div class="value" id="b-value">
          <div class="choices">
            <button class="btn higher" data-guess="higher"><span aria-hidden="true">▲</span> Higher</button>
            <button class="btn lower" data-guess="lower"><span aria-hidden="true">▼</span> Lower</button>
          </div>
        </div>
        <p class="unit"><span class="unit-stat">${esc(statPhrase)}</span><span class="unit-than">than ${esc(lastName(round.a.name))}</span></p>
      </article>
    </div>

    <p class="handoff" id="handoff"></p>

    <div class="scoreline">
      <div><span class="label">Score</span><span class="num" id="score-num">${s}</span></div>
      <div><span class="label">Lives</span><span class="lives" id="lives" aria-label="${left} of ${LIVES} lives left">${livesHtml(left)}</span></div>
      <div><span class="label">${state.play === 'daily' ? 'Round' : 'Best'}</span><span class="num">${
        state.play === 'daily' ? `${i + 1}<small>/${run.puzzle.rounds.length}</small>` : (store.endlessBest[run.puzzle.mode] ?? 0)
      }</span></div>
    </div>`;

  // Warm the cache for the next player's photo.
  if (next) new Image().src = headshot(next.b.id);
}

function countUp(el, def, target, ms = 650) {
  const start = performance.now();
  const from = 0;
  const step = (t) => {
    const k = Math.min(1, (t - start) / ms);
    const eased = 1 - (1 - k) ** 3;
    el.textContent = formatStat(def, k === 1 ? target : from + (target - from) * eased);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function guess(g) {
  const { run } = state;
  if (!run || run.phase !== 'guess' || state.busy) return;
  state.busy = true;
  const i = run.guesses.length;
  const round = run.puzzle.rounds[i];
  const def = defsFor(run.puzzle.mode).get(round.stat);
  const right = isCorrect(round, g);

  run.guesses.push(g);
  run.phase = 'reveal';
  if (state.play === 'daily') {
    // Record the result now, not after the reveal animation, so a reload can't lose it.
    if (isOver(run.puzzle, run.guesses)) (store.history[run.puzzle.mode] ??= {})[state.today] = score(run.puzzle, run.guesses);
    saveStore();
  }

  const card = $('#card-b');
  const val = $('#b-value');
  val.innerHTML = `<span class="revealed"></span><span class="verdict">${right ? '✓' : '✗'}</span>`;
  card.classList.add(right ? 'correct' : 'wrong');
  countUp(val.querySelector('.revealed'), def, round.b.value);
  if (run.guesses.length < run.puzzle.rounds.length) {
    const a = esc(lastName(round.a.name));
    const b = esc(lastName(round.b.name));
    $('#handoff').innerHTML =
      round.outcome === 'takeover'
        ? `<b>${b}</b> takes over`
        : round.outcome === 'retire'
          ? `${a} has held off ${round.reignMax}. <b>${b}</b> steps in`
          : `<b>${a}</b> holds on`;
    $('#handoff').className = `handoff show ${round.outcome}`;
  }
  if (right) $('#score-num').textContent = score(run.puzzle, run.guesses);
  else {
    const left = livesLeft(run.puzzle, run.guesses);
    const lives = $('#lives');
    lives.innerHTML = livesHtml(left, true);
    lives.setAttribute('aria-label', `${left} of ${LIVES} lives left`);
  }
  if (state.play === 'endless') {
    // Saved as you go, so an abandoned or reloaded endless run still counts.
    const s = score(run.puzzle, run.guesses);
    if (s > (store.endlessBest[run.puzzle.mode] ?? 0)) {
      store.endlessBest[run.puzzle.mode] = s;
      run.newBest = true;
      saveStore();
    }
  }

  setTimeout(() => {
    state.busy = false;
    if (state.run !== run) return;
    if (isOver(run.puzzle, run.guesses)) finish(run);
    else {
      run.phase = 'guess';
      render({ slide: round.outcome === 'hold' ? 'next' : 'swap' });
    }
  }, REVEAL_MS);
}

function finish(run) {
  run.phase = 'over';
  render();
  checkNewDay();
}

function verdictLine(s, total, missed) {
  if (s >= total) return 'Perfect game. Hall of Fame stuff.';
  if (missed === 0) return 'Flawless.';
  if (s >= 25) return 'MVP-caliber run.';
  if (s >= 18) return 'All-Star numbers.';
  if (s >= 12) return 'Solid everyday starter.';
  if (s >= 6) return 'A cup of coffee in the bigs.';
  return 'Back to Triple-A.';
}

function renderOver() {
  const { run } = state;
  const m = run.puzzle.mode;
  const defs = defsFor(m);
  const s = score(run.puzzle, run.guesses);
  const total = run.puzzle.rounds.length;
  const left = livesLeft(run.puzzle, run.guesses);
  const missed = run.guesses.length - s;
  // Show the call that cost the last life (only when the run ended on a miss).
  const last = run.guesses.length - 1;
  const miss = left === 0 && !isCorrect(run.puzzle.rounds[last], run.guesses[last]) ? run.puzzle.rounds[last] : null;
  const isDaily = state.play === 'daily';

  const recap = run.puzzle.rounds
    .slice(0, run.guesses.length)
    .map((r, i) => {
      const d = defs.get(r.stat);
      const ok = isCorrect(r, run.guesses[i]);
      return `<li class="${ok ? 'ok' : 'bad'}">
        <span class="r-stat">${esc(d.abbr)}</span>
        <span class="r-a">${esc(r.a.name)} <b>${formatStat(d, r.a.value)}</b></span>
        <span class="r-vs">${r.b.value > r.a.value ? '<' : '>'}</span>
        <span class="r-b"><b>${formatStat(d, r.b.value)}</b> ${esc(r.b.name)}</span>
      </li>`;
    })
    .join('');

  const otherModes = Object.keys(MODES)
    .filter((k) => k !== m)
    .map((k) => {
      const e = dailyEntry(k);
      const done = e && isOver(e.puzzle, e.guesses);
      return `<button class="chip ${done ? 'done' : ''}" data-mode="${k}">${esc(modeLabel(k))}${
        done ? ` · ${score(e.puzzle, e.guesses)}` : ''
      }</button>`;
    })
    .join('');

  const missDef = miss && defs.get(miss.stat);
  game.innerHTML = `
    <section class="result">
      <p class="result-kicker">${isDaily ? `Daily #${puzzleNumber(state.today)} · ${esc(modeLabel(m))}` : `Endless · ${esc(modeLabel(m))}`}</p>
      <div class="big-streak"><span>${s}</span><small>${s >= total ? 'perfect' : isDaily ? `out of ${total}` : 'correct'}</small></div>
      <p class="result-lives" aria-label="${left} of ${LIVES} lives left">${livesHtml(left)}</p>
      <p class="result-line">${verdictLine(s, total, missed)}${run.newBest ? ' <b class="badge">New best!</b>' : ''}</p>
      ${
        miss
          ? `<div class="miss">
              <p class="miss-title">The one that ended it</p>
              <div class="miss-row">
                <div><img src="${headshot(miss.a.id)}" alt="" /><b>${esc(miss.a.name)}</b><span>${formatStat(missDef, miss.a.value)}</span></div>
                <div class="miss-vs">${esc(missDef.abbr)}</div>
                <div><img src="${headshot(miss.b.id)}" alt="" /><b>${esc(miss.b.name)}</b><span class="bad">${formatStat(missDef, miss.b.value)}</span></div>
              </div>
            </div>`
          : ''
      }
      <p class="grid">${emojiGrid(run.puzzle, run.guesses) || '—'}</p>
      <div class="result-actions">
        ${isDaily ? '<button class="btn primary" id="share-btn">Share result</button>' : '<button class="btn primary" id="again-btn">Play again</button>'}
        ${isDaily ? '<button class="btn ghost" id="endless-btn">Play endless</button>' : '<button class="btn ghost" id="daily-btn">Back to daily</button>'}
      </div>
      ${isDaily ? `<p class="next">Next daily in <b id="countdown"></b></p>` : ''}
      ${isDaily ? `<div class="other-modes"><p>Other dailies</p>${otherModes}</div>` : ''}
      <details class="recap"><summary>Every call (${run.guesses.length})</summary><ol>${recap}</ol></details>
    </section>`;
  if (isDaily) tickCountdown();
}

let countdownTimer = null;
function tickCountdown() {
  clearInterval(countdownTimer);
  const update = () => {
    const el = $('#countdown');
    if (!el) return clearInterval(countdownTimer);
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const sec = Math.max(0, Math.floor((midnight - now) / 1000));
    el.textContent = [Math.floor(sec / 3600), Math.floor((sec % 3600) / 60), sec % 60].map((n) => String(n).padStart(2, '0')).join(':');
    if (dateKey() !== state.today) checkNewDay();
  };
  update();
  countdownTimer = setInterval(update, 1000);
}

// ---- Stats dialog -----------------------------------------------------------

function renderStats() {
  const m = mode();
  const sum = summarize(store.history[m] ?? {}, state.today);
  const maxBar = Math.max(1, ...sum.dist);
  const todayScore = store.history[m]?.[state.today];
  $('#stats-title').textContent = modeLabel(m);
  $('#stats-body').innerHTML = `
    <div class="stat-tiles">
      <div><b>${sum.played}</b><span>Played</span></div>
      <div><b>${sum.average.toFixed(1)}</b><span>Avg score</span></div>
      <div><b>${sum.best}</b><span>Best daily</span></div>
      <div><b>${sum.dayStreak}</b><span>Day streak</span></div>
      <div><b>${store.endlessBest[m] ?? 0}</b><span>Endless best</span></div>
    </div>
    <h4>Daily score distribution</h4>
    <div class="dist">
      ${SCORE_BUCKETS.map((b, k) => {
        const mine = todayScore !== undefined && todayScore >= b.min && todayScore <= b.max;
        return `<div class="dist-row"><span>${b.label}</span><div class="bar ${mine ? 'mine' : ''}" style="--w:${(sum.dist[k] / maxBar) * 100}%"><i>${sum.dist[k]}</i></div></div>`;
      }).join('')}
    </div>
    <p class="muted small">Longest day streak: ${sum.maxDayStreak}. Stats are saved in this browser.</p>`;
}

// ---- Sharing ----------------------------------------------------------------

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2200);
}

async function share() {
  const { run } = state;
  const text = shareText({
    puzzle: run.puzzle,
    guesses: run.guesses,
    number: puzzleNumber(state.today),
    modeLabel: modeLabel(run.puzzle.mode),
    url: location.origin + location.pathname,
  });
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    try {
      await navigator.share({ text });
      return;
    } catch {
      /* cancelled — fall through to copy */
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied to clipboard');
  } catch {
    prompt('Copy your result:', text);
  }
}

// ---- Events -----------------------------------------------------------------

function setMode({ group = state.group, scope = state.scope, play = state.play }) {
  if (state.busy) return;
  const same = group === state.group && scope === state.scope && play === state.play;
  if (same && state.run) return; // re-clicking the active tab shouldn't restart a run
  Object.assign(state, { group, scope, play });
  store.lastGroup = group;
  store.lastScope = scope;
  saveStore();
  startRun().catch(showError);
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.dataset.guess) return guess(t.dataset.guess);
  if (t.dataset.group) return setMode({ group: t.dataset.group });
  if (t.dataset.scope) return setMode({ scope: t.dataset.scope });
  if (t.dataset.play) return setMode({ play: t.dataset.play });
  if (t.dataset.mode) {
    const { group, scope } = MODES[t.dataset.mode];
    return setMode({ group, scope, play: 'daily' });
  }
  switch (t.id) {
    case 'share-btn':
      return share();
    case 'again-btn':
      return startRun().catch(showError);
    case 'endless-btn':
      return setMode({ play: 'endless' });
    case 'daily-btn':
      return setMode({ play: 'daily' });
    case 'help-btn':
      return $('#help-dialog').showModal();
    case 'stats-btn':
      renderStats();
      return $('#stats-dialog').showModal();
  }
});

document.addEventListener('keydown', (e) => {
  if (document.querySelector('dialog[open]') || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 'arrowup' || k === 'w') {
    e.preventDefault();
    guess('higher');
  } else if (k === 'arrowdown' || k === 's') {
    e.preventDefault();
    guess('lower');
  } else if (k === 'enter' && state.run?.phase === 'over' && state.play === 'endless') {
    startRun().catch(showError);
  }
});

// Close dialogs by clicking the backdrop.
for (const d of document.querySelectorAll('dialog')) {
  d.addEventListener('click', (e) => {
    if (e.target === d) d.close();
  });
}

// Roll over to the new day's puzzle at midnight, but never yank away a run in progress.
function checkNewDay() {
  const now = dateKey();
  const { run } = state;
  const midRun = run && run.phase !== 'over' && run.guesses.length > 0;
  if (now !== state.today && !state.busy && !midRun) {
    state.today = now;
    if (state.play === 'daily') startRun().catch(showError);
  }
}
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && checkNewDay());

function showError(err) {
  console.error(err);
  state.run = null;
  game.innerHTML = `<div class="loading">Couldn't load the game. ${esc(err.message)}<br /><button class="btn ghost" onclick="location.reload()">Retry</button></div>`;
}

// ---- Boot -------------------------------------------------------------------

(async function boot() {
  try {
    const res = await fetch('data/meta.json');
    state.meta = await res.json();
    $('#data-date').textContent = `updated ${new Date(state.meta.generatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
  } catch {
    /* labels fall back to "This Season" */
  }
  if (!store.seenHelp) {
    store.seenHelp = true;
    saveStore();
    $('#help-dialog').showModal();
  }
  await startRun();
})().catch(showError);
