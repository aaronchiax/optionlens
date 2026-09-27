// Position model: legs, payoff/valuation, and the full metrics set (max P/L, breakevens,
// probability of profit, capital, Greeks, liquidity) for any combination of legs.

import { bsGreeks, bsPrice, intrinsic, lognormalCdf, type OptionType, YEAR_MS } from "./math";
import { expirationMs, type OptionContract, type PricingContext } from "./chain";

export const MULTIPLIER = 100;

export type Instrument = OptionType | "stock";
export type Action = "buy" | "sell";

export interface Leg {
  id: string;
  instrument: Instrument;
  action: Action;
  /** contracts for options, shares for stock */
  quantity: number;
  strike?: number;
  expiration?: string;
  /** entry price per share (option premium, or stock entry price) */
  premium: number;
  iv?: number;
  contract?: Pick<OptionContract, "contractSymbol" | "bid" | "ask" | "openInterest" | "volume" | "premiumSource" | "spreadPct" | "ivSource">;
}

export type CapitalBasis = "net-debit" | "max-loss" | "estimated-margin";

export interface PositionMetrics {
  netPremium: number; // + debit paid, - credit received (total $)
  maxProfit: number; // Infinity if unlimited
  maxLoss: number; // positive number; Infinity if unlimited
  breakevens: number[];
  capital: number;
  capitalBasis: CapitalBasis;
  returnOnCapital: number | null; // maxProfit / capital; Infinity if unlimited
  pnlAtTarget: number;
  returnAtTarget: number | null;
  riskReward: number | null; // reward per $1 risked
  pop: number | null;
  probTarget: number | null;
  sigma: number;
  evalExpiration: string | null;
  daysToEval: number;
  sameExpiration: boolean;
  greeks: { delta: number; gamma: number; theta: number; vega: number };
  liquidity: { roundTripCost: number; worstSpreadPct: number | null; minOpenInterest: number | null; usesLastPrices: boolean };
}

export const sign = (a: Action) => (a === "buy" ? 1 : -1);
export const units = (l: Leg) => (l.instrument === "stock" ? l.quantity : l.quantity * MULTIPLIER);
export const optionLegs = (legs: Leg[]) => legs.filter((l) => l.instrument !== "stock");

export function earliestExpiration(legs: Leg[]): string | null {
  const exps = optionLegs(legs).map((l) => l.expiration!).filter(Boolean).sort();
  return exps[0] ?? null;
}

/** Net premium in $ (positive = debit). */
export function netPremium(legs: Leg[]): number {
  return legs.reduce((a, l) => a + sign(l.action) * units(l) * l.premium, 0);
}

/**
 * P/L of the position if the underlying is at `S` at time `atMs`.
 * Options expiring on/before atMs are at intrinsic; later ones are valued with Black-Scholes.
 */
export function pnlAt(legs: Leg[], S: number, atMs: number, ctx: PricingContext, fallbackIv = 0.4): number {
  let total = 0;
  for (const l of legs) {
    let value: number;
    if (l.instrument === "stock") value = S;
    else {
      const T = Math.max((expirationMs(l.expiration!) - atMs) / YEAR_MS, 0);
      value = T <= 1e-9 ? intrinsic(l.instrument, S, l.strike!) : bsPrice({ S, K: l.strike!, T, r: ctx.r, q: ctx.q, sigma: l.iv ?? fallbackIv, type: l.instrument });
    }
    total += sign(l.action) * units(l) * (value - l.premium);
  }
  return total;
}

/** P/L at the earliest option expiration (the classic "payoff at expiration"). */
export function pnlAtExpiry(legs: Leg[], S: number, ctx: PricingContext): number {
  const e = earliestExpiration(legs);
  return pnlAt(legs, S, e ? expirationMs(e) : ctx.now, ctx);
}

export function positionGreeks(legs: Leg[], ctx: PricingContext) {
  const g = { delta: 0, gamma: 0, theta: 0, vega: 0 };
  for (const l of legs) {
    const k = sign(l.action) * units(l);
    if (l.instrument === "stock") {
      g.delta += k;
      continue;
    }
    const T = Math.max((expirationMs(l.expiration!) - ctx.now) / YEAR_MS, 0);
    const x = bsGreeks({ S: ctx.spot, K: l.strike!, T, r: ctx.r, q: ctx.q, sigma: l.iv ?? 0.4, type: l.instrument });
    g.delta += k * x.delta;
    g.gamma += k * x.gamma;
    g.theta += k * x.theta;
    g.vega += k * x.vega;
  }
  return g;
}

/** Rough Reg-T style margin for naked short options (for undefined-risk structures). Clearly an estimate. */
export function estimatedMargin(legs: Leg[], spot: number): number {
  const shorts = optionLegs(legs).filter((l) => l.action === "sell");
  const reqs = shorts.map((l) => {
    const otm = l.instrument === "call" ? Math.max(l.strike! - spot, 0) : Math.max(spot - l.strike!, 0);
    const base = Math.max(0.2 * spot - otm, 0.1 * (l.instrument === "call" ? spot : l.strike!));
    return (base + l.premium) * units(l);
  });
  if (!reqs.length) return 0;
  const maxReq = Math.max(...reqs);
  const idx = reqs.indexOf(maxReq);
  const otherPremiums = shorts.reduce((a, l, i) => (i === idx ? a : a + l.premium * units(l)), 0);
  const debitLegs = legs.filter((l) => l.action === "buy").reduce((a, l) => a + l.premium * units(l), 0);
  return maxReq + otherPremiums + debitLegs;
}

export interface AnalyzeOptions {
  target: number;
  /** vol used for probability calculations; defaults to average leg IV */
  sigma?: number;
}

export function analyzePosition(legs: Leg[], ctx: PricingContext, opts: AnalyzeOptions): PositionMetrics {
  const exp = earliestExpiration(legs);
  const evalMs = exp ? expirationMs(exp) : ctx.now + 30 * 86_400_000;
  const T = Math.max((evalMs - ctx.now) / YEAR_MS, 1 / (365 * 24));
  const opts_ = optionLegs(legs);
  const sameExpiration = new Set(opts_.map((l) => l.expiration)).size <= 1;
  const ivs = opts_.map((l) => l.iv).filter((v): v is number => typeof v === "number");
  const sigma = opts.sigma ?? (ivs.length ? ivs.reduce((a, b) => a + b, 0) / ivs.length : 0.4);

  const pnl = (S: number) => pnlAt(legs, S, evalMs, ctx);
  const strikes = opts_.map((l) => l.strike!);
  const hi = Math.max(ctx.spot * 4, ...strikes.map((k) => k * 2), opts.target * 2);

  // Evaluation grid: breakpoints (strikes) + dense sampling.
  const N = 1600;
  const grid = new Set<number>([0, ctx.spot, ...strikes]);
  for (let i = 0; i <= N; i++) grid.add((hi * i) / N);
  const xs = [...grid].sort((a, b) => a - b);
  const ys = xs.map(pnl);

  // Unbounded tails: slope at the top end of the grid.
  const upSlope = sameExpiration
    ? legs.reduce((a, l) => a + (l.instrument === "put" ? 0 : sign(l.action) * units(l)), 0)
    : (ys[ys.length - 1] - ys[ys.length - 2]) / (xs[xs.length - 1] - xs[xs.length - 2]);
  const eps = 1e-6;
  let maxProfit = Math.max(...ys);
  let minPnl = Math.min(...ys);
  if (upSlope > eps) maxProfit = Infinity;
  if (upSlope < -eps) minPnl = -Infinity;
  const maxLoss = minPnl >= 0 ? 0 : -minPnl;

  // Breakevens: sign changes, refined by bisection.
  const breakevens: number[] = [];
  for (let i = 1; i < xs.length; i++) {
    const a = ys[i - 1], b = ys[i];
    if (Math.abs(b) < 1e-9 && Math.abs(a) > 1e-9) {
      // exact zero on a grid point: only count if the sign actually changes afterwards
      const c = ys[i + 1];
      if (c !== undefined && Math.sign(c) !== Math.sign(a) && Math.abs(c) > 1e-9) breakevens.push(xs[i]);
      continue;
    }
    if (a * b < 0) {
      let lo = xs[i - 1], hiX = xs[i];
      for (let k = 0; k < 50; k++) {
        const m = (lo + hiX) / 2;
        if (pnl(m) * a > 0) lo = m;
        else hiX = m;
      }
      breakevens.push((lo + hiX) / 2);
    }
  }
  const bes = breakevens.filter((v, i, arr) => i === 0 || Math.abs(v - arr[i - 1]) > 0.005);

  // Probability of profit under a risk-neutral lognormal distribution.
  const cdf = (x: number) => lognormalCdf(x, ctx.spot, sigma, T, ctx.r, ctx.q);
  let pop = 0;
  const edges = [0, ...bes, Infinity];
  for (let i = 0; i < edges.length - 1; i++) {
    const a = edges[i], b = edges[i + 1];
    const mid = b === Infinity ? Math.max(a * 1.2, a + 1) : (a + b) / 2;
    if (pnl(mid) > 0) pop += cdf(b) - cdf(a);
  }

  const np = netPremium(legs);
  let capital: number;
  let capitalBasis: CapitalBasis;
  if (maxLoss === Infinity) {
    capital = estimatedMargin(legs, ctx.spot);
    capitalBasis = "estimated-margin";
  } else if (np > 0 && Math.abs(np - maxLoss) < 0.5) {
    capital = np;
    capitalBasis = "net-debit";
  } else {
    capital = Math.max(maxLoss, np);
    capitalBasis = "max-loss";
  }

  const pnlAtTarget = pnl(opts.target);
  const up = opts.target >= ctx.spot;
  const probTarget = up ? 1 - cdf(opts.target) : cdf(opts.target);

  // Liquidity
  let roundTripCost = 0;
  let worstSpreadPct: number | null = null;
  let minOI: number | null = null;
  let usesLast = false;
  for (const l of opts_) {
    if (!l.contract) continue;
    const c = l.contract;
    if (c.bid > 0 && c.ask > 0) roundTripCost += (c.ask - c.bid) * units(l);
    if (c.spreadPct !== null && c.spreadPct !== undefined) worstSpreadPct = Math.max(worstSpreadPct ?? 0, c.spreadPct);
    minOI = minOI === null ? c.openInterest : Math.min(minOI, c.openInterest);
    if (c.premiumSource !== "mid") usesLast = true;
  }

  return {
    netPremium: np,
    maxProfit,
    maxLoss,
    breakevens: bes,
    capital,
    capitalBasis,
    returnOnCapital: capital > 0 ? maxProfit / capital : null,
    pnlAtTarget,
    returnAtTarget: capital > 0 ? pnlAtTarget / capital : null,
    riskReward: maxLoss > 0 && maxLoss !== Infinity ? maxProfit / maxLoss : maxLoss === Infinity ? 0 : null,
    pop,
    probTarget,
    sigma,
    evalExpiration: exp,
    daysToEval: Math.max(Math.ceil((evalMs - ctx.now) / 86_400_000), 0),
    sameExpiration,
    greeks: positionGreeks(legs, ctx),
    liquidity: { roundTripCost, worstSpreadPct, minOpenInterest: minOI, usesLastPrices: usesLast },
  };
}

let legCounter = 0;
export const newLegId = () => `leg-${Date.now().toString(36)}-${(legCounter++).toString(36)}`;

export function legFromContract(c: OptionContract, action: Action, quantity = 1): Leg {
  return {
    id: newLegId(),
    instrument: c.type,
    action,
    quantity,
    strike: c.strike,
    expiration: c.expiration,
    premium: c.premium,
    iv: c.iv,
    contract: {
      contractSymbol: c.contractSymbol,
      bid: c.bid,
      ask: c.ask,
      openInterest: c.openInterest,
      volume: c.volume,
      premiumSource: c.premiumSource,
      spreadPct: c.spreadPct,
      ivSource: c.ivSource,
    },
  };
}

export function stockLeg(price: number, action: Action = "buy", shares = 100): Leg {
  return { id: newLegId(), instrument: "stock", action, quantity: shares, premium: price };
}
