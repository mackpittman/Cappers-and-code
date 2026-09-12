// Validates src/data/research.json against the shape the app, pipeline and grader expect.
// Exit code 1 with a list of problems when invalid. Run before committing a new week.
import path from 'node:path';
import { ROOT, DATA, readJson } from './lib.mjs';

const r = readJson(process.argv[2] || path.join(ROOT, 'src', 'data', 'research.json'));
const schedule = readJson(path.join(DATA, 'schedule.json'), { games: [] });
const problems = [];
const need = (cond, msg) => {
  if (!cond) problems.push(msg);
};
need(r && typeof r === 'object', 'research.json is not an object');
need(Number.isInteger(r?.season), 'season must be an integer');
need(Number.isInteger(r?.week), 'week must be an integer');
need(typeof r?.researchAsOf === 'string', 'researchAsOf must be an ISO string');
need(Array.isArray(r?.games) && r.games.length > 0, 'games must be a non-empty array');
need(Array.isArray(r?.bestBets), 'bestBets must be an array');
need(Array.isArray(r?.crossStacks), 'crossStacks must be an array');
need(r?.creditPlan?.monthly, 'creditPlan.monthly missing');
const ids = new Set();
for (const g of r?.games || []) {
  const tag = `game ${g.id || '?'}`;
  need(typeof g.id === 'string' && !ids.has(g.id), `${tag}: id must be unique string`);
  ids.add(g.id);
  need(/^\d+$/.test(String(g.espnId || '')), `${tag}: espnId must be numeric`);
  if (schedule.games.length)
    need(
      schedule.games.some((s) => s.espnId === String(g.espnId)),
      `${tag}: espnId ${g.espnId} not in current schedule.json`,
    );
  need(
    g.away?.abbr && g.home?.abbr && g.away?.name && g.home?.name,
    `${tag}: away/home need abbr and name`,
  );
  need(!Number.isNaN(Date.parse(g.kickoff || '')), `${tag}: kickoff must be ISO`);
  need(
    g.lines?.ml?.away != null &&
      g.lines?.ml?.home != null &&
      typeof g.lines?.spread === 'string' &&
      typeof g.lines?.total === 'number',
    `${tag}: lines.ml/spread/total`,
  );
  need(
    g.lines?.winProb?.away != null && g.lines?.implied?.away != null,
    `${tag}: lines.winProb and lines.implied`,
  );
  for (const k of ['offseason', 'matchup', 'injuries'])
    need(
      typeof g.sections?.[k] === 'string' && g.sections[k].length > 40,
      `${tag}: sections.${k} missing or too short`,
    );
  need(Array.isArray(g.top3) && g.top3.length === 3, `${tag}: top3 must have exactly 3 picks`);
  need(Array.isArray(g.value) && g.value.length >= 1, `${tag}: value needs at least 1 pick`);
  for (const p of [...(g.top3 || []), ...(g.value || [])]) {
    need(
      p.name &&
        p.team &&
        p.pos &&
        typeof p.est === 'number' &&
        p.est > 0 &&
        p.est < 1 &&
        typeof p.why === 'string',
      `${tag}: pick ${p.name || '?'} needs name/team/pos/est(0-1)/why`,
    );
    need(
      p.price === null || typeof p.price === 'number',
      `${tag}: pick ${p.name} price must be number or null`,
    );
  }
  need(Array.isArray(g.atdBoard) && g.atdBoard.length >= 4, `${tag}: atdBoard needs 4+ entries`);
  need(Array.isArray(g.stacks) && g.stacks.length >= 2, `${tag}: stacks needs 2+`);
  for (const s of g.stacks || [])
    need(
      Array.isArray(s.legs) && s.legs.length >= 2 && s.why,
      `${tag}: stack needs legs[2+] and why`,
    );
  const m = g.market;
  need(
    m &&
      m.projected &&
      typeof m.projected.away === 'number' &&
      typeof m.projected.home === 'number',
    `${tag}: market.projected`,
  );
  need(
    m &&
      typeof m.side === 'string' &&
      Number.isInteger(m.sideConf) &&
      m.sideConf >= 0 &&
      m.sideConf <= 5,
    `${tag}: market.side/sideConf`,
  );
  need(
    m && typeof m.total === 'string' && Number.isInteger(m.totalConf),
    `${tag}: market.total/totalConf`,
  );
  if (m?.side)
    need(
      /^[A-Z]{2,3}\s*[+-]\d+(\.\d+)?$/.test(m.side),
      `${tag}: market.side must look like "DEN +2.5"`,
    );
  if (m?.total)
    need(
      /^(Over|Under)\s+\d+(\.\d+)?$/.test(m.total),
      `${tag}: market.total must look like "Under 42.5"`,
    );
  for (const l of m?.propLeans || [])
    need(
      l.player &&
        /^player_/.test(l.market) &&
        ['over', 'under'].includes(l.side) &&
        typeof l.line === 'number' &&
        l.why,
      `${tag}: propLean ${l.player || '?'} malformed`,
    );
}
for (const b of r?.bestBets || []) {
  need(ids.has(b.game), `bestBet "${b.bet}": game ${b.game} not in games`);
  need(Number.isInteger(b.conf) && b.conf >= 1 && b.conf <= 5, `bestBet "${b.bet}": conf 1-5`);
  need(
    /^([A-Z]{2,3}\s*[+-]\d+(\.\d+)?|(Over|Under)\s+\d+(\.\d+)?|.+\sATD\b.*)$/.test(b.bet),
    `bestBet "${b.bet}": must be "ABC +2.5", "Over 48.5", or "<Player> ATD ..."`,
  );
}
if (problems.length) {
  console.error(`research.json: ${problems.length} problem(s)`);
  for (const p of problems) console.error(' - ' + p);
  process.exit(1);
}
console.log(
  `research.json OK: week ${r.week}, ${r.games.length} games, ${r.bestBets.length} best bets`,
);
