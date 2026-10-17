// The front page's lead block: spreads and moneylines for every game on the next slate day.
//
// Each row carries the side the projection covers most often at the current number (the live feed's
// spread when it has one, else the research line), the favourite the projection picks to win with
// its moneyline, and the underdog when the projection gives it a real edge over the de-vigged price.
// Rows are ranked by cover probability: probability before price (docs/WEEKLY_RESEARCH_PLAYBOOK.md).
// The margin spread is the simulator's 13.4 points, shared with top-ten.mjs so the two never differ.
import { devig, impliedProb } from './lib.mjs';
import { SD_MARGIN, lineOf, phi } from './top-ten.mjs';

const DOG_EDGE = 0.03;
const r3 = (x) => (x == null || Number.isNaN(x) ? null : +x.toFixed(3));
const etDay = (iso) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
const etLabel = (iso) =>
  new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }) + ' ET';
const dayTitle = (iso) =>
  new Date(iso).toLocaleDateString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
const am = (n) => (n == null ? '' : n > 0 ? `+${n}` : String(n));
const pt = (n) => (n === 0 ? 'PK' : n > 0 ? `+${n}` : String(n));
const pct = (x) => (x == null ? '' : `${Math.round(x * 100)}%`);

/** One game's spread and moneyline read, or null when the game has no projection or no line. */
export function sideRow(g) {
  const m = g.market;
  if (!m?.projected || typeof m.projected.home !== 'number') return null;
  const { homeSpread } = lineOf(g);
  if (typeof homeSpread !== 'number' || Number.isNaN(homeSpread)) return null;
  const marginHome = m.projected.home - m.projected.away;
  const pHomeCover = phi((marginHome + homeSpread) / SD_MARGIN);
  const homeSide = pHomeCover >= 0.5;
  const team = homeSide ? g.home.abbr : g.away.abbr;
  const point = homeSide ? homeSpread : -homeSpread;
  const deskTeam = m.side ? m.side.split(' ')[0] : null;

  const pHomeWin = phi(marginHome / SD_MARGIN);
  const mlHome = pHomeWin >= 0.5;
  const mlAway = g.live?.ml?.away ?? g.lines?.ml?.away ?? null;
  const mlHomePrice = g.live?.ml?.home ?? g.lines?.ml?.home ?? null;
  const fair =
    typeof mlAway === 'number' && typeof mlHomePrice === 'number'
      ? devig(mlAway, mlHomePrice)
      : null;
  const mktHome = fair ? fair.b : (g.lines?.winProb?.home ?? null);
  const pick = (home) => {
    const prob = home ? pHomeWin : 1 - pHomeWin;
    const implied = mktHome == null ? null : home ? mktHome : 1 - mktHome;
    const price = home ? mlHomePrice : mlAway;
    return {
      team: home ? g.home.abbr : g.away.abbr,
      bet: `${home ? g.home.abbr : g.away.abbr} ML`,
      price: typeof price === 'number' ? price : null,
      prob: r3(prob),
      implied: r3(implied ?? (typeof price === 'number' ? impliedProb(price) : null)),
      edge: r3(implied == null ? null : prob - implied),
    };
  };
  const ml = pick(mlHome);
  const other = pick(!mlHome);
  const dog = other.edge != null && other.edge >= DOG_EDGE ? other : null;
  return {
    game: g.id,
    gameLabel: `${g.away.abbr}@${g.home.abbr}`,
    kickoff: g.kickoff,
    kickoffLabel: g.kickoff ? etLabel(g.kickoff) : null,
    projected: { away: m.projected.away, home: m.projected.home },
    spread: {
      team,
      bet: `${team} ${pt(point)}`,
      point,
      price: -110,
      prob: r3(homeSide ? pHomeCover : 1 - pHomeCover),
      conf: deskTeam === team ? (m.sideConf ?? 0) : 0,
      desk: m.side || null,
      agrees: !m.side || deskTeam === team,
    },
    ml,
    dog,
    why: m.why ?? '',
  };
}

export function buildSides(board, now = new Date()) {
  const open = (board.games ?? []).filter(
    (g) => g.kickoff && Date.parse(g.kickoff) > now.getTime() && g.status?.state !== 'STATUS_FINAL',
  );
  if (!open.length) return null;
  const first = open.reduce((a, g) => (Date.parse(g.kickoff) < Date.parse(a.kickoff) ? g : a));
  const day = etDay(first.kickoff);
  const rows = open
    .filter((g) => etDay(g.kickoff) === day)
    .map(sideRow)
    .filter(Boolean)
    .sort((a, b) => b.spread.prob - a.spread.prob || (b.spread.conf ?? 0) - (a.spread.conf ?? 0));
  if (!rows.length) return null;
  const title = `Spreads and moneylines · ${dayTitle(first.kickoff)}`;
  const lines = rows.map((x) => {
    const conf = x.spread.conf
      ? ` ${'▮'.repeat(x.spread.conf)}${'▯'.repeat(5 - x.spread.conf)}`
      : '';
    const dog = x.dog
      ? ` · dog ${x.dog.team} ${am(x.dog.price)} (${pct(x.dog.prob)} vs ${pct(x.dog.implied)})`
      : '';
    return `**${x.spread.bet}** ${pct(x.spread.prob)} to cover${conf} · ${x.ml.bet} ${am(x.ml.price)} (${pct(x.ml.prob)})${dog} · ${x.gameLabel}, ${x.kickoffLabel}`;
  });
  const text = [
    `**${title.toUpperCase()}**`,
    'Every game on the slate, most likely cover first. Our projected score against the posted number. Units, not dollars.',
    '',
    ...lines,
  ].join('\n');
  return {
    builtAt: now.toISOString(),
    day,
    title,
    games: rows.length,
    rows,
    text,
  };
}
