// Merges the per-game projection files (data/projections/w<wk>/<game>.json, one per research agent)
// into data/projections/<season>-w<wk>.json, the file scripts/five-leg.mjs reads. A game already in
// the merged file and not in the folder (the Thursday game) is kept.
//
//   node scripts/merge-projections.mjs --week 5 [--season 2026]
import path from 'node:path';
import fs from 'node:fs';
import { DATA, readJson, writeJson, nowIso } from './lib.mjs';

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1] ?? '1'] : []))
    .filter((x) => x.length),
);
const SEASON = Number(args.season || new Date().getUTCFullYear());
const WEEK = Number(args.week);
if (!WEEK) {
  console.error('usage: node scripts/merge-projections.mjs --week N');
  process.exit(1);
}
const wk = `${SEASON}-w${String(WEEK).padStart(2, '0')}`;
const dir = path.join(DATA, 'projections', `w${String(WEEK).padStart(2, '0')}`);
const outFile = path.join(DATA, 'projections', `${wk}.json`);
const merged = readJson(outFile, { season: SEASON, week: WEEK, games: [] });
const byId = new Map((merged.games ?? []).map((g) => [g.game, g]));
const problems = [];
for (const f of fs.existsSync(dir)
  ? fs
      .readdirSync(dir)
      .filter((x) => x.endsWith('.json'))
      .sort()
  : []) {
  const g = readJson(path.join(dir, f));
  const id = f.slice(0, -5);
  if (!g?.players?.length) {
    problems.push(`${id}: no players`);
    continue;
  }
  g.game ||= id;
  if (g.game !== id) problems.push(`${id}: file says game ${g.game}`);
  for (const p of g.players) {
    if (!p.team || !p.player) problems.push(`${id}: a row without team or player`);
    p.flags = Array.isArray(p.flags) ? p.flags : [];
  }
  byId.set(id, g);
}
merged.season = SEASON;
merged.week = WEEK;
merged.mergedAt = nowIso();
merged.games = [...byId.values()].sort((a, b) => Date.parse(a.kick ?? 0) - Date.parse(b.kick ?? 0));
writeJson(outFile, merged);
console.log(`merged ${merged.games.length} games into ${path.relative(DATA, outFile)}`);
for (const p of problems) console.log(`  PROBLEM ${p}`);
process.exit(problems.length ? 1 : 0);
