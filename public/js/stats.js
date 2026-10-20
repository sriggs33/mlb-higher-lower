// Stat categories used by the game. Shared by the browser app and the data build script.
//
// key     — short id stored in the data files
// api     — field name in the MLB Stats API response
// label   — full name shown on the card
// unit    — how the stat reads mid-sentence ("has 42 home runs")
// abbr    — abbreviation shown in results / share text
// fmt     — how to display the value (see formatStat)
// weight  — how often the stat is picked for a round (headline stats are picked more)
// scopes  — which pools the stat appears in ("season", "career")
// lowerBetter — a lower number is the better one (ERA, WHIP…), so the lower player takes over
// minTop  — optional { season, career }: at least one of the two players must reach this, so
//           role-specific stats (saves) don't produce 0-vs-3 coin flips between starters

export const BATTING_STATS = [
  { key: 'avg', api: 'avg', label: 'Batting Average', unit: 'batting average', abbr: 'AVG', fmt: 'rate', weight: 3, scopes: ['season', 'career'] },
  { key: 'hr', api: 'homeRuns', label: 'Home Runs', unit: 'home runs', abbr: 'HR', fmt: 'int', weight: 3, scopes: ['season', 'career'] },
  { key: 'rbi', api: 'rbi', label: 'Runs Batted In', unit: 'RBIs', abbr: 'RBI', fmt: 'int', weight: 3, scopes: ['season', 'career'] },
  { key: 'ops', api: 'ops', label: 'OPS', unit: 'OPS', abbr: 'OPS', fmt: 'rate', weight: 3, scopes: ['season', 'career'] },
  { key: 'slg', api: 'slg', label: 'Slugging %', unit: 'slugging %', abbr: 'SLG', fmt: 'rate', weight: 2, scopes: ['season', 'career'] },
  { key: 'obp', api: 'obp', label: 'On-Base %', unit: 'on-base %', abbr: 'OBP', fmt: 'rate', weight: 2, scopes: ['season', 'career'] },
  { key: 'h', api: 'hits', label: 'Hits', unit: 'hits', abbr: 'H', fmt: 'int', weight: 2, scopes: ['season', 'career'] },
  { key: 'r', api: 'runs', label: 'Runs Scored', unit: 'runs', abbr: 'R', fmt: 'int', weight: 2, scopes: ['season', 'career'] },
  { key: 'so', api: 'strikeOuts', label: 'Strikeouts', unit: 'strikeouts', abbr: 'K', fmt: 'int', weight: 2, scopes: ['season', 'career'] },
  { key: 'sb', api: 'stolenBases', label: 'Stolen Bases', unit: 'stolen bases', abbr: 'SB', fmt: 'int', weight: 2, scopes: ['season', 'career'] },
  { key: 'bb', api: 'baseOnBalls', label: 'Walks', unit: 'walks', abbr: 'BB', fmt: 'int', weight: 1, scopes: ['season', 'career'] },
  { key: 'd', api: 'doubles', label: 'Doubles', unit: 'doubles', abbr: '2B', fmt: 'int', weight: 1, scopes: ['season', 'career'] },
  { key: 't', api: 'triples', label: 'Triples', unit: 'triples', abbr: '3B', fmt: 'int', weight: 1, scopes: ['career'] },
  { key: 'tb', api: 'totalBases', label: 'Total Bases', unit: 'total bases', abbr: 'TB', fmt: 'int', weight: 1, scopes: ['season', 'career'] },
];

export const PITCHING_STATS = [
  { key: 'era', api: 'era', label: 'ERA', unit: 'ERA', abbr: 'ERA', fmt: 'dec2', lowerBetter: true, weight: 3, scopes: ['season', 'career'] },
  { key: 'so', api: 'strikeOuts', label: 'Strikeouts', unit: 'strikeouts', abbr: 'K', fmt: 'int', weight: 3, scopes: ['season', 'career'] },
  { key: 'w', api: 'wins', label: 'Wins', unit: 'wins', abbr: 'W', fmt: 'int', weight: 3, scopes: ['season', 'career'] },
  { key: 'whip', api: 'whip', label: 'WHIP', unit: 'WHIP', abbr: 'WHIP', fmt: 'dec2', lowerBetter: true, weight: 3, scopes: ['season', 'career'] },
  { key: 'ip', api: 'inningsPitched', label: 'Innings Pitched', unit: 'innings pitched', abbr: 'IP', fmt: 'ip', weight: 2, scopes: ['season', 'career'] },
  { key: 'sv', api: 'saves', label: 'Saves', unit: 'saves', abbr: 'SV', fmt: 'int', weight: 1, scopes: ['season', 'career'], minTop: { season: 10, career: 50 } },
  { key: 'k9', api: 'strikeoutsPer9Inn', label: 'Strikeouts per 9', unit: 'K/9', abbr: 'K/9', fmt: 'dec2', weight: 2, scopes: ['season', 'career'] },
  { key: 'l', api: 'losses', label: 'Losses', unit: 'losses', abbr: 'L', fmt: 'int', weight: 1, scopes: ['season', 'career'] },
  { key: 'bb9', api: 'walksPer9Inn', label: 'Walks per 9', unit: 'BB/9', abbr: 'BB/9', fmt: 'dec2', lowerBetter: true, weight: 1, scopes: ['season', 'career'] },
  { key: 'baa', api: 'avg', label: 'Opponent Batting Avg', unit: 'opponent average', abbr: 'BAA', fmt: 'rate', lowerBetter: true, weight: 1, scopes: ['season', 'career'] },
  { key: 'kbb', api: 'strikeoutWalkRatio', label: 'Strikeout-to-Walk Ratio', unit: 'K/BB ratio', abbr: 'K/BB', fmt: 'dec2', weight: 1, scopes: ['season', 'career'] },
  { key: 'gs', api: 'gamesStarted', label: 'Games Started', unit: 'games started', abbr: 'GS', fmt: 'int', weight: 1, scopes: ['career'] },
  { key: 'cg', api: 'completeGames', label: 'Complete Games', unit: 'complete games', abbr: 'CG', fmt: 'int', weight: 1, scopes: ['career'], minTop: { career: 10 } },
  { key: 'sho', api: 'shutouts', label: 'Shutouts', unit: 'shutouts', abbr: 'SHO', fmt: 'int', weight: 1, scopes: ['career'], minTop: { career: 5 } },
];

export function statsFor(group, scope) {
  const list = group === 'pitching' ? PITCHING_STATS : BATTING_STATS;
  return list.filter((s) => s.scopes.includes(scope));
}

// API value -> number used for comparisons. Innings come as "200.2" meaning 200⅔.
export function parseStat(def, raw) {
  if (raw === undefined || raw === null || raw === '' || raw === '-.--' || raw === '.---') return null;
  if (def.fmt === 'ip') {
    const [whole, frac = '0'] = String(raw).split('.');
    return Number(whole) + Number(frac) / 3;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function formatStat(def, value) {
  if (value === null || value === undefined) return '—';
  switch (def.fmt) {
    case 'rate': {
      const s = value.toFixed(3);
      return s.startsWith('0') ? s.slice(1) : s;
    }
    case 'dec2':
      return value.toFixed(2);
    case 'ip': {
      const whole = Math.floor(value + 1e-9);
      const thirds = Math.round((value - whole) * 3);
      return thirds === 3 ? `${(whole + 1).toLocaleString('en-US')}.0` : `${whole.toLocaleString('en-US')}.${thirds}`;
    }
    default:
      return Math.round(value).toLocaleString('en-US');
  }
}
