// Pure game logic (no DOM) so it can be unit tested with `node --test`.
//
// Format (modelled on HLTV-style higher/lower): two players side by side, the left one's stat
// is shown, you call whether the right one's is higher or lower. The left player is "on top"
// and stays there, facing a new challenger each guess, until a challenger has a better number
// (higher, or lower for ERA/WHIP-type stats; the challenger takes over) or they've faced their 3–4 challengers (the latest challenger
// steps in). The stat stays the same for STAT_BLOCK guesses, then switches. You have LIVES
// lives: a miss costs one and play continues; the run ends on the last miss (or when the
// chain runs out). Score = correct calls.

import { formatStat, statsFor } from './stats.js';

export const DAILY_ROUNDS = 30; // a perfect daily run
export const ENDLESS_ROUNDS = 200;
export const STAT_BLOCK = 3; // guesses per stat before it switches
export const LIVES = 3;
export const REIGN = [3, 4]; // a player on top faces between 3 and 4 challengers at most
export const PUZZLE_VERSION = 3; // bump when the chain rules change so stale saves are rebuilt
export const LAUNCH_DATE = '2026-10-20';

export const MODES = {
  'batters-season': { group: 'hitting', scope: 'season', who: 'Batters' },
  'batters-career': { group: 'hitting', scope: 'career', who: 'Batters' },
  'pitchers-season': { group: 'pitching', scope: 'season', who: 'Pitchers' },
  'pitchers-career': { group: 'pitching', scope: 'career', who: 'Pitchers' },
};

export const modeKey = (group, scope) => `${group === 'pitching' ? 'pitchers' : 'batters'}-${scope}`;

// ---- Seeded randomness ---------------------------------------------------

// xmur3 string hash -> 32-bit seed
export function hashString(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

// mulberry32 PRNG -> function returning floats in [0, 1)
export function createRng(seed) {
  let a = typeof seed === 'string' ? hashString(seed) : seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function weightedPick(items, weightOf, rng) {
  let total = 0;
  for (const it of items) total += weightOf(it);
  let r = rng() * total;
  for (const it of items) {
    r -= weightOf(it);
    if (r < 0) return it;
  }
  return items[items.length - 1];
}

// ---- Dates ----------------------------------------------------------------

export function dateKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function keyToUtc(key) {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function puzzleNumber(key) {
  return Math.round((keyToUtc(key) - keyToUtc(LAUNCH_DATE)) / 86400000) + 1;
}

export function previousDateKey(key) {
  return new Date(keyToUtc(key) - 86400000).toISOString().slice(0, 10);
}

// ---- Puzzle generation ----------------------------------------------------

/** Can `def` fairly compare these two players? (both have it, no displayed tie, minTop met) */
export function comparable(def, scope, a, b) {
  const va = a.s[def.key];
  const vb = b.s[def.key];
  if (va === undefined || vb === undefined) return false;
  if (formatStat(def, va) === formatStat(def, vb)) return false;
  const min = def.minTop?.[scope];
  return min === undefined || Math.max(va, vb) >= min;
}

const gap = (va, vb) => {
  const hi = Math.max(Math.abs(va), Math.abs(vb));
  return hi === 0 ? 0 : Math.abs(va - vb) / hi;
};

function snapshot(player, scope) {
  return { id: player.id, name: player.name, pos: player.pos, meta: scope === 'season' ? player.team : player.years };
}

/** Does value `x` beat value `y` on this stat? Ties never happen (see comparable). */
export const beats = (def, x, y) => (def.lowerBetter ? x < y : x > y);

/**
 * Build a chain of up to `length` match-ups. Round i compares rounds[i].a (on top, shown)
 * with rounds[i].b (challenger, hidden). `outcome` says what happens next:
 *   'takeover' — b had the better number (higher, or lower for ERA/WHIP-type stats) and
 *                becomes the next a
 *   'retire'   — a has faced `reignMax` challengers, so b steps in as the next a anyway
 *   'hold'     — a stays on top and faces a new challenger
 * `reign` is which challenger (1-based) a is facing, out of `reignMax`. The stat holds for
 * STAT_BLOCK rounds. Difficulty ramps up: later rounds draw several candidates and keep the
 * closest match-up.
 */
export function buildPuzzle(pool, mode, seed, length = DAILY_ROUNDS) {
  const { group, scope } = MODES[mode];
  const defs = statsFor(group, scope);
  const rng = createRng(seed);
  const remaining = pool.filter((p) => p.w > 0);
  const byWeight = (x) => x.w;
  const remove = (p) => remaining.splice(remaining.indexOf(p), 1);

  // Weighted draw of a player that `ok` accepts. Rejections are rare, so redraw first and
  // only fall back to scanning the whole pool when that keeps failing.
  const draw = (ok) => {
    for (let tries = 0; tries < 60 && remaining.length; tries++) {
      const p = weightedPick(remaining, byWeight, rng);
      if (ok(p)) return p;
    }
    const valid = remaining.filter(ok);
    return valid.length ? weightedPick(valid, byWeight, rng) : null;
  };

  const newReign = () => REIGN[0] + Math.floor(rng() * (REIGN[1] - REIGN[0] + 1));
  let a = weightedPick(remaining, byWeight, rng);
  remove(a);
  let reign = 0;
  let reignMax = newReign();
  const rounds = [];
  let prevStat = null;
  let block = 0;
  let emptyBlocks = 0; // consecutive stats that found nobody to compare against

  while (rounds.length < length && remaining.length && emptyBlocks < defs.length) {
    // New stat block: something the current player has, different from the last block.
    const options = defs.filter((d) => d.key !== prevStat && a.s[d.key] !== undefined);
    if (!options.length) break;
    const def = weightedPick(options, (d) => d.weight, rng);
    let inBlock = 0;
    while (inBlock < STAT_BLOCK && rounds.length < length) {
      const ok = (p) => comparable(def, scope, a, p);
      const candidates = 1 + Math.min(5, Math.floor(rounds.length / 5));
      let b = null;
      for (let c = 0; c < candidates; c++) {
        const p = draw(ok);
        if (p && (!b || gap(a.s[def.key], p.s[def.key]) < gap(a.s[def.key], b.s[def.key]))) b = p;
      }
      if (!b) break; // nobody left to compare on this stat; switch stats early
      remove(b);
      reign++;
      const takeover = beats(def, b.s[def.key], a.s[def.key]);
      const outcome = takeover ? 'takeover' : reign >= reignMax ? 'retire' : 'hold';
      rounds.push({
        stat: def.key,
        block,
        reign,
        reignMax,
        outcome,
        a: { ...snapshot(a, scope), value: a.s[def.key] },
        b: { ...snapshot(b, scope), value: b.s[def.key] },
      });
      if (outcome !== 'hold') {
        a = b;
        reign = 0;
        reignMax = newReign();
      }
      inBlock++;
    }
    emptyBlocks = inBlock === 0 ? emptyBlocks + 1 : 0;
    prevStat = def.key;
    block++;
  }
  return { v: PUZZLE_VERSION, mode, seed, rounds };
}

export const dailySeed = (key, mode) => `mlbhl|${key}|${mode}`;

export function isCorrect(round, guess) {
  return guess === 'higher' ? round.b.value > round.a.value : round.b.value < round.a.value;
}

/** Score = correct calls. */
export function score(puzzle, guesses) {
  return guesses.filter((g, i) => isCorrect(puzzle.rounds[i], g)).length;
}

export const misses = (puzzle, guesses) => guesses.length - score(puzzle, guesses);

export const livesLeft = (puzzle, guesses) => Math.max(0, LIVES - misses(puzzle, guesses));

export function isOver(puzzle, guesses) {
  return guesses.length >= puzzle.rounds.length || livesLeft(puzzle, guesses) === 0;
}

/** Hearts for the lives left, e.g. "❤️❤️🖤". */
export const hearts = (left) => '❤️'.repeat(left) + '🖤'.repeat(LIVES - left);

// ---- Stats & sharing --------------------------------------------------------

export const SCORE_BUCKETS = [
  { label: '0–4', min: 0, max: 4 },
  { label: '5–9', min: 5, max: 9 },
  { label: '10–14', min: 10, max: 14 },
  { label: '15–19', min: 15, max: 19 },
  { label: '20–24', min: 20, max: 24 },
  { label: '25–29', min: 25, max: DAILY_ROUNDS - 1 },
  { label: `${DAILY_ROUNDS} ★`, min: DAILY_ROUNDS, max: DAILY_ROUNDS },
];

/** history: { 'YYYY-MM-DD': score } for one mode's dailies. */
export function summarize(history, today) {
  const keys = Object.keys(history).sort();
  const scores = keys.map((k) => history[k]);
  const dist = SCORE_BUCKETS.map((b) => scores.filter((s) => s >= b.min && s <= b.max).length);

  // The day streak survives until the end of today, so count from yesterday if today
  // hasn't been played yet.
  let dayStreak = 0;
  let k = history[today] !== undefined ? today : previousDateKey(today);
  while (history[k] !== undefined) {
    dayStreak++;
    k = previousDateKey(k);
  }

  let maxDayStreak = 0;
  let run = 0;
  let prev = null;
  for (const key of keys) {
    run = prev && previousDateKey(key) === prev ? run + 1 : 1;
    maxDayStreak = Math.max(maxDayStreak, run);
    prev = key;
  }

  return {
    played: scores.length,
    average: scores.length ? scores.reduce((x, y) => x + y, 0) / scores.length : 0,
    best: scores.length ? Math.max(...scores) : 0,
    dayStreak,
    maxDayStreak,
    dist,
  };
}

/** Emoji grid grouped by stat block, e.g. "🟩🟩🟩 🟩🟩🟥". */
export function emojiGrid(puzzle, guesses) {
  const groups = [];
  guesses.forEach((g, i) => {
    const b = puzzle.rounds[i].block;
    groups[b] = (groups[b] ?? '') + (isCorrect(puzzle.rounds[i], g) ? '🟩' : '🟥');
  });
  return groups.filter(Boolean).join(' ');
}

export function shareText({ puzzle, guesses, number, modeLabel, percentile, url }) {
  const s = score(puzzle, guesses);
  const total = puzzle.rounds.length;
  const result = s >= total ? `Perfect game! ${s}/${total} 🏆` : `Score: ${s}/${total} ${hearts(livesLeft(puzzle, guesses))}`;
  const standing = percentile === null || percentile === undefined ? null : `Better than ${percentile}% of players`;
  return [`⚾ MLB Higher or Lower #${number}`, modeLabel, result, standing, emojiGrid(puzzle, guesses), url]
    .filter(Boolean)
    .join('\n');
}
