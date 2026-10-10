// "Best of the slate": the front page's lead block. For the next day with games still to play
// (US Eastern), the single best play in each market, drawn from lists the model already ranks
// (top-ten.mjs, the five-leg file, the lottos), plus a Discord-ready text block so the desk can
// alert everyone from one place. Nothing here invents a number: every row is a row from a list
// that already carries its price and the model's probability.
import { impliedProb } from './lib.mjs';

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
const pct = (x) => (x == null ? '' : `${Math.round(x * 100)}%`);

/** Units by market: singles carry the weight, multi-leg tickets are small. */
const UNITS = {
  side: 1,
  total: 1,
  moneyline: 1,
  dog: 0.5,
  atd: 0.5,
  value: 0.5,
  td2: 0.25,
  fiveLeg: 0.25,
  lotto: 0.1,
};

export function buildBestOf(board, now = new Date()) {
  const open = (board.games ?? []).filter(
    (g) => g.kickoff && Date.parse(g.kickoff) > now.getTime() && g.status?.state !== 'STATUS_FINAL',
  );
  if (!open.length) return null;
  const first = open.reduce((a, g) => (Date.parse(g.kickoff) < Date.parse(a.kickoff) ? g : a));
  const day = etDay(first.kickoff);
  const onDay = new Set(open.filter((g) => etDay(g.kickoff) === day).map((g) => g.id));
  const C = Object.fromEntries(
    (board.topTen?.categories ?? []).map((c) => [
      c.key,
      (c.plays ?? []).filter((p) => onDay.has(p.game)),
    ]),
  );
  const plays = [];
  const add = (key, title, p, extra = {}) => {
    if (!p) return;
    plays.push({
      key,
      title,
      game: p.game,
      gameLabel: p.gameLabel,
      kickoff: p.kickoff,
      kickoffLabel: p.kickoff ? etLabel(p.kickoff) : null,
      bet: p.bet,
      price: p.price ?? null,
      prob: p.prob ?? null,
      implied: p.implied ?? (typeof p.price === 'number' ? +impliedProb(p.price).toFixed(3) : null),
      edge: p.edge ?? null,
      conf: p.conf ?? null,
      units: UNITS[key] ?? 0.5,
      why: p.why ?? '',
      ...extra,
    });
  };
  const firstPositive = (xs) => (xs ?? []).find((p) => p.edge == null || p.edge > 0) ?? null;
  // Spread and total: the lists are already confidence-then-probability ordered, positive edges only.
  add('side', 'Spread of the day', C.sides?.[0]);
  const total = C.totals?.[0];
  if (total && (total.conf ?? 0) >= 3) add('total', 'Total of the day', total);
  // Moneyline: the likeliest winner that the model also rates above its price; and the best dog.
  const mlFav = (C.moneyline ?? []).find(
    (p) => p.price != null && p.price < 0 && p.edge != null && p.edge > 0,
  );
  add('moneyline', 'Moneyline lock', mlFav);
  const dog = [...(C.moneyline ?? [])]
    .filter((p) => p.price != null && p.price > 0 && p.edge != null && p.edge > 0.03)
    .sort((a, b) => b.edge - a.edge)[0];
  add('dog', 'Underdog to win', dog);
  // Touchdowns: the likeliest priced scorer, the biggest value, the best-priced 2+.
  add(
    'atd',
    'Anytime TD',
    (C.atd ?? []).find((p) => p.price != null && p.priceNote !== 'verify'),
  );
  const valueTop = (C.value ?? []).find(
    (p) => p.price != null && p.priceNote !== 'verify' && !plays.some((x) => x.bet === p.bet),
  );
  add('value', 'TD value', valueTop);
  const td2 = (C.td2 ?? []).find((p) => p.price != null && p.edge != null && p.edge > 0) ?? null;
  add('td2', '2+ TDs', td2);
  // The five-leg with the best joint hit rate that reaches the target, on this day.
  const five = (board.fiveLeg?.tickets ?? [])
    .filter((t) => onDay.has(t.game) && !t.short)
    .sort((a, b) => b.joint - a.joint)[0];
  if (five)
    plays.push({
      key: 'fiveLeg',
      title: 'Five-leg, no TDs',
      game: five.game,
      gameLabel: five.gameLabel,
      kickoff: five.kickoff,
      kickoffLabel: etLabel(five.kickoff),
      bet: five.legs.map((l) => l.label).join(' + '),
      price: five.price,
      prob: five.joint,
      implied: five.bookJoint,
      edge: +(five.joint - five.bookJoint).toFixed(3),
      conf: null,
      units: UNITS.fiveLeg,
      why: `Volume props at alternate lines one notch under the main number; the model has it ${pct(five.joint)} against the book's ${pct(five.bookJoint)}.`,
      legs: five.legs.map((l) => ({ label: l.label, price: l.price, book: l.book })),
    });
  // The highest-hit-rate lotto whose legs all play on this day.
  const lotto = (board.lottos ?? [])
    .filter(
      (m) =>
        (m.legs ?? []).length &&
        (m.legs ?? []).every((l) =>
          [...onDay].some((id) => {
            const g = board.games.find((x) => x.id === id);
            return g && l.label.startsWith(`${g.away.abbr}@${g.home.abbr}`);
          }),
        ),
    )
    .sort((a, b) => (b.prob ?? 0) - (a.prob ?? 0))[0];
  if (lotto)
    plays.push({
      key: 'lotto',
      title: 'The parlay',
      game: lotto.game,
      gameLabel: lotto.gameLabel,
      kickoff: null,
      kickoffLabel: null,
      bet: lotto.bet,
      price: lotto.price ?? null,
      prob: lotto.prob ?? null,
      implied: lotto.price != null ? +impliedProb(lotto.price).toFixed(3) : null,
      edge:
        lotto.prob != null && lotto.price != null
          ? +(lotto.prob - impliedProb(lotto.price)).toFixed(3)
          : null,
      conf: null,
      units: UNITS.lotto,
      why: lotto.why,
      legs: lotto.legs,
    });

  const title = `${dayTitle(first.kickoff)}: the best of the slate`;
  const lines = [
    `**Cappers & Code · ${dayTitle(first.kickoff)} · Week ${board.week}**`,
    `The model's single best play in every market for ${onDay.size} games. Units, not dollars.`,
    '',
  ];
  for (const p of plays) {
    const head = `**${p.title}:** ${p.key === 'fiveLeg' ? `${p.gameLabel} five-leg` : p.bet}${p.price != null ? ` ${am(p.price)}` : ''} · ${p.units}u`;
    const sub = [
      p.key === 'fiveLeg' || p.key === 'lotto' ? null : p.gameLabel,
      p.kickoffLabel,
      p.prob != null ? `model ${pct(p.prob)}` : null,
      p.implied != null ? `book ${pct(p.implied)}` : null,
    ]
      .filter(Boolean)
      .join(' · ');
    lines.push(head);
    if (p.legs?.length)
      for (const l of p.legs) lines.push(`> ${l.label}${l.price != null ? ` ${am(l.price)}` : ''}`);
    if (sub) lines.push(`_${sub}_`);
    lines.push('');
  }
  lines.push('Full board, every game and the five-leg for each: https://cappersandcode.com/app');
  lines.push('21+. Gamble responsibly. Estimates are opinions, not guarantees.');
  return {
    builtAt: now.toISOString(),
    day,
    title,
    games: onDay.size,
    plays,
    text: lines.join('\n'),
  };
}
