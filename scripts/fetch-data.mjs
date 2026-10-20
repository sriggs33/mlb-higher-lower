// Builds the player pools the game draws from, using the public MLB Stats API.
//
//   node scripts/fetch-data.mjs            -> writes public/data/*.json
//   node scripts/fetch-data.mjs --season 2025
//
// Four pools are produced: batters/pitchers × current season/all-time. Each player gets a
// "weight" (how likely they are to be drawn) from a fame score that blends playing time
// (PA for hitters, innings/saves/Ks for pitchers), All-Star selections and the Hall of Fame,
// so everyday players and household names show up far more often than fringe guys.

import { access, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseStat, statsFor } from '../public/js/stats.js';
import { DAILY_ROUNDS, buildPuzzle, dailySeed } from '../public/js/game.js';

const API = 'https://statsapi.mlb.com/api/v1';
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data');

const CONFIG = {
  season: {
    minPA: 250, // hitters need this many plate appearances to make the season pool
    minIP: 40, // pitchers need this many innings (low enough to include closers)
  },
  career: {
    batters: 450, // top N hitters by career PA...
    pitchersByIP: 300, // ...top N pitchers by career innings
    pitchersBySaves: 60, // ...top N relievers by career saves
    pitchersByK: 150, // ...top N by career strikeouts
    // ...plus any star with this many All-Star selections and enough playing time
    // (catches shorter careers and active players like Judge or Ohtani).
    starAllStars: 4,
    starMinPA: 3000,
    starMinIP: 800,
    minDebutYear: 1901, // skip 19th-century players
  },
  // Fame score mix (each part is 0..1). Weight = (fame / pool max) ^ exponent.
  fame: {
    season: { playing: 0.6, allStarThisYear: 0.25, allStarCareer: 0.15 },
    career: { playing: 0.45, allStar: 0.35, hallOfFame: 0.2 },
    allStarCap: { season: 8, career: 12 },
  },
  weightExponent: 1.5,
  minWeight: 0.03,
};

async function getJson(path, attempt = 1) {
  const res = await fetch(`${API}${path}`, { headers: { 'User-Agent': 'mlb-higher-lower/1.0' } });
  if (!res.ok) {
    if (attempt < 4) {
      await new Promise((r) => setTimeout(r, 1000 * attempt));
      return getJson(path, attempt + 1);
    }
    throw new Error(`${res.status} ${res.statusText} for ${path}`);
  }
  return res.json();
}

async function statSplits({ type, group, season, sortStat, limit }) {
  const params = new URLSearchParams({
    stats: type,
    group,
    playerPool: 'ALL',
    sportId: '1',
    sortStat,
    order: 'desc',
    limit: String(limit),
  });
  if (season) params.set('season', String(season));
  const data = await getJson(`/stats?${params}`);
  return data.stats?.[0]?.splits ?? [];
}

async function people(ids) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 150) {
    const chunk = ids.slice(i, i + 150);
    const data = await getJson(`/people?personIds=${chunk.join(',')}`);
    for (const p of data.people ?? []) out.set(p.id, p);
  }
  return out;
}

async function teamAbbreviations(season) {
  const data = await getJson(`/teams?sportId=1&season=${season}`);
  return new Map((data.teams ?? []).map((t) => [t.id, t.abbreviation]));
}

// All-Star selections (distinct seasons per player, up to `throughSeason`) and Hall of Famers.
async function honors() {
  const [al, nl, hof] = await Promise.all(
    ['ALAS', 'NLAS', 'MLBHOF'].map((id) => getJson(`/awards/${id}/recipients`).then((d) => d.awards ?? [])),
  );
  const allStarSeasons = new Map();
  for (const a of [...al, ...nl]) {
    const id = a.player?.id;
    if (!id) continue;
    if (!allStarSeasons.has(id)) allStarSeasons.set(id, new Set());
    allStarSeasons.get(id).add(Number(a.season));
  }
  return {
    allStars: (id, throughSeason = Infinity) => [...(allStarSeasons.get(id) ?? [])].filter((s) => s <= throughSeason).length,
    allStarIn: (id, season) => allStarSeasons.get(id)?.has(season) ?? false,
    hallOfFame: new Set(hof.map((a) => a.player?.id).filter(Boolean)),
  };
}

// Season to use as "current": this year once enough hitters have qualified, otherwise last year.
async function resolveSeason(requested) {
  if (requested) return requested;
  const year = new Date().getUTCFullYear();
  const splits = await statSplits({ type: 'season', group: 'hitting', season: year, sortStat: 'plateAppearances', limit: 200 });
  const enough = splits.filter((s) => s.stat.plateAppearances >= CONFIG.season.minPA).length >= 120;
  return enough ? year : year - 1;
}

function extractStats(defs, stat, { debutYear, group }) {
  const out = {};
  for (const def of defs) {
    let v = parseStat(def, stat[def.api]);
    // Batter strikeouts weren't reliably recorded before 1913.
    if (group === 'hitting' && def.key === 'so' && debutYear && debutYear < 1913) v = null;
    if (v !== null) out[def.key] = Math.round(v * 10000) / 10000;
  }
  return out;
}

// Turns each player's `playing` (raw playing time) and `fameBonus` (0..1, already mixed)
// into a final draw weight.
function applyWeights(players, playingShare) {
  const maxPlaying = Math.max(...players.map((p) => p.playing));
  for (const p of players) p.fame = playingShare * (p.playing / maxPlaying) ** 2 + p.fameBonus;
  const maxFame = Math.max(...players.map((p) => p.fame));
  for (const p of players) {
    const w = Math.max(CONFIG.minWeight, (p.fame / maxFame) ** CONFIG.weightExponent);
    p.w = Math.round(w * 1000) / 1000;
    delete p.playing;
    delete p.fameBonus;
    delete p.fame;
  }
  return players.sort((a, b) => b.w - a.w || a.id - b.id);
}

const ipOf = (stat) => parseStat({ fmt: 'ip' }, stat.inningsPitched) ?? 0;

const pitcherRole = (stat) => ((stat.gamesStarted ?? 0) * 2 >= (stat.gamesPitched ?? 0) ? 'SP' : 'RP');

const year = (d) => (d ? Number(d.slice(0, 4)) : null);

function careerSpan(person) {
  const from = year(person?.mlbDebutDate);
  const to = person?.active ? null : year(person?.lastPlayedDate);
  if (!from) return '';
  if (!to) return `${from}–present`;
  return from === to ? `${from}` : `${from}–${to}`;
}

async function buildSeasonPool(group, season, teams, hon) {
  const isHitting = group === 'hitting';
  const mix = CONFIG.fame.season;
  const cap = CONFIG.fame.allStarCap.season;
  const splits = await statSplits({
    type: 'season',
    group,
    season,
    sortStat: isHitting ? 'plateAppearances' : 'inningsPitched',
    limit: 700,
  });
  const defs = statsFor(group, 'season');
  const seen = new Set();
  const players = [];
  for (const s of splits) {
    const id = s.player.id;
    if (seen.has(id)) continue;
    const ip = ipOf(s.stat);
    if (isHitting ? s.stat.plateAppearances < CONFIG.season.minPA : ip < CONFIG.season.minIP) continue;
    seen.add(id);
    players.push({
      id,
      name: s.player.fullName,
      pos: isHitting ? (s.position?.abbreviation ?? '') : pitcherRole(s.stat),
      team: s.numTeams > 1 ? `${s.numTeams} Teams` : (teams.get(s.team?.id) ?? ''),
      s: extractStats(defs, s.stat, { group }),
      playing: isHitting ? s.stat.plateAppearances : ip + 2 * (s.stat.saves ?? 0),
      fameBonus:
        (hon.allStarIn(id, season) ? mix.allStarThisYear : 0) +
        (mix.allStarCareer * Math.min(cap, hon.allStars(id, season))) / cap,
    });
  }
  return applyWeights(players, mix.playing);
}

async function buildCareerPool(group, hon) {
  const isHitting = group === 'hitting';
  const c = CONFIG.career;
  const mix = CONFIG.fame.career;
  const cap = CONFIG.fame.allStarCap.career;

  // Each list: [splits sorted by a stat, how many to take from the top, extra filter].
  // The first list is fetched deep so the All-Star rule can reach past the top N.
  const isStar = (s) =>
    hon.allStars(s.player.id) >= c.starAllStars &&
    (isHitting ? s.stat.plateAppearances >= c.starMinPA : ipOf(s.stat) >= c.starMinIP);
  const lists = isHitting
    ? [
        [await statSplits({ type: 'career', group, sortStat: 'plateAppearances', limit: 2500 }), c.batters],
      ]
    : [
        [await statSplits({ type: 'career', group, sortStat: 'inningsPitched', limit: 2500 }), c.pitchersByIP],
        [await statSplits({ type: 'career', group, sortStat: 'saves', limit: c.pitchersBySaves * 2 }), c.pitchersBySaves],
        [await statSplits({ type: 'career', group, sortStat: 'strikeOuts', limit: c.pitchersByK * 2 }), c.pitchersByK],
      ];

  const candidates = (list, take) => list.filter((s, i) => i < take * 1.6 || isStar(s));
  const allIds = [...new Set(lists.flatMap(([l, take]) => candidates(l, take).map((s) => s.player.id)))];
  const bio = await people(allIds);
  const debutOf = (s) => year(bio.get(s.player.id)?.mlbDebutDate);

  const chosen = new Map();
  const add = (s) => chosen.has(s.player.id) || chosen.set(s.player.id, s);
  for (const [list, take] of lists) {
    let taken = 0;
    for (const s of list) {
      if (taken >= take) break;
      if ((debutOf(s) ?? 0) < c.minDebutYear) continue;
      taken++;
      add(s);
    }
  }
  for (const s of lists[0][0]) if (isStar(s) && (debutOf(s) ?? 0) >= c.minDebutYear) add(s);

  const defs = statsFor(group, 'career');
  const players = [...chosen.values()].map((s) => {
    const person = bio.get(s.player.id);
    const id = s.player.id;
    return {
      id,
      name: s.player.fullName,
      pos: isHitting ? (person?.primaryPosition?.abbreviation ?? s.position?.abbreviation ?? '') : pitcherRole(s.stat),
      years: careerSpan(person),
      s: extractStats(defs, s.stat, { debutYear: debutOf(s), group }),
      // Saves count extra so elite closers (who throw few innings) still show up, and strikeouts
      // tilt things toward modern aces over dead-ball innings eaters.
      playing: isHitting
        ? s.stat.plateAppearances
        : ipOf(s.stat) + 3 * (s.stat.saves ?? 0) + 0.5 * (s.stat.strikeOuts ?? 0),
      fameBonus: (mix.allStar * Math.min(cap, hon.allStars(id))) / cap + (hon.hallOfFame.has(id) ? mix.hallOfFame : 0),
    };
  });
  return applyWeights(players, mix.playing);
}

async function main() {
  const argIdx = process.argv.indexOf('--season');
  const season = await resolveSeason(argIdx > -1 ? Number(process.argv[argIdx + 1]) : null);
  console.log(`Current season: ${season}`);
  const [teams, hon] = await Promise.all([teamAbbreviations(season), honors()]);

  const pools = {
    'batters-season': await buildSeasonPool('hitting', season, teams, hon),
    'pitchers-season': await buildSeasonPool('pitching', season, teams, hon),
    'batters-career': await buildCareerPool('hitting', hon),
    'pitchers-career': await buildCareerPool('pitching', hon),
  };

  await mkdir(OUT_DIR, { recursive: true });
  const generatedAt = new Date().toISOString();
  for (const [name, players] of Object.entries(pools)) {
    const [who, scope] = name.split('-');
    const body = {
      group: who === 'batters' ? 'hitting' : 'pitching',
      scope,
      season: scope === 'season' ? season : null,
      generatedAt,
      players,
    };
    await writeFile(join(OUT_DIR, `${name}.json`), JSON.stringify(body));
    console.log(`${name}: ${players.length} players`);
  }
  await writeFile(join(OUT_DIR, 'meta.json'), JSON.stringify({ season, generatedAt }, null, 2));
  await publishDailies(pools, generatedAt);
}

// Freeze each day's puzzles ahead of time so everyone, in every timezone, plays the same
// chain no matter when the pools were last refreshed. Existing days are never rewritten.
// Local dates in use span UTC-12..UTC+14, so cover yesterday through two days out.
async function publishDailies(pools, generatedAt) {
  const dir = join(OUT_DIR, 'daily');
  await mkdir(dir, { recursive: true });
  const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
  for (const offset of [-1, 0, 1, 2]) {
    const key = day(offset);
    const file = join(dir, `${key}.json`);
    if (await access(file).then(() => true, () => false)) continue;
    const puzzles = Object.fromEntries(
      Object.entries(pools).map(([mode, players]) => [mode, buildPuzzle(players, mode, dailySeed(key, mode), DAILY_ROUNDS)]),
    );
    await writeFile(file, JSON.stringify({ date: key, generatedAt, puzzles }));
    console.log(`daily/${key}.json published`);
  }
  // Keep two weeks of past puzzles.
  const cutoff = day(-14);
  for (const f of await readdir(dir)) if (f.endsWith('.json') && f.slice(0, 10) < cutoff) await rm(join(dir, f));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
