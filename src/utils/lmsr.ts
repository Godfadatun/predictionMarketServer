// Logarithmic Market Scoring Rule (Hanson). q = outstanding shares per outcome, b = liquidity.
// Cost and prices are in "payout units" (1 unit = what one winning share pays). Max house loss = b·ln(n).

const logSumExp = (xs: number[]): number => {
  const m = Math.max(...xs);
  return m + Math.log(xs.reduce((s, x) => s + Math.exp(x - m), 0));
};

export const cost = (q: number[], b: number): number => b * logSumExp(q.map((x) => x / b));

export const prices = (q: number[], b: number): number[] => {
  const c = logSumExp(q.map((x) => x / b));
  return q.map((x) => Math.exp(x / b - c));
};

export const maxLoss = (n: number, b: number): number => b * Math.log(n);

// Shares of outcome i that `spend` payout-units buys: solves cost(q + s·e_i) − cost(q) = spend.
export const sharesForSpend = (q: number[], b: number, i: number, spend: number): number => {
  const target = cost(q, b) + spend;
  const others = q.filter((_, j) => j !== i).map((x) => x / b);
  const m = Math.max(target / b, ...others);
  const rest = others.reduce((s, x) => s + Math.exp(x - m), 0);
  const newQi = b * (m + Math.log(Math.exp(target / b - m) - rest));
  return newQi - q[i];
};

// Payout-units returned for selling `shares` of outcome i.
export const proceedsForSale = (q: number[], b: number, i: number, shares: number): number => {
  const after = q.map((x, j) => (j === i ? x - shares : x));
  return cost(q, b) - cost(after, b);
};
