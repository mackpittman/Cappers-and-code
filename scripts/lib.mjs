// Shared helpers for the Cappers & Code data pipeline (Node 20+, ESM).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA = path.join(ROOT, 'data');

export function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}
export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 1) + '\n');
}

/** American odds -> implied probability (with vig). */
export function impliedProb(american) {
  if (american == null || Number.isNaN(american)) return null;
  return american > 0 ? 100 / (american + 100) : -american / (-american + 100);
}
/** Two-way market -> vig-free probabilities. */
export function devig(a, b) {
  const ia = impliedProb(a);
  const ib = impliedProb(b);
  if (ia == null || ib == null) return null;
  const s = ia + ib;
  return { a: ia / s, b: ib / s };
}
/** Decimal odds -> American. */
export function decimalToAmerican(d) {
  if (d == null) return null;
  return d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1));
}
/** Normalize a player name for fuzzy matching across feeds. */
export function normName(s) {
  return String(s)
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, '')
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
/** ESPN uses WSH; The Odds API uses full names. */
export const TEAM_NAMES = {
  ARI: 'Arizona Cardinals',
  ATL: 'Atlanta Falcons',
  BAL: 'Baltimore Ravens',
  BUF: 'Buffalo Bills',
  CAR: 'Carolina Panthers',
  CHI: 'Chicago Bears',
  CIN: 'Cincinnati Bengals',
  CLE: 'Cleveland Browns',
  DAL: 'Dallas Cowboys',
  DEN: 'Denver Broncos',
  DET: 'Detroit Lions',
  GB: 'Green Bay Packers',
  HOU: 'Houston Texans',
  IND: 'Indianapolis Colts',
  JAX: 'Jacksonville Jaguars',
  KC: 'Kansas City Chiefs',
  LAC: 'Los Angeles Chargers',
  LAR: 'Los Angeles Rams',
  LV: 'Las Vegas Raiders',
  MIA: 'Miami Dolphins',
  MIN: 'Minnesota Vikings',
  NE: 'New England Patriots',
  NO: 'New Orleans Saints',
  NYG: 'New York Giants',
  NYJ: 'New York Jets',
  PHI: 'Philadelphia Eagles',
  PIT: 'Pittsburgh Steelers',
  SEA: 'Seattle Seahawks',
  SF: 'San Francisco 49ers',
  TB: 'Tampa Bay Buccaneers',
  TEN: 'Tennessee Titans',
  WSH: 'Washington Commanders',
};
export const ABBR_BY_NAME = Object.fromEntries(Object.entries(TEAM_NAMES).map(([a, n]) => [n, a]));

export async function getJson(url, { timeoutMs = 60000, headers = {} } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers });
    const body = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, headers: res.headers, body };
  } finally {
    clearTimeout(t);
  }
}
export const nowIso = () => new Date().toISOString();
