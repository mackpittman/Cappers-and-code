// Parlay builder. Turns the board's model numbers (TD estimates, projected scores, confidence) and
// the FanDuel / DraftKings prices into ranked parlays per category. Pure function, no I/O, so it
// runs inside build-board.mjs and in the unit tests.
//
// Pricing rules: a leg is priced at the better of FanDuel and DraftKings only (BOOKS below). A leg
// with no FD/DK price is skipped. Cross-game legs are treated as independent; same-game legs get a
// small correlation factor. 2+ TD props have no API market, so the builder publishes the model's
// fair price and the minimum price that still carries edge; the book price is checked by hand.

export const BOOKS = ['fanduel', 'draftkings'];
const BOOK_LABEL = { fanduel: 'FD', draftkings: 'DK' };
const SIGMA_MARGIN = 13.5; // NFL point-margin standard deviation
const SIGMA_TOTAL = 13.5;
const CONF_PROB = { 1: 0.52, 2: 0.55, 3: 0.58, 4: 0.62 }; // what a Locked In confidence grade claims
const STD_PRICE = -110; // FD/DK standard side and total price

export const toDecimal = (a) => (a > 0 ? 1 + a / 100 : 1 + 100 / -a);
export const toAmerican = (d) => (d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1)));
export const impliedFromAmerican = (a) => (a > 0 ? 100 / (a + 100) : -a / (-a + 100));
export const fairAmerican = (p) => toAmerican(1 / p);
/** Standard normal CDF (Abramowitz-Stegun 7.1.26). */
export function phi(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p =
    d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}
/** P(2+ TD) from the anytime probability, Poisson scoring: lambda = -ln(1-p). */
export function twoPlusProb(pAny) {
  if (pAny <= 0) return 0;
  if (pAny >= 0.999) return 0.999;
  const lambda = -Math.log(1 - pAny);
  return 1 - Math.exp(-lambda) * (1 + lambda);
}

const isFinal = (g) => /FINAL/i.test(g.status?.state ?? '');
const gameLabel = (g) => `${g.away.abbr}@${g.home.abbr}`;
const round = (x, d = 3) => +x.toFixed(d);

/** Better of FD/DK for a live price map; null when neither book posted it. */
export function bookPrice(books) {
  if (!books) return null;
  let best = null;
  for (const b of BOOKS) {
    const v = books[b];
    if (typeof v !== 'number') continue;
    if (best == null || v > best.price) best = { price: v, book: BOOK_LABEL[b] };
  }
  return best;
}

function combos(items, k) {
  const out = [];
  const rec = (start, acc) => {
    if (acc.length === k) return void out.push(acc);
    for (let i = start; i < items.length; i++) rec(i + 1, [...acc, items[i]]);
  };
  rec(0, []);
  return out;
}
function priceParlay(legs, corr = 1) {
  const dec = legs.reduce((d, l) => d * toDecimal(l.price), 1);
  const prob = Math.min(0.99, legs.reduce((p, l) => p * l.prob, 1) * corr);
  return {
    decimal: round(dec, 3),
    price: toAmerican(dec),
    prob: round(prob),
    ev: round(prob * dec - 1),
  };
}
/** Rank by edge-weighted score (EV times the square root of the hit rate, so pure longshots do not
 *  crowd out playable tickets), then diversify: no leg appears in more than `maxPerLeg` tickets. */
function rank(list, n = 5, maxPerLeg = 2, score = (p) => p.ev * Math.sqrt(p.prob)) {
  const sorted = list
    .map((p) => ({ ...p, score: round(score(p)) }))
    .sort((a, b) => b.score - a.score || b.prob - a.prob);
  const used = new Map();
  const out = [];
  for (const p of sorted) {
    if (out.length === n) break;
    if (p.legs.some((l) => (used.get(l.label) ?? 0) >= maxPerLeg)) continue;
    for (const l of p.legs) used.set(l.label, (used.get(l.label) ?? 0) + 1);
    out.push(p);
  }
  return out.map((p, i) => ({ rank: i + 1, ...p }));
}
function crossGameCombos(legs, sizes, minProb) {
  const out = [];
  for (const k of sizes)
    for (const c of combos(legs, k)) {
      if (new Set(c.map((l) => l.game)).size !== k) continue; // one leg per game
      const priced = priceParlay(c);
      if (priced.prob < minProb) continue;
      out.push({ legs: c, ...priced });
    }
  return out;
}

// ---------- leg extraction ----------
export function atdLegs(board) {
  const legs = [];
  for (const g of board.games) {
    if (isFinal(g)) continue;
    const seen = new Set();
    for (const p of [...(g.top3 ?? []), ...(g.value ?? [])]) {
      if (seen.has(p.name)) continue;
      seen.add(p.name);
      const bp = bookPrice(p.live?.books);
      if (!bp || typeof p.est !== 'number') continue;
      const td2 = bookPrice(p.live2?.books);
      legs.push({
        type: 'atd',
        td2,
        label: `${p.name} anytime TD`,
        player: p.name,
        team: p.team,
        game: g.id,
        gameLabel: gameLabel(g),
        kickoff: g.kickoff,
        prob: p.est,
        price: bp.price,
        book: bp.book,
        implied: round(impliedFromAmerican(bp.price)),
        edge: round(p.est - impliedFromAmerican(bp.price)),
        why: p.why,
      });
    }
  }
  return legs;
}
function parseSide(side) {
  const m = /^([A-Z]{2,3})\s*([+-]?\d+(?:\.\d+)?)$/.exec((side ?? '').trim());
  return m ? { team: m[1], number: Number(m[2]) } : null;
}
function parseTotal(total) {
  const m = /^(Over|Under)\s*(\d+(?:\.\d+)?)$/i.exec((total ?? '').trim());
  return m ? { dir: m[1].toLowerCase(), number: Number(m[2]) } : null;
}
export function sideLegs(board) {
  const legs = [];
  for (const g of board.games) {
    if (isFinal(g) || !g.market) continue;
    const s = parseSide(g.market.side);
    if (!s || !(s.team === g.home.abbr || s.team === g.away.abbr)) continue;
    const proj = g.market.projected;
    const projMargin = s.team === g.home.abbr ? proj.home - proj.away : proj.away - proj.home;
    // Current number from the live line when the book moved it (home spread sign flips for the away side).
    const livePoint = g.live?.spread?.homePoint;
    const number =
      typeof livePoint === 'number' ? (s.team === g.home.abbr ? livePoint : -livePoint) : s.number;
    const pModel = phi((projMargin + number) / SIGMA_MARGIN);
    const prob = round(Math.min(0.66, 0.5 * pModel + 0.5 * (CONF_PROB[g.market.sideConf] ?? 0.52)));
    legs.push({
      type: 'side',
      label: `${s.team} ${number > 0 ? '+' : ''}${number}`,
      team: s.team,
      game: g.id,
      gameLabel: gameLabel(g),
      kickoff: g.kickoff,
      prob,
      price: STD_PRICE,
      book: 'FD/DK',
      implied: round(impliedFromAmerican(STD_PRICE)),
      edge: round(prob - impliedFromAmerican(STD_PRICE)),
      conf: g.market.sideConf,
      moved: number !== s.number ? `model liked ${s.number > 0 ? '+' : ''}${s.number}` : null,
      why: g.market.why,
    });
  }
  return legs;
}
export function totalLegs(board) {
  const legs = [];
  for (const g of board.games) {
    if (isFinal(g) || !g.market) continue;
    const t = parseTotal(g.market.total);
    if (!t) continue;
    const proj = g.market.projected.home + g.market.projected.away;
    const livePoint = g.live?.total?.point;
    const number = typeof livePoint === 'number' ? livePoint : t.number;
    const pOver = phi((proj - number) / SIGMA_TOTAL);
    const pModel = t.dir === 'over' ? pOver : 1 - pOver;
    const prob = round(
      Math.min(0.66, 0.5 * pModel + 0.5 * (CONF_PROB[g.market.totalConf] ?? 0.52)),
    );
    legs.push({
      type: 'total',
      label: `${t.dir === 'over' ? 'Over' : 'Under'} ${number} ${gameLabel(g)}`,
      game: g.id,
      gameLabel: gameLabel(g),
      kickoff: g.kickoff,
      prob,
      price: STD_PRICE,
      book: 'FD/DK',
      implied: round(impliedFromAmerican(STD_PRICE)),
      edge: round(prob - impliedFromAmerican(STD_PRICE)),
      conf: g.market.totalConf,
      moved: number !== t.number ? `model liked ${t.number}` : null,
      why: g.market.why,
    });
  }
  return legs;
}

// ---------- categories ----------
function whyParlay(legs, priced, extra = '') {
  const impliedJoint = legs.reduce((p, l) => p * impliedFromAmerican(l.price), 1);
  return `Model ${Math.round(priced.prob * 100)}% vs ${Math.round(impliedJoint * 100)}% implied at ${priced.price > 0 ? '+' : ''}${priced.price}. ${legs
    .map(
      (l) =>
        `${l.label.replace(' anytime TD', '')}: ${Math.round(l.prob * 100)}% model, ${l.price > 0 ? '+' : ''}${l.price} ${l.book}`,
    )
    .join('; ')}.${extra ? ' ' + extra : ''}`;
}

export function buildParlays(board, opts = {}) {
  const n = opts.perCategory ?? 5;
  const atd = atdLegs(board).filter((l) => l.edge >= -0.03 && l.prob >= 0.3);
  const atdTop = [...atd].sort((a, b) => b.edge - a.edge).slice(0, 14);
  const sides = sideLegs(board).filter((l) => l.conf >= 2);
  const totals = totalLegs(board).filter((l) => l.conf >= 2);

  const anytime = rank(
    crossGameCombos(atdTop, [2, 3], 0.12).map((p) => ({ ...p, why: whyParlay(p.legs, p) })),
    n,
  );

  // 2+ TD props: real FanDuel/DraftKings price when the books post one (player_tds_over at 1.5),
  // otherwise the model's fair price and the minimum playable number.
  const twoPlusAll = atd
    .map((l) => {
      const prob = round(twoPlusProb(l.prob));
      const fair = fairAmerican(prob);
      const minPrice = toAmerican(1.05 / prob); // +5% EV floor
      const book = l.td2 ?? null;
      const priced = !!book;
      const dec = priced ? toDecimal(book.price) : null;
      const ev = priced ? round(prob * dec - 1) : null;
      return {
        legs: [
          {
            ...l,
            type: 'td2',
            label: `${l.player} 2+ TDs`,
            price: priced ? book.price : null,
            book: priced ? book.book : 'check FD/DK',
            prob,
            implied: priced ? round(impliedFromAmerican(book.price)) : undefined,
            edge: priced ? round(prob - impliedFromAmerican(book.price)) : undefined,
          },
        ],
        price: priced ? book.price : null,
        decimal: dec,
        prob,
        fairPrice: fair,
        minPrice,
        ev,
        why: priced
          ? `${book.book} ${book.price > 0 ? '+' : ''}${book.price} vs fair ${fair > 0 ? '+' : ''}${fair} (${Math.round(prob * 100)}% for two or more from a ${Math.round(l.prob * 100)}% anytime estimate). ${ev >= 0 ? 'Priced with edge.' : 'Book price is short of the model; pass or wait for a better number.'} ${l.why}`
          : `${Math.round(l.prob * 100)}% anytime estimate gives ${Math.round(prob * 100)}% for two or more (Poisson). Fair ${fair > 0 ? '+' : ''}${fair}; play at ${minPrice > 0 ? '+' : ''}${minPrice} or better on FD/DK. ${l.why}`,
      };
    })
    .filter((p) => p.prob >= 0.08);
  const twoPlusPriced = rank(
    twoPlusAll.filter((p) => p.price != null && p.ev >= 0),
    n,
    1,
  );
  const twoPlusRest = twoPlusAll
    .filter((p) => p.price == null)
    .sort((a, b) => b.prob - a.prob)
    .slice(0, Math.max(0, n - twoPlusPriced.length));
  const twoPlus = [...twoPlusPriced, ...twoPlusRest].map((p, i) => ({ ...p, rank: i + 1 }));

  const sideParlays = rank(
    crossGameCombos(sides, [2, 3], 0.1).map((p) => ({
      ...p,
      why: whyParlay(
        p.legs,
        p,
        p.legs.some((l) => l.moved)
          ? 'Line moved since the model call: ' +
              p.legs
                .filter((l) => l.moved)
                .map((l) => `${l.label} (${l.moved})`)
                .join(', ') +
              '.'
          : '',
      ),
    })),
    n,
    3,
  );
  const totalParlays = rank(
    crossGameCombos(totals, [2, 3], 0.1).map((p) => ({ ...p, why: whyParlay(p.legs, p) })),
    n,
    3,
  );

  // Same game: model side + the best-priced TD scorer, correlated when the scorer plays for the side.
  const sgp = [];
  for (const g of board.games) {
    const side = sides.find((l) => l.game === g.id);
    if (!side) continue;
    const scorers = atd.filter((l) => l.game === g.id).sort((a, b) => b.edge - a.edge);
    for (const sc of scorers.slice(0, 2)) {
      const corr = sc.team === side.team ? 1.12 : 0.95;
      const legs = [side, sc];
      const priced = priceParlay(legs, corr);
      const researchStack = (g.stacks ?? []).find((s) => s.type === 'sgp');
      sgp.push({
        legs,
        ...priced,
        why: whyParlay(
          legs,
          priced,
          `${sc.team === side.team ? 'Correlated: the side and the scorer ride the same script.' : 'Scorer on the other side of the number; treat as a hedge, not a stack.'} Straight multiplication; FD/DK same-game pricing will differ.${researchStack ? ' Research stack: ' + researchStack.why : ''}`,
        ),
      });
    }
  }
  const sameGame = rank(sgp, n);

  const modelStacks = (board.crossStacks ?? []).slice(0, n).map((s, i) => ({
    rank: i + 1,
    legs: s.legs.map((label) => ({ type: 'text', label, price: null, book: '', prob: null })),
    price: null,
    decimal: null,
    prob: null,
    ev: null,
    why: s.why,
  }));

  const stale = board.oddsFetchedAt
    ? Date.now() - Date.parse(board.oddsFetchedAt) > 36 * 3600000
    : true;
  return {
    builtAt: new Date().toISOString(),
    books: BOOKS.map((b) => BOOK_LABEL[b]),
    oddsFetchedAt: board.oddsFetchedAt ?? null,
    note: stale
      ? 'TD prices are more than 36 hours old; re-check FD/DK before betting.'
      : 'Prices are the better of FanDuel and DraftKings at the last pull.',
    categories: [
      {
        key: 'anytime',
        title: 'Anytime TD parlays',
        note: 'Cross-game, one scorer per game, ranked by expected value.',
        parlays: anytime,
      },
      {
        key: 'twoPlus',
        title: '2+ TD props',
        note: twoPlus.some((t) => t.price != null)
          ? 'Real FD/DK 2+ TD prices vs the model fair price. Unpriced players show fair and minimum playable price.'
          : 'Model probability and fair price. No 2+ TD market pulled yet: confirm the FD/DK price before betting.',
        parlays: twoPlus,
      },
      {
        key: 'sides',
        title: 'Locked In sides',
        note: 'Model sides at -110, confidence 2 or higher, current numbers.',
        parlays: sideParlays,
      },
      {
        key: 'totals',
        title: 'Totals',
        note: 'Model totals at -110, confidence 2 or higher, current numbers.',
        parlays: totalParlays,
      },
      {
        key: 'sameGame',
        title: 'Same-game stacks',
        note: 'Side plus scorer in one game. Book SGP pricing differs from straight multiplication.',
        parlays: sameGame,
      },
      {
        key: 'model',
        title: 'Trust the Code stacks',
        note: 'The research desk’s cross-game builds, in its own order.',
        parlays: modelStacks,
      },
    ],
  };
}
