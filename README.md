# MLB Higher or Lower ⚾

A daily higher-or-lower game built on real MLB stats, in the style of HLTV's higher/lower game.

Two players appear side by side. The left one's stat is showing, and you call whether the right one's is **higher** or **lower**. The left player **stays on top**, facing a new challenger each guess, until a challenger has a higher number (they take over) or until they've faced 3–4 challengers (the latest one steps in). The stat **switches every 3 guesses**. You get **3 lives**: each wrong call costs one, and losing all three ends the run. Your score is how many you got right, out of 30.

- **Four dailies:** Batters or Pitchers × this season or all-time. Everyone gets the same players each day (seeded by date), and new puzzles arrive at local midnight.
- **Stars first:** players are drawn by a fame weight that blends playing time (PA, or IP/saves/Ks for pitchers), All-Star selections and Hall of Fame status.
- **Difficulty ramp:** later rounds pick closer matchups. A perfect game is 30 out of 30.
- **Endless mode** for unlimited practice, with a best score per mode.
- **Share** an emoji grid grouped by stat, track stats and day streaks (stored in the browser), and play with keyboard shortcuts (↑/W, ↓/S).

**Stats:** AVG, HR, RBI, OPS, SLG, OBP, H, R, K, SB, BB, 2B, 3B (all-time), TB · ERA, K, W, WHIP, IP, SV, K/9, L, BB/9, BAA, K/BB, GS/CG/SHO (all-time).

## Run it

Requires Node 20+. There are no dependencies.

```sh
npm run dev     # http://localhost:5173
npm test        # puzzle-generation tests
npm run data    # refresh public/data/*.json from the MLB Stats API
```

## How it works

| Path | What |
| --- | --- |
| `scripts/fetch-data.mjs` | Pulls season and career stats, All-Star and HOF data from `statsapi.mlb.com` and writes the four player pools. Tuning knobs (pool sizes, minimum PA/IP, fame weights) are in `CONFIG`. |
| `public/js/stats.js` | Stat categories: labels, formats, how often each is picked. |
| `public/js/game.js` | Pure game logic: seeded RNG, puzzle chains, lives and scoring, stats, share text. |
| `public/js/app.js` | UI, local storage, sharing. |

"This season" is the current year once at least 120 hitters have 250+ PA. Before that it's the previous season. Override it with `npm run data -- --season 2025`.

Each data run also publishes frozen daily puzzles for yesterday through two days out (`public/data/daily/YYYY-MM-DD.json`) and never rewrites a day that already exists. That way everyone in every timezone plays the same chain, even when the pools refresh mid-day. If a day's file is missing, the browser builds the same seeded puzzle from the pool. Started puzzles are also saved to local storage.

## Everyone's scores

When a player finishes a daily, the browser sends the run to a small Cloudflare Worker in `worker/`, which stores it in a D1 database. The browser uses an anonymous random ID, and each player counts once per day per mode. The worker recomputes the score from the guesses against the published puzzle, so it never trusts a score sent by the client. It returns the day's distribution, and the results screen shows the histogram, the player's bar, and the share of players they beat.

```sh
cd worker
npm install
npx wrangler login
npx wrangler d1 create mlb-higher-lower   # paste the database_id into wrangler.toml
npm run db:init                           # create the table
npm run deploy                            # prints the workers.dev URL
```

Put the printed URL in `public/js/config.js` as `SCORES_API`. To develop locally, run `npm run db:init:local && npm run dev` in `worker/`, then open `http://localhost:5173/?api=http://127.0.0.1:8787`.

## Deploy

It's a static site, so `public/` can be hosted anywhere. `.github/workflows/update-data.yml` refreshes the data every day at 08:00 UTC and deploys to GitHub Pages. Push to GitHub and set **Settings → Pages → Source: GitHub Actions** to turn it on.

Data © MLB Advanced Media, via the public MLB Stats API. This is a fan project and is not affiliated with MLB.
