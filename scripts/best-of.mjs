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
  // The lead block only carries plays the model rates above their price: a likely bet at a price
  // that overpays is not a best bet. Spread and total go by the projection's own cover rate.
  const byProb = (xs) =>
    [...(xs ?? [])]
      .filter((p) => p.prob != null && p.edge != null && p.edge > 0)
      .sort((a, b) => b.prob - a.prob);
  add('side', 'Spread of the day', byProb(C.sides)[0]);
  // Totals only when the number is loved: desk confidence 3+, or 62%+ by the projection.
  add(
    'total',
    'Total of the day',
    byProb(C.totals).find((p) => (p.conf ?? 0) >= 3 || p.prob >= 0.62),
  );
  // Moneyline: the likeliest winner that the model also rates above its price; and the best dog.
  const mlFav = (C.moneyline ?? []).find(
    (p) => p.price != null && p.price < 0 && p.edge != null && p.edge > 0,
  );
  add('moneyline', 'Moneyline lock', mlFav);
  const dog = [...(C.moneyline ?? [])]
    .filter((p) => p.price != null && p.price > 0 && p.edge != null && p.edge > 0.03)
    .sort((a, b) => b.edge - a.edge)[0];
  add('dog', 'Underdog to win', dog);
  // Touchdowns: the likeliest scorer whose price the model beats, the biggest gap (a different
  // name), and a posted 2+ price the model beats by two points or more, or nothing.
  const priced = (p) => p.price != null && p.priceNote !== 'verify';
  add(
    'atd',
    'Anytime TD',
    (C.atd ?? []).find((p) => priced(p) && p.edge != null && p.edge >= 0),
  );
  add(
    'value',
    'TD value',
    (C.value ?? []).find((p) => priced(p) && !plays.some((x) => x.bet === p.bet)),
  );
  add(
    'td2',
    '2+ TDs',
    (C.td2 ?? []).find((p) => p.price != null && p.edge != null && p.edge >= 0.02),
  );
  // The five-leg with the best joint hit rate that reaches the target, on this day.
  const five = (board.fiveLeg?.tickets ?? [])
    .filter((t) => onDay.has(t.game) && !t.short && !t.pulled)
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
  // The parlay: the weekend lotto with the best hit rate if every leg plays on this day and it hits
  // 5% of the time or more; otherwise the day's own card (spread, total, moneyline), one leg per
  // game, which is what a member asking "parlay the card" would build anyway.
  const labelOf = (id) => {
    const g = board.games.find((x) => x.id === id);
    return g ? `${g.away.abbr}@${g.home.abbr}` : null;
  };
  const dayLabels = [...onDay].map(labelOf).filter(Boolean);
  const lotto = (board.lottos ?? [])
    .filter(
      (m) =>
        (m.prob ?? 0) >= 0.05 &&
        (m.legs ?? []).length &&
        (m.legs ?? []).every((l) => dayLabels.some((lab) => l.label.startsWith(lab))),
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
  else {
    const card = [];
    for (const p of plays.filter((x) => ['side', 'total', 'moneyline', 'dog'].includes(x.key)))
      if (p.price != null && p.prob != null && !card.some((c) => c.game === p.game)) card.push(p);
    if (card.length >= 2) {
      const dec = card.reduce(
        (d, p) => d * (p.price > 0 ? 1 + p.price / 100 : 1 + 100 / -p.price),
        1,
      );
      const prob = card.reduce((q, p) => q * p.prob, 1);
      const price = dec >= 2 ? Math.round((dec - 1) * 100) : Math.round(-100 / (dec - 1));
      plays.push({
        key: 'lotto',
        title: 'The parlay',
        game: card[0].game,
        gameLabel: `${card.length} games`,
        kickoff: null,
        kickoffLabel: null,
        bet: `The card, ${card.length} legs`,
        price,
        prob: +prob.toFixed(4),
        implied: +(1 / dec).toFixed(4),
        edge: +(prob - 1 / dec).toFixed(4),
        conf: null,
        units: UNITS.fiveLeg, // a ticket that lands a third of the time is not a lottery ticket
        why: `The day's spread, total and moneyline picks parlayed, one leg per game so they land independently: the model has it ${pct(prob)} against the price's ${pct(1 / dec)}.`,
        legs: card.map((p) => ({ label: `${p.gameLabel} ${p.bet}`, price: p.price, book: null })),
      });
    }
  }

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

/**
 * The day's max-confidence five-legs: the full five-leg tickets (no TDs) with the highest joint
 * hit rate, after the morning check. Short tickets and tickets the check pulled stay off; a game
 * already under way stays on until it is final, so members can follow what they bet.
 */
export function buildMaxFive(board, now = new Date(), count = 5) {
  const open = (board.games ?? []).filter(
    (g) => g.kickoff && Date.parse(g.kickoff) > now.getTime() && g.status?.state !== 'STATUS_FINAL',
  );
  if (!open.length) return null;
  const first = open.reduce((a, g) => (Date.parse(g.kickoff) < Date.parse(a.kickoff) ? g : a));
  const day = etDay(first.kickoff);
  const final = new Set(
    (board.games ?? []).filter((g) => g.status?.state === 'STATUS_FINAL').map((g) => g.id),
  );
  const all = (board.fiveLeg?.tickets ?? []).filter(
    (t) => t.kickoff && etDay(t.kickoff) === day && !t.short && !final.has(t.game),
  );
  const pulled = all
    .filter((t) => t.pulled)
    .map((t) => ({ game: t.game, gameLabel: t.gameLabel, reason: t.pulled }));
  const tickets = all
    .filter((t) => !t.pulled)
    .sort((a, b) => b.joint - a.joint)
    .slice(0, count)
    .map((t, i) => ({
      rank: i + 1,
      game: t.game,
      gameLabel: t.gameLabel,
      kickoff: t.kickoff,
      kickoffLabel: etLabel(t.kickoff),
      price: t.price,
      joint: t.joint,
      bookJoint: t.bookJoint,
      check: t.check ?? null,
      legs: t.legs.map((l) => ({ label: l.label, price: l.price, book: l.book, p: l.p })),
    }));
  if (!tickets.length) return null;
  const title = `${dayTitle(first.kickoff)}: max-confidence five-legs`;
  const lines = [
    `**Cappers & Code · ${dayTitle(first.kickoff)} · Week ${board.week}**`,
    `**Max-confidence five-legs, no TDs.** ${tickets.length === 1 ? 'The ticket' : `The ${tickets.length} tickets`} with the best hit rate on the slate, every leg checked before kickoff. 0.25u each.`,
    '',
  ];
  for (const t of tickets) {
    lines.push(
      `**${t.rank}. ${t.gameLabel} ${am(t.price)}** · model ${pct(t.joint)} · book ${pct(t.bookJoint)}`,
    );
    for (const l of t.legs) lines.push(`> ${l.label} ${am(l.price)}`);
    lines.push(`_${t.kickoffLabel}_`);
    lines.push('');
  }
  lines.push('Every ticket, on every game page: https://cappersandcode.com/app');
  lines.push('21+. Gamble responsibly. Estimates are opinions, not guarantees.');
  return {
    builtAt: now.toISOString(),
    checkedAt: board.fiveLeg?.checkedAt ?? null,
    pricedAt: board.fiveLeg?.pricedAt ?? null,
    day,
    title,
    tickets,
    pulled,
    text: lines.join('\n'),
  };
}
