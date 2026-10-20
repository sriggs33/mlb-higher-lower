import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DAILY_ROUNDS,
  ENDLESS_ROUNDS,
  MODES,
  REIGN,
  STAT_BLOCK,
  buildPuzzle,
  comparable,
  createRng,
  dailySeed,
  emojiGrid,
  isCorrect,
  isOver,
  livesLeft,
  puzzleNumber,
  score,
  shareText,
  summarize,
} from '../public/js/game.js';
import { formatStat, parseStat, statsFor } from '../public/js/stats.js';

const pool = (mode) => JSON.parse(readFileSync(new URL(`../public/data/${mode}.json`, import.meta.url), 'utf8')).players;

test('rng is deterministic per seed', () => {
  const a = createRng('x');
  const b = createRng('x');
  const c = createRng('y');
  const seqA = [a(), a(), a()];
  assert.deepEqual(seqA, [b(), b(), b()]);
  assert.notDeepEqual(seqA, [c(), c(), c()]);
});

test('puzzle numbers count from launch day', () => {
  assert.equal(puzzleNumber('2026-10-20'), 1);
  assert.equal(puzzleNumber('2026-10-21'), 2);
  assert.equal(puzzleNumber('2027-10-20'), 366);
});

for (const mode of Object.keys(MODES)) {
  test(`${mode}: daily puzzles are valid and stable`, () => {
    const players = pool(mode);
    const { group, scope } = MODES[mode];
    const defs = new Map(statsFor(group, scope).map((d) => [d.key, d]));
    const byId = new Map(players.map((p) => [p.id, p]));

    for (let day = 0; day < 60; day++) {
      const key = new Date(Date.UTC(2026, 9, 20 + day)).toISOString().slice(0, 10);
      const p = buildPuzzle(players, mode, dailySeed(key, mode));
      assert.equal(p.rounds.length, DAILY_ROUNDS);
      const ids = [p.rounds[0].a.id, ...p.rounds.map((r) => r.b.id)];
      assert.equal(new Set(ids).size, ids.length, 'no repeated players in a run');

      const blockSizes = new Map();
      p.rounds.forEach((r, i) => {
        const def = defs.get(r.stat);
        assert.ok(def, `stat ${r.stat} belongs to ${mode}`);
        assert.ok(comparable(def, scope, byId.get(r.a.id), byId.get(r.b.id)), 'fair comparison');
        assert.notEqual(formatStat(def, r.a.value), formatStat(def, r.b.value), 'no displayed ties');
        blockSizes.set(r.block, (blockSizes.get(r.block) ?? 0) + 1);
        assert.ok(r.reignMax >= REIGN[0] && r.reignMax <= REIGN[1], 'reign length is 3–4');
        assert.ok(r.reign >= 1 && r.reign <= r.reignMax, 'reign within limit');
        const better = def.lowerBetter ? r.b.value < r.a.value : r.b.value > r.a.value;
        const expected = better ? 'takeover' : r.reign === r.reignMax ? 'retire' : 'hold';
        assert.equal(r.outcome, expected, 'outcome follows the higher number / reign limit');
        if (i > 0) {
          const prev = p.rounds[i - 1];
          if (prev.outcome === 'hold') {
            assert.equal(r.a.id, prev.a.id, 'player on top stays');
            assert.equal(r.reign, prev.reign + 1);
            assert.equal(r.reignMax, prev.reignMax);
          } else {
            assert.equal(r.a.id, prev.b.id, 'challenger slides over');
            assert.equal(r.reign, 1, 'new reign starts');
          }
          if (r.block === prev.block) assert.equal(r.stat, prev.stat, 'stat holds within a block');
          else assert.notEqual(r.stat, prev.stat, 'stat switches between blocks');
        }
      });
      for (const n of blockSizes.values()) assert.ok(n <= STAT_BLOCK);
    }

    const key = '2026-10-20';
    // Over many days, players really do hold the spot (and runs end at the limit).
    const all = Array.from({ length: 30 }, (_, d) => buildPuzzle(players, mode, `hold-${d}`).rounds).flat();
    assert.ok(all.some((r) => r.outcome === 'hold'));
    assert.ok(all.some((r) => r.outcome === 'retire'));
    assert.ok(all.some((r) => r.outcome === 'takeover'));
    assert.deepEqual(buildPuzzle(players, mode, dailySeed(key, mode)), buildPuzzle(players, mode, dailySeed(key, mode)));
  });

  test(`${mode}: endless runs are long`, () => {
    const p = buildPuzzle(pool(mode), mode, 'endless-1', ENDLESS_ROUNDS);
    assert.ok(p.rounds.length >= 150, `got ${p.rounds.length}`);
  });
}

test('star players show up more than fringe players', () => {
  const players = pool('batters-career');
  const counts = new Map();
  for (let i = 0; i < 200; i++) {
    const p = buildPuzzle(players, 'batters-career', `bias-${i}`, 10);
    for (const id of [p.rounds[0].a.id, ...p.rounds.map((r) => r.b.id)]) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const top = players.slice(0, 50).reduce((n, p) => n + (counts.get(p.id) ?? 0), 0);
  const bottom = players.slice(-50).reduce((n, p) => n + (counts.get(p.id) ?? 0), 0);
  assert.ok(top > bottom * 5, `top ${top} vs bottom ${bottom}`);
});

test('later rounds are closer match-ups than early ones', () => {
  const players = pool('batters-season');
  let early = 0;
  let late = 0;
  for (let i = 0; i < 100; i++) {
    const p = buildPuzzle(players, 'batters-season', `ramp-${i}`);
    const g = (r) => Math.abs(r.a.value - r.b.value) / Math.max(r.a.value, r.b.value);
    early += p.rounds.slice(0, 5).reduce((n, r) => n + g(r), 0);
    late += p.rounds.slice(25).reduce((n, r) => n + g(r), 0);
  }
  assert.ok(late < early * 0.7, `early ${early.toFixed(2)} late ${late.toFixed(2)}`);
});

test('three lives: misses cost a life, the third ends the run', () => {
  // Every round's right answer is "higher".
  const puzzle = {
    rounds: Array.from({ length: 6 }, (_, i) => ({ stat: 'hr', block: Math.floor(i / 3), a: { value: i }, b: { value: i + 1 } })),
  };
  const H = 'higher';
  const L = 'lower';
  assert.ok(isCorrect(puzzle.rounds[0], H));
  assert.ok(!isCorrect(puzzle.rounds[0], L));

  assert.equal(score(puzzle, [H, L, H]), 2);
  assert.equal(livesLeft(puzzle, [H, L, H]), 2);
  assert.ok(!isOver(puzzle, [L]), 'one miss keeps you alive');
  assert.ok(!isOver(puzzle, [L, L]), 'two misses keep you alive');
  assert.ok(isOver(puzzle, [L, L, L]), 'third miss ends it');
  assert.equal(livesLeft(puzzle, [L, L, L]), 0);
  assert.ok(isOver(puzzle, [H, H, H, H, H, L]), 'running out of rounds ends it');
  assert.equal(score(puzzle, [H, H, H, H, H, L]), 5);

  assert.equal(emojiGrid(puzzle, [H, L, H, H]), '🟩🟥🟩 🟩');

  const text = shareText({ puzzle, guesses: [H, L, H, L, L], number: 3, modeLabel: 'Batters · All-Time' });
  assert.match(text, /#3/);
  assert.match(text, /Score: 2\/6/);
  assert.match(text, /🖤🖤🖤/);
  assert.match(shareText({ puzzle, guesses: [H, H, H, H, H, H], number: 1 }), /Perfect/);
  assert.match(shareText({ puzzle, guesses: [H, L, H, H, H, H], number: 1 }), /Score: 5\/6 ❤️❤️🖤/);
});

test('summary and day streaks', () => {
  const history = { '2026-10-18': 5, '2026-10-19': 7, '2026-10-20': 30, '2026-10-15': 2 };
  const s = summarize(history, '2026-10-20');
  assert.equal(s.played, 4);
  assert.equal(s.dayStreak, 3);
  assert.equal(s.maxDayStreak, 3);
  assert.equal(s.best, 30);
  assert.equal(s.dist.at(-1), 1);
  assert.equal(s.dist.reduce((a, b) => a + b, 0), 4);
  // Not played yet today: day streak still alive from yesterday.
  assert.equal(summarize({ '2026-10-19': 4 }, '2026-10-20').dayStreak, 1);
  assert.equal(summarize({ '2026-10-17': 4 }, '2026-10-20').dayStreak, 0);
});

test('stat parsing and formatting', () => {
  const ip = { fmt: 'ip' };
  assert.equal(formatStat(ip, parseStat(ip, '200.2')), '200.2');
  assert.equal(formatStat(ip, parseStat(ip, '5914.1')), '5,914.1');
  assert.equal(formatStat({ fmt: 'rate' }, 0.316), '.316');
  assert.equal(formatStat({ fmt: 'rate' }, 1.033), '1.033');
  assert.equal(formatStat({ fmt: 'dec2' }, 2.6), '2.60');
  assert.equal(parseStat({ fmt: 'dec2' }, '-.--'), null);
});

test('tiny or degenerate pools end the chain instead of hanging', () => {
  const tiny = [
    { id: 1, name: 'A', w: 1, s: { hr: 10 } },
    { id: 2, name: 'B', w: 1, s: { hr: 10 } },
    { id: 3, name: 'C', w: 1, s: { rbi: 5 } },
  ];
  const p = buildPuzzle(tiny, 'batters-season', 'tiny');
  assert.ok(p.rounds.length < 3);
  const pair = [
    { id: 1, name: 'A', w: 1, s: { hr: 10, rbi: 50 } },
    { id: 2, name: 'B', w: 1, s: { hr: 20, rbi: 60 } },
  ];
  assert.equal(buildPuzzle(pair, 'batters-season', 'pair').rounds.length, 1);
});
