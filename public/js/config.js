// Where finished daily scores are sent and the "how everyone did" distribution comes from
// (the Cloudflare Worker in worker/). Set to '' to turn the feature off.
export const SCORES_API = 'https://mlb-higher-lower-api.mlb-higher-lower-api.workers.dev';

// While developing locally, `?api=http://localhost:8787` points the page at `wrangler dev`.
export function scoresApi() {
  const override = new URLSearchParams(location.search).get('api');
  if (override && location.hostname === 'localhost') return override.replace(/\/$/, '');
  return SCORES_API.startsWith('http') ? SCORES_API : '';
}
