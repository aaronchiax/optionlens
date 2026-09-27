// Black-Scholes-Merton pricing, Greeks, implied-vol solver and lognormal probabilities.
// European formulas are used as an approximation for US-listed (American) equity options.

export type OptionType = "call" | "put";

export const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/** Standard normal CDF (Abramowitz & Stegun 7.1.26, |err| < 1.5e-7). */
export function normCdf(x: number): number {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + p * z);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-z * z);
  return 0.5 * (1 + sign * y);
}

export interface BSInput {
  S: number;
  K: number;
  /** years to expiry */
  T: number;
  r: number;
  q: number;
  sigma: number;
  type: OptionType;
}

export function intrinsic(type: OptionType, S: number, K: number): number {
  return type === "call" ? Math.max(S - K, 0) : Math.max(K - S, 0);
}

function d1d2({ S, K, T, r, q, sigma }: BSInput) {
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  return { d1, d2: d1 - sigma * sqrtT, sqrtT };
}

export function bsPrice(inp: BSInput): number {
  const { S, K, T, r, q, sigma, type } = inp;
  if (T <= 0 || sigma <= 0) return intrinsic(type, S, K);
  if (S <= 0) return type === "call" ? 0 : K * Math.exp(-r * T);
  const { d1, d2 } = d1d2(inp);
  if (type === "call") return S * Math.exp(-q * T) * normCdf(d1) - K * Math.exp(-r * T) * normCdf(d2);
  return K * Math.exp(-r * T) * normCdf(-d2) - S * Math.exp(-q * T) * normCdf(-d1);
}

export interface Greeks {
  /** per share, per $1 move */
  delta: number;
  /** change in delta per $1 move */
  gamma: number;
  /** $ per share per calendar day */
  theta: number;
  /** $ per share per 1 vol point (0.01) */
  vega: number;
}

export function bsGreeks(inp: BSInput): Greeks {
  const { S, K, T, r, q, sigma, type } = inp;
  if (T <= 0 || sigma <= 0 || S <= 0) {
    const itm = type === "call" ? S > K : S < K;
    return { delta: itm ? (type === "call" ? 1 : -1) : 0, gamma: 0, theta: 0, vega: 0 };
  }
  const { d1, d2, sqrtT } = d1d2(inp);
  const eq = Math.exp(-q * T);
  const er = Math.exp(-r * T);
  const pdf = normPdf(d1);
  const gamma = (eq * pdf) / (S * sigma * sqrtT);
  const vega = (S * eq * pdf * sqrtT) / 100;
  const decay = (-S * eq * pdf * sigma) / (2 * sqrtT);
  if (type === "call") {
    return {
      delta: eq * normCdf(d1),
      gamma,
      vega,
      theta: (decay - r * K * er * normCdf(d2) + q * S * eq * normCdf(d1)) / 365,
    };
  }
  return {
    delta: -eq * normCdf(-d1),
    gamma,
    vega,
    theta: (decay + r * K * er * normCdf(-d2) - q * S * eq * normCdf(-d1)) / 365,
  };
}

/** Solve implied volatility by bisection. Returns null if the price is outside no-arbitrage bounds. */
export function impliedVol(price: number, base: Omit<BSInput, "sigma">): number | null {
  const { S, K, T, r, q, type } = base;
  if (!(price > 0) || T <= 0 || S <= 0) return null;
  const lower = type === "call" ? Math.max(0, S * Math.exp(-q * T) - K * Math.exp(-r * T)) : Math.max(0, K * Math.exp(-r * T) - S * Math.exp(-q * T));
  const upper = type === "call" ? S * Math.exp(-q * T) : K * Math.exp(-r * T);
  if (price <= lower + 1e-6 || price >= upper) return null;
  let lo = 0.001, hi = 6;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    const p = bsPrice({ ...base, sigma: mid });
    if (p > price) hi = mid;
    else lo = mid;
    if (hi - lo < 1e-6) break;
  }
  return (lo + hi) / 2;
}

/**
 * Risk-neutral lognormal CDF: P(S_T <= x) given spot S, vol sigma, T years.
 */
export function lognormalCdf(x: number, S: number, sigma: number, T: number, r: number, q: number): number {
  if (x <= 0) return 0;
  if (!Number.isFinite(x)) return 1;
  if (T <= 0 || sigma <= 0) return S <= x ? 1 : 0;
  const z = (Math.log(x / S) - (r - q - 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  return normCdf(z);
}

/** One-standard-deviation expected move in $ over T years. */
export function expectedMove(S: number, sigma: number, T: number): number {
  return S * sigma * Math.sqrt(Math.max(T, 0));
}
