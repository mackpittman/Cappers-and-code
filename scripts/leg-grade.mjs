// Parsing the stat legs inside a published ticket so a member's slip can settle itself.
//
// Tickets quote the same bet in two house styles. Courtside writes a ladder, "9+ receptions",
// meaning at least nine. FanDuel writes a sportsbook line, "over 7.5 receptions", meaning strictly
// more. The difference matters at the boundary: seven receptions clears "7+" and loses "over 7.5".
// Kept separate from grade-results so the comparison rules can be tested on their own.

/** Market names as they appear in ticket legs, mapped to the keys `stat()` understands. */
const MARKETS = [
  [/^receiving (yards|yds)$/, 'player_reception_yds'],
  [/^reception (yards|yds)$/, 'player_reception_yds'],
  [/^rec (yards|yds)$/, 'player_reception_yds'],
  [/^receptions$/, 'player_receptions'],
  [/^catches$/, 'player_receptions'],
  [/^rushing (yards|yds)$/, 'player_rush_yds'],
  [/^rush (yards|yds)$/, 'player_rush_yds'],
  [/^passing (yards|yds)$/, 'player_pass_yds'],
  [/^pass (yards|yds)$/, 'player_pass_yds'],
];

function market(text) {
  const t = text.trim().toLowerCase();
  for (const [re, key] of MARKETS) if (re.test(t)) return key;
  return null;
}

/**
 * A stat leg broken into the pieces needed to grade it, or null when this is not one (a side, a
 * total, a touchdown prop, an unknown market, or a leg naming two players with "or", which cannot
 * be attributed to a single box score line and is deliberately left ungraded rather than guessed).
 */
export function parseStatLeg(label) {
  const raw = String(label ?? '').trim();
  if (!raw || / or /i.test(raw)) return null;

  // "<Player> over|under <line> <market>"  — strict comparison, the sportsbook form.
  let m = /^(.+?)\s+(over|under)\s+(\d+(?:\.\d+)?)\s+(.+)$/i.exec(raw);
  if (m) {
    const key = market(m[4]);
    return key ? { player: m[1].trim(), market: key, line: Number(m[3]), cmp: m[2].toLowerCase() === 'over' ? 'gt' : 'lt' } : null;
  }

  // "<Player> <line>+ <market>" — inclusive, the ladder form.
  m = /^(.+?)\s+(\d+(?:\.\d+)?)\+\s+(.+)$/.exec(raw);
  if (m) {
    const key = market(m[3]);
    return key ? { player: m[1].trim(), market: key, line: Number(m[2]), cmp: 'gte' } : null;
  }
  return null;
}

/** Compare an actual box score number against a parsed leg. */
export function gradeStatLeg(parsed, actual) {
  if (parsed == null || actual == null || !Number.isFinite(actual)) return null;
  const { line, cmp } = parsed;
  if (cmp === 'gte') return actual >= line ? 'win' : 'loss';
  if (cmp === 'gt') return actual > line ? 'win' : actual === line ? 'push' : 'loss';
  return actual < line ? 'win' : actual === line ? 'push' : 'loss';
}
