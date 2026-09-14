// Odds arithmetic and formatting, with no React and no JSX so it can be unit tested directly.
export const toDecimal = (a: number) => (a > 0 ? 1 + a / 100 : 1 + 100 / -a);
export const toAmerican = (d: number) =>
  d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1));
/** Profit on one unit risked: +1400 pays 14, -110 pays 0.909. */
export const toWin = (a: number) => toDecimal(a) - 1;
export const fmtPrice = (n: number | null | undefined) =>
  n == null ? '—' : n > 0 ? `+${n}` : `${n}`;
