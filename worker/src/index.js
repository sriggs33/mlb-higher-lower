// Score service for MLB Higher or Lower (Cloudflare Worker + D1).
//
//   POST /api/score         { date, mode, uid, guesses }  -> records one daily result per player
//   GET  /api/distribution  ?date=YYYY-MM-DD&mode=...      -> { total, counts[0..30] }
//
// The score is never taken from the client: it's recomputed from the guesses against the
// published daily puzzle, and only finished runs are accepted. One row per (date, mode, uid).

import { DAILY_ROUNDS, MODES, isOver, score } from '../../public/js/game.js';

const SITE = 'https://sriggs33.github.io/mlb-higher-lower';
const ALLOWED_ORIGINS = new Set(['https://sriggs33.github.io', 'http://localhost:5173']);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const DAY_MS = 86400000;
const utcDay = (offset = 0) => new Date(Date.now() + offset * DAY_MS).toISOString().slice(0, 10);

function checkDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) throw new HttpError(400, 'bad date');
  // Local dates run from UTC-12 to UTC+14; allow a little slack for late finishers.
  if (date < utcDay(-2) || date > utcDay(1)) throw new HttpError(400, 'date out of range');
  return date;
}

function checkMode(mode) {
  if (!Object.hasOwn(MODES, mode ?? '')) throw new HttpError(400, 'bad mode');
  return mode;
}

async function publishedPuzzle(date, mode) {
  const res = await fetch(`${SITE}/data/daily/${date}.json`, { cf: { cacheTtl: 600, cacheEverything: true } });
  if (!res.ok) throw new HttpError(404, 'no puzzle for that date');
  const puzzle = (await res.json()).puzzles?.[mode];
  if (!puzzle) throw new HttpError(404, 'no puzzle for that mode');
  return puzzle;
}

async function distribution(env, date, mode) {
  const { results } = await env.DB.prepare('SELECT score, COUNT(*) AS n FROM scores WHERE date = ? AND mode = ? GROUP BY score')
    .bind(date, mode)
    .all();
  const counts = Array.from({ length: DAILY_ROUNDS + 1 }, () => 0);
  let total = 0;
  for (const { score: s, n } of results) {
    if (s >= 0 && s <= DAILY_ROUNDS) counts[s] = n;
    total += n;
  }
  return { date, mode, total, counts };
}

async function submit(req, env) {
  const body = await req.json().catch(() => null);
  if (!body) throw new HttpError(400, 'bad json');
  const date = checkDate(body.date);
  const mode = checkMode(body.mode);
  if (!/^[A-Za-z0-9-]{8,64}$/.test(body.uid ?? '')) throw new HttpError(400, 'bad uid');
  const { guesses } = body;
  if (!Array.isArray(guesses) || guesses.length > DAILY_ROUNDS || !guesses.every((g) => g === 'higher' || g === 'lower')) {
    throw new HttpError(400, 'bad guesses');
  }

  const puzzle = await publishedPuzzle(date, mode);
  if (guesses.length > puzzle.rounds.length || !isOver(puzzle, guesses)) throw new HttpError(422, 'run not finished');
  const s = score(puzzle, guesses);

  const result = await env.DB.prepare('INSERT OR IGNORE INTO scores (date, mode, uid, score, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(date, mode, body.uid, s, new Date().toISOString())
    .run();
  const recorded = result.meta.changes > 0;
  // A repeat submission keeps the player's first result.
  const stored = recorded
    ? s
    : (await env.DB.prepare('SELECT score FROM scores WHERE date = ? AND mode = ? AND uid = ?').bind(date, mode, body.uid).first('score'));
  return { recorded, score: stored, ...(await distribution(env, date, mode)) };
}

function corsHeaders(req) {
  const origin = req.headers.get('Origin');
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin) ? origin : 'https://sriggs33.github.io',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

const json = (data, headers, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });

export default {
  async fetch(req, env) {
    const cors = corsHeaders(req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const url = new URL(req.url);
    try {
      if (url.pathname === '/api/score' && req.method === 'POST') return json(await submit(req, env), cors);
      if (url.pathname === '/api/distribution' && req.method === 'GET') {
        const date = checkDate(url.searchParams.get('date'));
        const mode = checkMode(url.searchParams.get('mode'));
        return json(await distribution(env, date, mode), { ...cors, 'Cache-Control': 'public, max-age=30' });
      }
      return json({ error: 'not found' }, cors, 404);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, cors, err.status);
      console.error(err);
      return json({ error: 'server error' }, cors, 500);
    }
  },
};
