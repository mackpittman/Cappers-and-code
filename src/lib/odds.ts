// Odds math, free ESPN line refresh, and a credit-aware manual props pull from The Odds API.
import type { Board, Game, LivePlayer, Pick } from './types';

export function impliedProb(american: number | null | undefined): number | null {
  if (american == null || Number.isNaN(american)) return null;
  return american > 0 ? 100 / (american + 100) : -american / (-american + 100);
}
export function devig(a: number | null, b: number | null) {
  const ia = impliedProb(a),
    ib = impliedProb(b);
  if (ia == null || ib == null) return null;
  const s = ia + ib;
  return { a: ia / s, b: ib / s };
}
export function fmtAmerican(n: number | null | undefined): string {
  if (n == null) return '—';
  return n > 0 ? `+${n}` : `${n}`;
}
export function pct(p: number | null | undefined, digits = 0): string {
  return p == null ? '—' : `${(p * 100).toFixed(digits)}%`;
}
export function normName(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, '')
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
function median(a: number[]): number | null {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}
const TEAM_BY_NAME: Record<string, string> = {
  'Arizona Cardinals': 'ARI',
  'Atlanta Falcons': 'ATL',
  'Baltimore Ravens': 'BAL',
  'Buffalo Bills': 'BUF',
  'Carolina Panthers': 'CAR',
  'Chicago Bears': 'CHI',
  'Cincinnati Bengals': 'CIN',
  'Cleveland Browns': 'CLE',
  'Dallas Cowboys': 'DAL',
  'Denver Broncos': 'DEN',
  'Detroit Lions': 'DET',
  'Green Bay Packers': 'GB',
  'Houston Texans': 'HOU',
  'Indianapolis Colts': 'IND',
  'Jacksonville Jaguars': 'JAX',
  'Kansas City Chiefs': 'KC',
  'Los Angeles Chargers': 'LAC',
  'Los Angeles Rams': 'LAR',
  'Las Vegas Raiders': 'LV',
  'Miami Dolphins': 'MIA',
  'Minnesota Vikings': 'MIN',
  'New England Patriots': 'NE',
  'New Orleans Saints': 'NO',
  'New York Giants': 'NYG',
  'New York Jets': 'NYJ',
  'Philadelphia Eagles': 'PHI',
  'Pittsburgh Steelers': 'PIT',
  'Seattle Seahawks': 'SEA',
  'San Francisco 49ers': 'SF',
  'Tampa Bay Buccaneers': 'TB',
  'Tennessee Titans': 'TEN',
  'Washington Commanders': 'WSH',
};
const BASE = 'https://api.the-odds-api.com/v4';
const SPORT = 'americanfootball_nfl';
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';

/** Free: refresh spread, total, moneyline, status and score from ESPN's public scoreboard. */
export async function refreshLinesFromEspn(board: Board): Promise<Board> {
  const res = await fetch(ESPN);
  if (!res.ok) throw new Error(`ESPN ${res.status}`);
  const body = await res.json();
  const now = new Date().toISOString();
  const num = (v: any) => (v == null || v === '' ? null : Number(String(v).replace('+', '')));
  const games: Game[] = board.games.map((g) => {
    const e = (body.events ?? []).find((ev: any) => ev.id === g.espnId);
    if (!e) return g;
    const c = e.competitions[0];
    const home = c.competitors.find((x: any) => x.homeAway === 'home');
    const away = c.competitors.find((x: any) => x.homeAway === 'away');
    const o = c.odds?.[0];
    const status = {
      state: c.status?.type?.name,
      detail: c.status?.type?.shortDetail,
      score: { away: Number(away.score ?? 0), home: Number(home.score ?? 0) },
    };
    if (!o?.moneyline) return { ...g, status };
    const ml = {
      home: num(o.moneyline.home?.close?.odds),
      away: num(o.moneyline.away?.close?.odds),
      bestHome: null,
      bestAway: null,
      openHome: num(o.moneyline.home?.open?.odds),
      openAway: num(o.moneyline.away?.open?.odds),
    };
    const d = devig(ml.away, ml.home);
    return {
      ...g,
      status,
      live: {
        source: `ESPN/${o.provider?.displayName ?? 'book'}`,
        fetchedAt: now,
        ml,
        spread: { homePoint: o.spread ?? null, homePrice: null, awayPrice: null },
        total: { point: o.overUnder ?? null, over: null, under: null },
        winProb: d ? { away: +d.a.toFixed(3), home: +d.b.toFixed(3) } : null,
      },
    };
  });
  return {
    ...board,
    games,
    linesSource: games.find((g) => g.live)?.live?.source ?? board.linesSource,
  };
}

export type RefreshResult = {
  board: Board;
  creditsRemaining: number | null;
  propsFetched: number;
  errors: string[];
};

/**
 * Manual anytime-TD refresh: 1 credit per game kicking off inside `hoursAhead`, soonest first,
 * stopping before the balance would fall below `reserve`. Lines are refreshed from ESPN for free.
 */
export async function refreshFromOddsApi(
  board: Board,
  apiKey: string,
  opts: { region?: string; hoursAhead?: number; reserve?: number } = {},
): Promise<RefreshResult> {
  const region = opts.region ?? 'us';
  const hoursAhead = opts.hoursAhead ?? 8;
  const reserve = opts.reserve ?? board.oddsCredits?.reserve ?? 40;
  const errors: string[] = [];
  let creditsRemaining: number | null = board.oddsCredits?.remaining ?? null;
  const note = (r: Response) => {
    const v = r.headers.get('x-requests-remaining');
    if (v != null) creditsRemaining = Number(v);
  };

  let base = board;
  try {
    base = await refreshLinesFromEspn(board);
  } catch (e: any) {
    errors.push(`ESPN lines: ${e.message}`);
  }

  const listRes = await fetch(`${BASE}/sports/${SPORT}/events?apiKey=${apiKey}`); // free
  if (!listRes.ok)
    throw new Error(`Odds API ${listRes.status}: ${(await listRes.text()).slice(0, 160)}`);
  note(listRes);
  const events = (await listRes.json()) as any[];
  const now = Date.now();
  const due = base.games
    .map((g) => ({
      g,
      ev: events.find(
        (e) =>
          TEAM_BY_NAME[e.home_team] === g.home.abbr && TEAM_BY_NAME[e.away_team] === g.away.abbr,
      ),
    }))
    .filter(
      ({ ev }) =>
        ev &&
        Date.parse(ev.commence_time) > now - 3600000 &&
        Date.parse(ev.commence_time) <= now + hoursAhead * 3600000,
    )
    .sort((a, b) => Date.parse(a.ev.commence_time) - Date.parse(b.ev.commence_time));
  if (!due.length) errors.push(`No games kick off inside ${hoursAhead}h; nothing spent.`);

  const updated = new Map<string, Game>();
  let propsFetched = 0;
  for (const { g, ev } of due) {
    if (creditsRemaining != null && creditsRemaining - 1 < reserve) {
      errors.push(`Stopped at the ${reserve}-credit reserve.`);
      break;
    }
    const pr = await fetch(
      `${BASE}/sports/${SPORT}/events/${ev.id}/odds?apiKey=${apiKey}&regions=${region}&markets=player_anytime_td&oddsFormat=american`,
    );
    if (!pr.ok) {
      errors.push(`${g.away.abbr}@${g.home.abbr} ${pr.status}`);
      continue;
    }
    note(pr);
    propsFetched++;
    const body = await pr.json();
    const byPlayer: Record<string, { name: string; books: Record<string, number> }> = {};
    for (const b of body.bookmakers ?? [])
      for (const m of b.markets ?? []) {
        if (m.key !== 'player_anytime_td') continue;
        for (const o of m.outcomes ?? []) {
          if (o.name !== 'Yes') continue;
          const k = normName(o.description);
          byPlayer[k] ||= { name: o.description, books: {} };
          byPlayer[k].books[b.key] = o.price;
        }
      }
    if (!Object.keys(byPlayer).length) {
      errors.push(`${g.away.abbr}@${g.home.abbr}: no ATD market posted yet.`);
      continue;
    }
    const props: Record<string, LivePlayer & { name: string }> = {};
    for (const [k, p] of Object.entries(byPlayer)) {
      const prices = Object.values(p.books);
      const best = Math.max(...prices);
      const consensus = median(prices)!;
      props[k] = {
        name: p.name,
        best,
        bestBook: Object.entries(p.books).find(([, v]) => v === best)?.[0],
        consensus,
        books: p.books,
        implied: +impliedProb(consensus)!.toFixed(4),
        open: null,
        move: null,
        fetchedAt: new Date().toISOString(),
      };
    }
    const attach = (p: Pick): Pick => {
      const lp = props[normName(p.name)];
      const open = p.live?.open ?? p.live?.consensus ?? null;
      return lp
        ? {
            ...p,
            live: { ...lp, open, move: open != null ? lp.consensus - open : null },
            edge: +(p.est - lp.implied).toFixed(3),
          }
        : { ...p, live: null };
    };
    updated.set(g.id, {
      ...g,
      top3: g.top3.map(attach),
      value: g.value.map(attach),
      atdBoard: g.atdBoard.map((b) => {
        const lp = props[normName(b.name)];
        return {
          ...b,
          live: lp ? { best: lp.best, bestBook: lp.bestBook, consensus: lp.consensus } : null,
        };
      }),
      liveBoard: Object.values(props)
        .map((p) => ({
          name: p.name,
          best: p.best,
          bestBook: p.bestBook,
          consensus: p.consensus,
          implied: p.implied,
        }))
        .sort((a, b) => a.consensus - b.consensus)
        .slice(0, 16),
      pulls: { ...(g.pulls ?? {}), manual: new Date().toISOString() },
    });
  }
  const games = base.games.map((g) => updated.get(g.id) ?? g);
  const all = games.flatMap((g) =>
    [...g.top3, ...g.value].map((p) => ({ ...p, gameId: g.id, kickoff: g.kickoff })),
  );
  const next: Board = {
    ...base,
    games,
    oddsFetchedAt: propsFetched ? new Date().toISOString() : base.oddsFetchedAt,
    oddsCredits: { ...(base.oddsCredits ?? { used: null }), remaining: creditsRemaining, reserve },
    slateTop: [...all].sort((a, b) => b.est - a.est).slice(0, 20),
    slateValue: all
      .filter((p) => p.edge != null)
      .sort((a, b) => (b.edge ?? 0) - (a.edge ?? 0))
      .slice(0, 12),
  };
  return { board: next, creditsRemaining, propsFetched, errors };
}
