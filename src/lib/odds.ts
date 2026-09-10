// Odds math and The Odds API client used inside the app for on-demand price refreshes.
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

export type RefreshResult = {
  board: Board;
  creditsRemaining: number | null;
  propsFetched: number;
  errors: string[];
};

/** Refresh game lines and anytime-TD props straight from The Odds API and merge into the board. */
export async function refreshFromOddsApi(
  board: Board,
  apiKey: string,
  opts: { region?: string; daysAhead?: number } = {},
): Promise<RefreshResult> {
  const region = opts.region ?? 'us';
  const daysAhead = opts.daysAhead ?? 4;
  const errors: string[] = [];
  let creditsRemaining: number | null = null;
  const note = (r: Response) => {
    const v = r.headers.get('x-requests-remaining');
    if (v != null) creditsRemaining = Number(v);
  };
  const linesRes = await fetch(
    `${BASE}/sports/${SPORT}/odds?apiKey=${apiKey}&regions=${region}&markets=h2h,spreads,totals&oddsFormat=american`,
  );
  if (!linesRes.ok) {
    const txt = await linesRes.text();
    throw new Error(`Odds API ${linesRes.status}: ${txt.slice(0, 160)}`);
  }
  note(linesRes);
  const events = (await linesRes.json()) as any[];
  const now = new Date().toISOString();
  const horizon = Date.now() + daysAhead * 86400000;
  let propsFetched = 0;
  const games: Game[] = [];
  for (const g of board.games) {
    const ev = events.find(
      (e) => TEAM_BY_NAME[e.home_team] === g.home.abbr && TEAM_BY_NAME[e.away_team] === g.away.abbr,
    );
    if (!ev) {
      games.push(g);
      continue;
    }
    const ml = { home: [] as number[], away: [] as number[] },
      sp = { home: [] as number[], away: [] as number[] },
      pts: number[] = [],
      tot = { over: [] as number[], under: [] as number[] },
      tp: number[] = [];
    for (const b of ev.bookmakers ?? [])
      for (const m of b.markets ?? [])
        for (const o of m.outcomes ?? []) {
          if (m.key === 'h2h') (o.name === ev.home_team ? ml.home : ml.away).push(o.price);
          if (m.key === 'spreads') {
            (o.name === ev.home_team ? sp.home : sp.away).push(o.price);
            if (o.name === ev.home_team) pts.push(o.point);
          }
          if (m.key === 'totals') {
            (o.name === 'Over' ? tot.over : tot.under).push(o.price);
            if (o.name === 'Over') tp.push(o.point);
          }
        }
    const mlAway = median(ml.away),
      mlHome = median(ml.home);
    const d = devig(mlAway, mlHome);
    const live = {
      fetchedAt: now,
      ml: {
        home: mlHome,
        away: mlAway,
        bestHome: ml.home.length ? Math.max(...ml.home) : null,
        bestAway: ml.away.length ? Math.max(...ml.away) : null,
      },
      spread: { homePoint: median(pts), homePrice: median(sp.home), awayPrice: median(sp.away) },
      total: { point: median(tp), over: median(tot.over), under: median(tot.under) },
      winProb: d ? { away: +d.a.toFixed(3), home: +d.b.toFixed(3) } : null,
    };
    let props: Record<string, LivePlayer & { name: string }> = {};
    const t = Date.parse(ev.commence_time);
    if (t <= horizon && t > Date.now() - 6 * 3600000) {
      try {
        const pr = await fetch(
          `${BASE}/sports/${SPORT}/events/${ev.id}/odds?apiKey=${apiKey}&regions=${region}&markets=player_anytime_td&oddsFormat=american`,
        );
        if (pr.ok) {
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
            };
          }
        } else errors.push(`${g.away.abbr}@${g.home.abbr} props ${pr.status}`);
      } catch (e: any) {
        errors.push(`${g.away.abbr}@${g.home.abbr}: ${e.message}`);
      }
    }
    const hasProps = Object.keys(props).length > 0;
    const attach = (p: Pick): Pick => {
      const lp = props[normName(p.name)];
      if (!hasProps) return p;
      const prevOpen = p.live?.open ?? p.live?.consensus ?? null;
      return lp
        ? {
            ...p,
            live: {
              ...lp,
              open: prevOpen,
              move: prevOpen != null ? lp.consensus - prevOpen : null,
            },
            edge: +(p.est - lp.implied).toFixed(3),
          }
        : { ...p, live: null };
    };
    games.push({
      ...g,
      live,
      top3: g.top3.map(attach),
      value: g.value.map(attach),
      atdBoard: g.atdBoard.map((b) => {
        const lp = props[normName(b.name)];
        return hasProps
          ? {
              ...b,
              live: lp ? { best: lp.best, bestBook: lp.bestBook, consensus: lp.consensus } : null,
            }
          : b;
      }),
      liveBoard: hasProps
        ? Object.values(props)
            .map((p) => ({
              name: p.name,
              best: p.best,
              bestBook: p.bestBook,
              consensus: p.consensus,
              implied: p.implied,
            }))
            .sort((a, b) => a.consensus - b.consensus)
            .slice(0, 16)
        : g.liveBoard,
    });
  }
  const all = games.flatMap((g) =>
    [...g.top3, ...g.value].map((p) => ({ ...p, gameId: g.id, kickoff: g.kickoff })),
  );
  const next: Board = {
    ...board,
    games,
    oddsFetchedAt: now,
    oddsCredits: { remaining: creditsRemaining, used: null },
    slateTop: [...all].sort((a, b) => b.est - a.est).slice(0, 20),
    slateValue: all
      .filter((p) => p.edge != null)
      .sort((a, b) => (b.edge ?? 0) - (a.edge ?? 0))
      .slice(0, 12),
  };
  return { board: next, creditsRemaining, propsFetched, errors };
}
