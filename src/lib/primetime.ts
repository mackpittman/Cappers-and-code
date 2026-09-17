// The standalone game of the moment: Thursday night, Sunday night or Monday night. The front page
// gives it its own tab with the desk's priced tickets, the builder's same-game parlays and the plays.
import type { Board, Game, Ticket } from './types';
import type { SlipInput } from './slip';
import { toDecimal } from './price';

export type Primetime = { game: Game; key: 'tnf' | 'snf' | 'mnf'; title: string; short: string };

const WINDOWS: Record<string, Omit<Primetime, 'game'>> = {
  tnf: { key: 'tnf', title: 'Thursday Night Football', short: 'Thursday night' },
  snf: { key: 'snf', title: 'Sunday Night Football', short: 'Sunday night' },
  mnf: { key: 'mnf', title: 'Monday Night Football', short: 'Monday night' },
};

function windowOf(kickoffIso?: string): 'tnf' | 'snf' | 'mnf' | null {
  if (!kickoffIso) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(new Date(kickoffIso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const wd = get('weekday');
  const h = Number(get('hour'));
  if (wd === 'Thu') return 'tnf';
  if (wd === 'Mon') return 'mnf';
  if (wd === 'Sun' && h >= 19) return 'snf';
  return null;
}

/** The next standalone game that has not finished (a game counts as over four hours after kickoff), else the last one. */
export function primetimeGame(board: Board, now = Date.now()): Primetime | null {
  const list = board.games
    .map((game) => ({ game, key: windowOf(game.kickoff) }))
    .filter((x): x is { game: Game; key: 'tnf' | 'snf' | 'mnf' } => x.key != null)
    .sort((a, b) => Date.parse(a.game.kickoff) - Date.parse(b.game.kickoff));
  if (!list.length) return null;
  const isOver = (g: Game) =>
    g.status?.state === 'STATUS_FINAL' || Date.parse(g.kickoff) + 4 * 3600000 < now;
  const pick = list.find((x) => !isOver(x.game)) ?? list[list.length - 1];
  return { ...WINDOWS[pick.key], game: pick.game };
}

export const ticketEv = (tk: Ticket): number | null =>
  tk.price != null && tk.prob != null ? tk.prob * toDecimal(tk.price) - 1 : null;

export function ticketToSlip(tk: Ticket, game: Game, source = 'primetime'): SlipInput {
  const gameLabel = `${game.away.abbr}@${game.home.abbr}`;
  const single = tk.legs.length === 1;
  const kind: SlipInput['kind'] =
    tk.kind === 'twoPlus' && single
      ? 'td2'
      : single
        ? tk.kind === 'side'
          ? 'side'
          : tk.kind === 'total'
            ? 'total'
            : 'atd'
        : 'parlay';
  const fmt = (n: number) => (n > 0 ? `+${n}` : `${n}`);
  return {
    kind,
    label: tk.label ?? tk.legs.map((l) => l.label).join(' + '),
    detail:
      tk.kind === 'twoPlus' && tk.minPrice != null
        ? `play ${fmt(tk.minPrice)} or better`
        : tk.kind === 'sgp'
          ? 'same-game parlay, price it at the book'
          : `${tk.kind} ticket`,
    game_id: game.id,
    game_label: gameLabel,
    price: tk.price ?? tk.minPrice ?? null,
    book: tk.book ?? (tk.price != null ? (tk.legs[0]?.book ?? null) : 'check FD/DK'),
    model_prob: tk.prob ?? null,
    legs: single ? null : tk.legs.map((l) => ({ label: l.label, price: l.price, book: l.book })),
    source,
  };
}
