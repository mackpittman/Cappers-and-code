// Prices a baseball parlay honestly, which means two things the naive version gets wrong.
//
// 1. A PUSH does not lose the parlay, it removes the leg. A whole-number total pushes about one
//    time in ten, so a ticket with two of them reduces to fewer legs roughly a fifth of the time
//    and pays out at the shorter price. Multiplying win probabilities and multiplying decimal odds
//    both ignore that, and the two errors do not cancel: the probability of a return is understated
//    while the size of the return is overstated. This enumerates every win/push/lose combination
//    and builds the actual payout distribution.
//
// 2. LEGS IN THE SAME GAME ARE NOT INDEPENDENT. Multiplying two Coors legs together prices a
//    correlation that does not exist. Legs are grouped by game and a same-game group is refused
//    unless its joint probability was supplied from the game's own run distribution.
import { payout, impliedProb } from './mlb-model.mjs';

/** Every combination of per-leg outcomes, with its probability and its payout multiple. */
export function outcomes(legs) {
  let states = [{ p: 1, dec: 1, alive: true, detail: [] }];
  for (const l of legs) {
    const win = l.prob;
    const push = l.push ?? 0;
    const lose = Math.max(0, 1 - win - push);
    const next = [];
    for (const s of states) {
      // Won: the leg's price multiplies into the ticket.
      next.push({
        p: s.p * win,
        dec: s.dec * (1 + payout(l.price)),
        alive: s.alive,
        detail: [...s.detail, 'win'],
      });
      // Pushed: the leg is voided and the ticket pays as if it were never on it.
      if (push > 0)
        next.push({ p: s.p * push, dec: s.dec, alive: s.alive, detail: [...s.detail, 'push'] });
      // Lost: the ticket is dead, but carry it so the probabilities still sum to one.
      if (lose > 0)
        next.push({ p: s.p * lose, dec: s.dec, alive: false, detail: [...s.detail, 'lose'] });
    }
    states = next;
  }
  return states;
}

/**
 * Price a ticket. `stake` is the money at risk; returns are gross (stake included) so the numbers
 * match what a slip shows.
 */
export function priceTicket(legs, stake = 100) {
  const states = outcomes(legs);
  const live = states.filter((s) => s.alive);
  const pAny = live.reduce((s, x) => s + x.p, 0); // chance of any return at all
  const pFull = live.filter((s) => !s.detail.includes('push')).reduce((s, x) => s + x.p, 0);
  const evReturn = live.reduce((s, x) => s + x.p * x.dec * stake, 0);
  const allWin = legs.reduce((d, l) => d * (1 + payout(l.price)), 1);
  // The book's own number: what it would show on the slip if nothing pushes.
  const american = allWin >= 2 ? Math.round((allWin - 1) * 100) : Math.round(-100 / (allWin - 1));
  // Break-even is read off the posted price; the model's number is the chance of a full win.
  return {
    legs: legs.length,
    stake,
    decimal: +allWin.toFixed(3),
    american,
    toWin: +((allWin - 1) * stake).toFixed(2),
    payout: +(allWin * stake).toFixed(2),
    modelWinAll: +pFull.toFixed(4),
    modelAnyReturn: +pAny.toFixed(4),
    breakEven: +(1 / allWin).toFixed(4),
    expectedReturn: +evReturn.toFixed(2),
    ev: +(evReturn / stake - 1).toFixed(4),
    // What the ticket looks like if you assume no pushes, which is what a naive pricer reports.
    naiveWinAll: +legs.reduce((p, l) => p * (l.prob + (l.push ?? 0) * 0), 1).toFixed(4),
  };
}

/** Refuse a ticket that multiplies two legs from the same game together. */
export function checkIndependence(legs) {
  const seen = new Map();
  const clashes = [];
  for (const l of legs) {
    if (seen.has(l.game)) clashes.push(`${seen.get(l.game)} and ${l.key} are both in ${l.game}`);
    seen.set(l.game, l.key);
  }
  return clashes;
}

export { impliedProb, payout };
