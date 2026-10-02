// The front page's "top 10 by category": one ranked list per market, every number the model's own.
//
// Sides, totals and moneylines are priced from the desk's projected score against the posted line,
// with the same margin and total spreads the game simulator uses (13.4 and 10.6 points), so a side
// is ranked by how often the projection says it covers, not by how loudly it was written up.
// Touchdown lists are ranked by the desk's role-built estimate; the value list by the gap between
// that estimate and the price. Prop leans carry no probability of their own, so they are listed by
// kickoff and labelled as leans rather than ranked as if they were graded.
import { impliedProb } from './lib.mjs';

const SD_MARGIN = 13.4;
const SD_TOTAL = 10.6;
const TOP = 10;

// Abramowitz-Stegun 7.1.26; plenty for a ranking.
function phi(z) {
  const t = 1 / (1 + (0.3275911 * Math.abs(z)) / Math.SQRT2);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}
const round = (x, d = 3) => (x == null || Number.isNaN(x) ? null : +x.toFixed(d));
const twoPlus = (p) => {
  const x = -Math.log(1 - Math.min(p, 0.95));
  return 1 - Math.exp(-x) * (1 + x);
};
const isOver = (g) =>
  /FINAL|IN_PROGRESS|HALFTIME/i.test(g.status?.state ?? '') ||
  (!!g.kickoff && Date.parse(g.kickoff) < Date.now());
const label = (g) => `${g.away.abbr}@${g.home.abbr}`;
const RULED_OUT = /^(out|doubtful|injured reserve|ir|suspended)$/i;

/** Spread and total currently on the board: the live feed when it has one, else the research line. */
function lineOf(g) {
  const spreadLabel = g.lines?.spread ?? '';
  const [favAbbr, numStr] = spreadLabel.split(' ');
  const fav = Number(numStr); // negative: the favourite's handicap
  const homePoint = g.live?.spread?.homePoint;
  let homeSpread = typeof homePoint === 'number' ? homePoint : favAbbr === g.home.abbr ? fav : -fav;
  const total = typeof g.live?.total?.point === 'number' ? g.live.total.point : g.lines?.total;
  return { homeSpread, total };
}

function sideRow(g) {
  const m = g.market;
  if (!m?.side || !m.projected) return null;
  const { homeSpread } = lineOf(g);
  if (typeof homeSpread !== 'number' || Number.isNaN(homeSpread)) return null;
  const team = m.side.split(' ')[0];
  const home = team === g.home.abbr;
  const num = home ? homeSpread : -homeSpread; // the handicap on our side
  const margin = home ? m.projected.home - m.projected.away : m.projected.away - m.projected.home;
  const prob = phi((margin + num) / SD_MARGIN);
  return {
    game: g.id,
    gameLabel: label(g),
    kickoff: g.kickoff,
    bet: `${team} ${num > 0 ? '+' : ''}${num}`,
    price: -110,
    prob: round(prob),
    implied: round(impliedProb(-110)),
    edge: round(prob - impliedProb(-110)),
    conf: m.sideConf ?? 0,
    why: m.why,
  };
}

function totalRow(g) {
  const m = g.market;
  if (!m?.total || !m.projected) return null;
  const { total } = lineOf(g);
  if (typeof total !== 'number') return null;
  const over = /^over/i.test(m.total);
  const proj = m.projected.home + m.projected.away;
  const pOver = 1 - phi((total - proj) / SD_TOTAL);
  const prob = over ? pOver : 1 - pOver;
  return {
    game: g.id,
    gameLabel: label(g),
    kickoff: g.kickoff,
    bet: `${over ? 'Over' : 'Under'} ${total}`,
    price: -110,
    prob: round(prob),
    implied: round(impliedProb(-110)),
    edge: round(prob - impliedProb(-110)),
    conf: m.totalConf ?? 0,
    why: m.why,
  };
}

function mlRow(g) {
  const m = g.market;
  if (!m?.projected) return null;
  const margin = m.projected.home - m.projected.away;
  const pHome = phi(margin / SD_MARGIN);
  const home = pHome >= 0.5;
  const team = home ? g.home.abbr : g.away.abbr;
  const prob = home ? pHome : 1 - pHome;
  const price = home
    ? (g.live?.ml?.home ?? g.lines?.ml?.home)
    : (g.live?.ml?.away ?? g.lines?.ml?.away);
  const mkt = home ? g.lines?.winProb?.home : g.lines?.winProb?.away;
  return {
    game: g.id,
    gameLabel: label(g),
    kickoff: g.kickoff,
    bet: `${team} ML`,
    price: typeof price === 'number' ? price : null,
    prob: round(prob),
    implied: round(mkt ?? (typeof price === 'number' ? impliedProb(price) : null)),
    edge: round(mkt != null ? prob - mkt : null),
    conf: null,
    why: `Projected ${g.away.abbr} ${m.projected.away}, ${g.home.abbr} ${m.projected.home}.`,
  };
}

function scorers(g) {
  const out = [];
  const seen = new Set();
  for (const p of [...(g.top3 ?? []), ...(g.value ?? [])]) {
    if (seen.has(p.name) || typeof p.est !== 'number') continue;
    seen.add(p.name);
    const status = (g.injuryReport?.away ?? [])
      .concat(g.injuryReport?.home ?? [])
      .find((x) => x.name === p.name)?.status;
    if (status && RULED_OUT.test(status)) continue;
    if ((g.scratched ?? []).includes(p.name)) continue;
    const price = p.live?.best ?? p.price ?? null;
    const implied = typeof price === 'number' ? impliedProb(price) : null;
    out.push({
      game: g.id,
      gameLabel: label(g),
      kickoff: g.kickoff,
      name: p.name,
      team: p.team,
      pos: p.pos,
      price,
      priceNote: p.priceNote ?? null,
      prob: p.est,
      implied: round(implied),
      edge: round(implied != null ? p.est - implied : null),
      est2: typeof p.est2 === 'number' ? p.est2 : round(twoPlus(p.est)),
      price2: p.live2?.best ?? null,
      why: p.why,
    });
  }
  return out;
}

export function buildTopTen(board) {
  const games = (board.games ?? []).filter((g) => !isOver(g));
  const byConfThenProb = (a, b) => (b.conf ?? 0) - (a.conf ?? 0) || b.prob - a.prob;
  // A list of ten is not a reason to print a play the projection does not like: only positive edges.
  const sides = games
    .map(sideRow)
    .filter((r) => r && r.edge > 0)
    .sort(byConfThenProb)
    .slice(0, TOP);
  const totals = games
    .map(totalRow)
    .filter((r) => r && r.edge > 0)
    .sort(byConfThenProb)
    .slice(0, TOP);
  const moneyline = games
    .map(mlRow)
    .filter(Boolean)
    .sort((a, b) => b.prob - a.prob)
    .slice(0, TOP);
  const all = games.flatMap(scorers);
  const atd = all
    .filter((p) => p.price != null)
    .sort((a, b) => b.prob - a.prob)
    .slice(0, TOP)
    .map((p) => ({ ...p, bet: `${p.name} anytime TD` }));
  const value = all
    .filter((p) => p.edge != null && p.edge > 0)
    .sort((a, b) => b.edge - a.edge)
    .slice(0, TOP)
    .map((p) => ({ ...p, bet: `${p.name} anytime TD` }));
  const td2 = [...all]
    .sort((a, b) => b.est2 - a.est2)
    .slice(0, TOP)
    .map((p) => {
      const implied2 = typeof p.price2 === 'number' ? impliedProb(p.price2) : null;
      return {
        ...p,
        bet: `${p.name} 2+ TDs`,
        price: p.price2,
        prob: round(p.est2),
        implied: round(implied2),
        edge: round(implied2 != null ? p.est2 - implied2 : null),
        fair: p.est2 > 0 ? Math.round((100 * (1 - p.est2)) / p.est2) : null,
      };
    });
  const propsAll = games
    .flatMap((g) =>
      (g.market?.propLeans ?? []).map((pl) => {
        const posted = (g.propLines ?? []).find(
          (x) => x.name === pl.player && x.market === pl.market,
        );
        const line = posted?.line ?? pl.line;
        const price = posted ? (pl.side === 'over' ? posted.over : posted.under) : null;
        const mk =
          {
            player_pass_yds: 'pass yds',
            player_rush_yds: 'rush yds',
            player_reception_yds: 'rec yds',
            player_receptions: 'receptions',
            player_pass_tds: 'pass TDs',
          }[pl.market] ?? pl.market;
        return {
          game: g.id,
          gameLabel: label(g),
          kickoff: g.kickoff,
          bet: `${pl.player} ${pl.side === 'over' ? 'over' : 'under'} ${line} ${mk}`,
          price: price ?? null,
          prob: null,
          implied: null,
          edge: null,
          conf: null,
          why: pl.why,
        };
      }),
    )
    .sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff));
  // One lean per game first, then the second lean of each game, so ten props cover ten games
  // instead of the first three kickoffs.
  const byGame = new Map();
  for (const p of propsAll) (byGame.get(p.game) ?? byGame.set(p.game, []).get(p.game)).push(p);
  const props = [];
  for (let round = 0; props.length < TOP && round < 5; round++)
    for (const list of byGame.values())
      if (list[round] && props.length < TOP) props.push(list[round]);
  return {
    builtAt: new Date().toISOString(),
    note: 'Sides, totals and moneylines are priced from the projected score with the simulator’s spreads (13.4 margin, 10.6 total). Touchdown lists use the desk’s role-built estimates. Prop leans are not graded by a probability and are listed by kickoff.',
    categories: [
      {
        key: 'sides',
        title: 'Spreads',
        blurb: 'Ranked by desk confidence, then the projection’s cover rate.',
        plays: sides,
      },
      {
        key: 'totals',
        title: 'Totals',
        blurb: 'Ranked by desk confidence, then how often the projection lands on our side.',
        plays: totals,
      },
      {
        key: 'moneyline',
        title: 'Moneyline',
        blurb: 'Most likely winners by the projected score.',
        plays: moneyline,
      },
      {
        key: 'atd',
        title: 'Anytime TD',
        blurb: 'Most likely scorers on the slate, priced.',
        plays: atd,
      },
      {
        key: 'value',
        title: 'TD value',
        blurb: 'Biggest gap between our number and the price.',
        plays: value,
      },
      {
        key: 'td2',
        title: '2+ TDs',
        blurb: 'Most likely multi-score players. Fair price shown where no book posted one.',
        plays: td2,
      },
      {
        key: 'props',
        title: 'Props',
        blurb: 'The desk’s written leans, one per game by kickoff. Not probability-graded.',
        plays: props,
      },
    ],
  };
}

// ---------- weekend lottos ----------
// Four tickets built from the top-10 lists by rule, one leg per game so the legs are independent
// and the joint probability is honest: the four likeliest totals, the max-confidence five (top
// three sides plus top two totals), four value scorers at confirmed prices, and three long shots
// priced +500 or longer. Each carries its own hit rate and the price multiplied out.
const dec = (a) => (a > 0 ? 1 + a / 100 : 1 + 100 / -a);
const toAm = (d) => (d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1)));
function distinct(list, n, used = new Set()) {
  const out = [];
  for (const p of list) {
    if (out.length === n) break;
    if (used.has(p.game) || p.price == null || p.prob == null) continue;
    used.add(p.game);
    out.push(p);
  }
  return out;
}
function ticket(name, why, legs, n) {
  if (legs.length < n) return null;
  const prob = legs.reduce((x, l) => x * l.prob, 1);
  const d = legs.reduce((x, l) => x * dec(l.price), 1);
  return {
    game: legs[0].game,
    gameLabel: `${legs.length} games`,
    bet: name,
    kind: 'parlay',
    price: toAm(d),
    book: legs.some((l) => l.priceNote) ? 'check prices' : 'desk prices',
    prob: round(prob, 4),
    fair: toAm(1 / prob),
    ev: round(prob * d - 1, 2),
    why: `${why} Hits ${(prob * 100).toFixed(1)}% of the time by the model, fair ${toAm(1 / prob) > 0 ? '+' : ''}${toAm(1 / prob)}.`,
    legs: legs.map((l) => ({
      label: `${l.gameLabel} ${l.bet}${l.priceNote ? ` (${l.priceNote})` : ''}`,
      price: l.price,
      book: null,
    })),
  };
}
export function buildLottos(topTen) {
  const C = Object.fromEntries((topTen?.categories ?? []).map((c) => [c.key, c.plays]));
  const byProb = (xs) => [...(xs ?? [])].sort((a, b) => b.prob - a.prob);
  const out = [
    ticket(
      'Sunday unders, 4 legs',
      'The four totals the projection is most sure land under, one per game.',
      distinct(
        byProb(C.totals).filter((x) => /^Under/.test(x.bet)),
        4,
      ),
      4,
    ),
    (() => {
      const used = new Set();
      const sides = distinct(byProb(C.sides), 3, used);
      const totals = distinct(byProb(C.totals), 2, used);
      return ticket(
        'Max confidence five',
        'The top three sides and top two totals on the board, every leg a different game.',
        [...sides, ...totals],
        5,
      );
    })(),
    ticket(
      'TD value four',
      'Four scorers the price undersells most, all confirmed at a book, all different games.',
      distinct(
        (C.value ?? []).filter((x) => !x.priceNote),
        4,
      ),
      4,
    ),
    ticket(
      'Long-shot scorers',
      'Three scorers at +500 or longer whose role says the book is short. Prices need a check before you fire.',
      distinct(
        (C.value ?? []).filter((x) => x.price >= 500),
        3,
      ),
      3,
    ),
  ];
  return out.filter(Boolean);
}
