// Goal-oriented recommendation engine, adapted from the principles of
// Cong, Tang & Wang, "AlphaPortfolio: Goal-Oriented Investment Management Through Deep
// Reinforcement Learning" (SSRN 3554486):
//
//  1. Direct construction: choose the position that maximises the investor's objective itself,
//     evaluated on the whole outcome distribution — not a hand-specified rule or a single
//     intermediate statistic.
//  2. Enlarged policy space: search thousands of strike/expiration combinations across
//     structure families instead of a few templates. (The paper uses RL because exhaustive
//     search over portfolios is infeasible; a single options position is small enough to
//     search exhaustively, which optimises the same objective exactly.)
//  3. Flexible objectives: Sharpe ratio (the paper's baseline), a tail-risk / survival-aware
//     objective, or expected return — with transaction costs inside the objective, and
//     capital / max-loss limits as hard constraints.
//  4. Robustness + distillation: stress-test the pick and report which assumptions drive it
//     (a sensitivity analysis in the spirit of the paper's polynomial sensitivity analysis).

import { isTradable, yearsUntil, type EnrichedChain, type OptionContract } from "./chain";
import { expectedMove, normCdf } from "./math";
import { estimatedMargin, legFromContract, stockLeg, type Leg } from "./position";
import { finalize, outlookBias } from "./strategies";
import { money, pct } from "../format";
import type {
  Bias,
  Driver,
  ExcludedStrategy,
  GenerationResult,
  ModelScore,
  ObjectiveKey,
  Outlook,
  Preference,
  Recommendation,
  Scenario,
  StrategyId,
  StrategyResult,
} from "./types";

// ---------------------------------------------------------------------------
// Objectives
// ---------------------------------------------------------------------------
export const OBJECTIVES: { key: ObjectiveKey; pref: Exclude<Preference, "all">; label: string; short: string; description: string }[] = [
  {
    key: "tail",
    pref: "conservative",
    label: "Conservative — return per unit of tail risk",
    short: "Expected P/L ÷ expected shortfall, defined risk, ≥55% win probability",
    description: "Expected P/L divided by the average loss in the worst 5% of outcomes, searched only over defined-risk positions with at least a 55% chance of profit under your view (a survival / drawdown-aware objective).",
  },
  {
    key: "sharpe",
    pref: "balanced",
    label: "Balanced — Sharpe ratio",
    short: "Expected P/L ÷ P/L volatility",
    description: "Expected P/L per unit of P/L volatility — the baseline objective in the AlphaPortfolio paper.",
  },
  {
    key: "return",
    pref: "aggressive",
    label: "Aggressive — expected return on capital",
    short: "Expected P/L ÷ capital",
    description: "Maximises expected P/L as a percentage of capital, ignoring volatility. Tends to favour leveraged, lower-probability structures.",
  },
];

export function objectiveFor(pref: Preference): ObjectiveKey {
  return OBJECTIVES.find((o) => o.pref === pref)?.key ?? "sharpe";
}

// ---------------------------------------------------------------------------
// Families (structure types) searched
// ---------------------------------------------------------------------------
type Family = Exclude<StrategyId, "custom" | "otm_call_debit_spread">;

const FAMILY: Record<Family, { name: string; bias: Bias; definedRisk: boolean }> = {
  long_call: { name: "Long Call", bias: "bullish", definedRisk: true },
  bull_call_spread: { name: "Bull Call Spread", bias: "bullish", definedRisk: true },
  bull_put_spread: { name: "Bull Put Spread", bias: "bullish", definedRisk: true },
  cash_secured_put: { name: "Cash-Secured Put", bias: "bullish", definedRisk: true },
  covered_call: { name: "Covered Call", bias: "bullish", definedRisk: true },
  long_put: { name: "Long Put", bias: "bearish", definedRisk: true },
  bear_put_spread: { name: "Bear Put Spread", bias: "bearish", definedRisk: true },
  bear_call_spread: { name: "Bear Call Spread", bias: "bearish", definedRisk: true },
  call_butterfly: { name: "Call Butterfly", bias: "neutral", definedRisk: true },
  put_butterfly: { name: "Put Butterfly", bias: "neutral", definedRisk: true },
  iron_condor: { name: "Iron Condor", bias: "neutral", definedRisk: true },
  short_strangle: { name: "Short Strangle", bias: "neutral", definedRisk: false },
};

// ---------------------------------------------------------------------------
// Compact candidate representation for fast evaluation
// ---------------------------------------------------------------------------
interface CLeg {
  kind: 0 | 1 | 2; // call, put, stock
  sign: 1 | -1;
  units: number; // shares-equivalent
  K: number;
  mid: number;
  half: number; // half bid/ask spread per share (entry cost)
  c?: OptionContract;
}
interface Candidate {
  family: Family;
  legs: CLeg[];
  chain: EnrichedChain;
  label: string;
}
interface Bounds {
  maxLoss: number;
  maxProfit: number;
  capital: number;
}
interface Scored {
  cand: Candidate;
  bounds: Bounds;
  s: Omit<ModelScore, "rank" | "candidatesInFamily">;
}

// Standard-normal quantiles (Acklam's rational approximation)
function invNorm(p: number): number {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - pl) return -invNorm(1 - p);
  const q = p - 0.5, r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}
const NPTS = 400;
const Z = Float64Array.from({ length: NPTS }, (_, i) => invNorm((i + 0.5) / NPTS));
const TAIL = Math.round(NPTS * 0.05);

export interface View {
  /** expected stock price at expiration */
  forward: number;
  sigma: number;
  T: number;
}

/**
 * The user's view as a lognormal distribution at the option's expiration. The target is read as
 * the *expected* price at the end of the horizon (and held there afterwards); dispersion equals
 * the market's implied volatility. Using the expected price (not the median) keeps every leg on
 * the same forward regardless of its own IV, so vol skew cannot create phantom edge.
 */
export function userView(spot: number, target: number, horizonDays: number, sigma: number, expiration: string, now: number): View {
  const T = Math.max(yearsUntil(expiration, now), 1 / 365);
  const Th = Math.max(horizonDays / 365, 1 / 365);
  const mu = Math.log(target / spot) / Th;
  return { forward: spot * Math.exp(mu * Math.min(T, Th)), sigma, T };
}

/** Market-implied (risk-neutral) view: the forward price. */
export function marketView(chain: EnrichedChain): View {
  return { forward: chain.spot * Math.exp((chain.r - chain.q) * chain.T), sigma: chain.atmIv, T: chain.T };
}

/** A view discretised for evaluation. `sigmaMult` scales each leg's own IV for expectations. */
interface Grid {
  S: Float64Array;
  forward: number;
  T: number;
  sigmaMult: number;
}

function grid(v: View, sigmaMult = 1): Grid {
  const w = v.sigma * Math.sqrt(v.T);
  return { S: Z.map((z) => v.forward * Math.exp(-0.5 * w * w + w * z)), forward: v.forward, T: v.T, sigmaMult };
}

/** E[max(S−K,0)] or E[max(K−S,0)] for lognormal S with the given expected value F and vol. */
function lognormalOptionExpectation(kind: 0 | 1, F: number, sigma: number, T: number, K: number): number {
  const s = Math.max(sigma, 1e-4) * Math.sqrt(T);
  const d1 = (Math.log(F / K) + 0.5 * s * s) / s;
  const d2 = d1 - s;
  return kind === 0 ? F * normCdf(d1) - K * normCdf(d2) : K * normCdf(-d2) - F * normCdf(-d1);
}

function payoff(legs: CLeg[], S: number, costMult: number): number {
  let v = 0;
  for (const l of legs) {
    const x = l.kind === 0 ? (S > l.K ? S - l.K : 0) : l.kind === 1 ? (l.K > S ? l.K - S : 0) : S;
    v += l.sign * l.units * (x - (l.mid + l.sign * l.half * costMult));
  }
  return v;
}

function toLegs(c: Candidate): Leg[] {
  return c.legs.map((l) => {
    if (l.kind === 2) return stockLeg(l.mid, l.sign === 1 ? "buy" : "sell", l.units);
    return legFromContract(l.c!, l.sign === 1 ? "buy" : "sell", l.units / 100);
  });
}

function bounds(c: Candidate): Bounds {
  const legs = c.legs;
  const spot = c.chain.spot;
  const ks = legs.filter((l) => l.kind !== 2).map((l) => l.K);
  const pts = [0, ...ks, 2 * Math.max(spot, ...ks)];
  const vals = pts.map((S) => payoff(legs, S, 0));
  const slope = legs.reduce((a, l) => a + (l.kind !== 1 ? l.sign * l.units : 0), 0);
  const maxProfit = slope > 1e-9 ? Infinity : Math.max(...vals);
  const minV = slope < -1e-9 ? -Infinity : Math.min(...vals);
  const maxLoss = minV >= 0 ? 0 : -minV;
  const debit = legs.reduce((a, l) => a + l.sign * l.units * l.mid, 0);
  let capital: number;
  if (maxLoss === Infinity) capital = estimatedMargin(toLegs(c), spot);
  else if (debit > 0 && Math.abs(debit - maxLoss) < 0.5) capital = debit;
  else capital = Math.max(maxLoss, debit);
  return { maxLoss, maxProfit, capital };
}

/**
 * Expected P/L that is consistent with each leg's own market price: every option's expected
 * payoff uses that option's implied vol (so skew and stale quotes cannot masquerade as edge),
 * and entry cash is carried at the risk-free rate. If the user's view equals the market's,
 * this is ≈ −costs for every position — any positive value comes from the view alone.
 */
function consistentMean(c: Candidate, g: Grid, costMult: number): number {
  const { r, q, spot, atmIv } = c.chain;
  const carry = Math.exp(r * g.T);
  let m = 0;
  for (const l of c.legs) {
    const entry = (l.mid + l.sign * l.half * costMult) * carry;
    const exp =
      l.kind === 2
        ? g.forward + spot * (Math.exp(q * g.T) - 1)
        : lognormalOptionExpectation(l.kind, g.forward, (l.c?.iv ?? atmIv) * g.sigmaMult, g.T, l.K);
    m += l.sign * l.units * (exp - entry);
  }
  return m;
}

function evaluate(c: Candidate, g: Grid, b: Bounds, objective: ObjectiveKey, costMult = 1): Scored["s"] {
  const pnl = new Float64Array(NPTS);
  let sum = 0;
  for (let i = 0; i < NPTS; i++) {
    const v = payoff(c.legs, g.S[i], costMult);
    pnl[i] = v;
    sum += v;
  }
  // Keep the distribution's shape from the single-vol grid, but anchor its mean to the
  // price-consistent expectation.
  const mean = consistentMean(c, g, costMult);
  const shift = mean - sum / NPTS;
  let varSum = 0, wins = 0;
  for (let i = 0; i < NPTS; i++) {
    pnl[i] += shift;
    varSum += (pnl[i] - mean) ** 2;
    if (pnl[i] > 0) wins++;
  }
  const std = Math.sqrt(varSum / NPTS);
  const sorted = pnl.slice().sort();
  let tail = 0;
  for (let i = 0; i < TAIL; i++) tail += sorted[i];
  const cvar5 = tail / TAIL;
  const costs = c.legs.reduce((a, l) => a + l.units * l.half * costMult, 0);
  const expectedReturn = b.capital > 0 ? mean / b.capital : null;
  let value: number;
  if (objective === "sharpe") value = std > 1e-6 ? mean / std : mean > 0 ? 50 : -50;
  else if (objective === "tail") value = mean / Math.max(-cvar5, 0.01 * b.capital, 1);
  else value = expectedReturn ?? -Infinity;
  return { objective, value, expectedPnl: mean, stdPnl: std, cvar5, popView: wins / NPTS, expectedReturn, costs };
}

// ---------------------------------------------------------------------------
// Candidate generation (the enlarged policy space)
// ---------------------------------------------------------------------------
const $k = (k: number) => `$${Number.isInteger(k) ? k : k.toFixed(2)}`;

function halfSpread(c: OptionContract): number {
  return c.bid > 0 && c.ask > 0 && c.ask >= c.bid ? (c.ask - c.bid) / 2 : Math.max(0.02, 0.03 * c.premium);
}

function pickStrikes(list: OptionContract[], spot: number, target: number, max = 30): OptionContract[] {
  const hi = 1.5 * Math.max(spot, target);
  const lo = 0.6 * Math.min(spot, target);
  // Only contracts whose IV was solved from their own premium are internally consistent;
  // stale quotes below intrinsic value (IV unsolvable) would otherwise look like free money.
  const ok = list.filter(
    (c) => isTradable(c) && c.ivSource === "solved" && c.strike >= lo && c.strike <= hi && (c.spreadPct === null || c.spreadPct <= 0.5),
  );
  if (ok.length <= max) return ok;
  const must = new Set<OptionContract>();
  for (const x of [spot, target]) must.add(ok.reduce((b, c) => (Math.abs(c.strike - x) < Math.abs(b.strike - x) ? c : b)));
  // denser sampling near spot/target, sparser in the wings
  const ranked = [...ok].sort((a, b) => Math.min(Math.abs(a.strike - spot), Math.abs(a.strike - target)) - Math.min(Math.abs(b.strike - spot), Math.abs(b.strike - target)));
  for (const c of ranked) {
    if (must.size >= max) break;
    must.add(c);
  }
  return [...must].sort((a, b) => a.strike - b.strike);
}

function generate(symbol: string, chain: EnrichedChain, target: number, allowUndefined: boolean): Candidate[] {
  const spot = chain.spot;
  const calls = pickStrikes(chain.calls, spot, target);
  const puts = pickStrikes(chain.puts, spot, target);
  const L = (c: OptionContract, sign: 1 | -1, qty = 1): CLeg => ({ kind: c.type === "call" ? 0 : 1, sign, units: 100 * qty, K: c.strike, mid: c.premium, half: halfSpread(c), c });
  const out: Candidate[] = [];
  const add = (family: Family, legs: CLeg[], label: string) => out.push({ family, legs, chain, label: `${symbol} ${label}` });
  const maxW = 0.35 * spot;

  for (const c of calls) add("long_call", [L(c, 1)], `${$k(c.strike)} Call`);
  for (const p of puts) add("long_put", [L(p, 1)], `${$k(p.strike)} Put`);

  for (let i = 0; i < calls.length; i++)
    for (let j = i + 1; j < calls.length; j++) {
      const a = calls[i], b = calls[j];
      if (b.strike - a.strike > maxW) break;
      add("bull_call_spread", [L(a, 1), L(b, -1)], `${$k(a.strike)}/${$k(b.strike)} Call Spread`);
      add("bear_call_spread", [L(a, -1), L(b, 1)], `${$k(a.strike)}/${$k(b.strike)} Call Credit Spread`);
    }
  for (let i = 0; i < puts.length; i++)
    for (let j = i + 1; j < puts.length; j++) {
      const a = puts[i], b = puts[j];
      if (b.strike - a.strike > maxW) break;
      add("bear_put_spread", [L(b, 1), L(a, -1)], `${$k(b.strike)}/${$k(a.strike)} Put Spread`);
      add("bull_put_spread", [L(b, -1), L(a, 1)], `${$k(b.strike)}/${$k(a.strike)} Put Credit Spread`);
    }

  // Butterflies: symmetric wings around every centre
  const fly = (list: OptionContract[], family: Family, kind: string, keep: (k: number) => boolean) => {
    const byK = new Map(list.map((c) => [c.strike, c]));
    for (const m of list) {
      if (!keep(m.strike)) continue;
      for (const lo of list) {
        const w = m.strike - lo.strike;
        if (w <= 0 || w > 0.25 * spot) continue;
        const hi = byK.get(m.strike + w);
        if (hi) add(family, [L(lo, 1), L(m, -1, 2), L(hi, 1)], `${$k(lo.strike)}/${$k(m.strike)}/${$k(hi.strike)} ${kind} Butterfly`);
      }
    }
  };
  fly(calls, "call_butterfly", "Call", (k) => k >= spot);
  fly(puts, "put_butterfly", "Put", (k) => k < spot);

  // Iron condors: OTM short strikes within ~2σ, equal-width wings
  const em = expectedMove(spot, chain.atmIv, chain.T);
  const sp = puts.filter((p) => p.strike < spot && p.strike > spot - 2 * em);
  const sc = calls.filter((c) => c.strike > spot && c.strike < spot + 2 * em);
  const putByK = new Map(puts.map((p) => [p.strike, p]));
  const callByK = new Map(calls.map((c) => [c.strike, c]));
  const widths = [...new Set(puts.map((p) => p.strike))].map((k, i, arr) => (i ? k - arr[i - 1] : 0)).filter((w) => w > 0);
  const baseW = widths.length ? Math.min(...widths) : spot * 0.025;
  const wingSet = [1, 2, 4].map((m) => m * baseW).filter((w) => w <= 0.15 * spot);
  for (const p of sp)
    for (const c of sc)
      for (const w of wingSet) {
        const lp = putByK.get(p.strike - w), lc = callByK.get(c.strike + w);
        if (lp && lc) add("iron_condor", [L(lp, 1), L(p, -1), L(c, -1), L(lc, 1)], `${$k(lp.strike)}/${$k(p.strike)} · ${$k(c.strike)}/${$k(lc.strike)} Iron Condor`);
      }

  for (const p of puts) if (p.strike <= spot * 1.05) add("cash_secured_put", [L(p, -1)], `${$k(p.strike)} Cash-Secured Put`);
  const stock: CLeg = { kind: 2, sign: 1, units: 100, K: 0, mid: spot, half: Math.max(0.01, spot * 0.0002) };
  for (const c of calls) if (c.strike >= spot * 0.98) add("covered_call", [stock, L(c, -1)], `100 sh + ${$k(c.strike)} Covered Call`);

  if (allowUndefined)
    for (const p of sp)
      for (const c of sc) if (Math.abs(p.delta) <= 0.35 && c.delta <= 0.35) add("short_strangle", [L(p, -1), L(c, -1)], `${$k(p.strike)}P / ${$k(c.strike)}C Short Strangle`);

  return out;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------
interface SearchOut {
  best: Map<Family, Scored>;
  counts: Map<Family, number>;
  infeasible: Map<Family, string>;
  evaluated: number;
}

function better(a: Scored, b: Scored | undefined): boolean {
  if (!b) return true;
  const ap = a.s.expectedPnl > 0, bp = b.s.expectedPnl > 0;
  if (ap !== bp) return ap;
  return a.s.value > b.s.value;
}

/** Minimum objective value for the model to call an edge "meaningful" and make a recommendation. */
export const MIN_EDGE: Record<ObjectiveKey, number> = { sharpe: 0.1, tail: 0.1, return: 0.03 };

/** The conservative objective only admits defined-risk positions that win more often than not. */
export const CONSERVATIVE_MIN_POP = 0.55;

function search(cands: Candidate[], views: Map<EnrichedChain, Grid>, scenario: Scenario, objective: ObjectiveKey, costMult = 1): SearchOut {
  const best = new Map<Family, Scored>();
  const counts = new Map<Family, number>();
  const infeasible = new Map<Family, string>();
  let evaluated = 0;
  for (const cand of cands) {
    const b = bounds(cand);
    if (scenario.maxCapital && b.capital > scenario.maxCapital) {
      if (!counts.get(cand.family)) infeasible.set(cand.family, `Every searched version requires more than your $${scenario.maxCapital.toLocaleString()} capital limit.`);
      continue;
    }
    if (scenario.maxLoss && (b.maxLoss === Infinity || b.maxLoss > scenario.maxLoss)) {
      if (!counts.get(cand.family)) infeasible.set(cand.family, b.maxLoss === Infinity ? "Undefined (unlimited) risk exceeds your maximum-loss limit." : `Every searched version can lose more than your $${scenario.maxLoss.toLocaleString()} limit.`);
      continue;
    }
    if (objective === "tail" && b.maxLoss === Infinity) {
      if (!counts.get(cand.family)) infeasible.set(cand.family, "The conservative objective only considers defined-risk positions.");
      continue;
    }
    evaluated++;
    const s = evaluate(cand, views.get(cand.chain)!, b, objective, costMult);
    if (objective === "tail" && s.popView < CONSERVATIVE_MIN_POP) {
      if (!counts.get(cand.family)) infeasible.set(cand.family, `No version has at least a ${CONSERVATIVE_MIN_POP * 100}% chance of profit under your view (the conservative objective's floor).`);
      continue;
    }
    infeasible.delete(cand.family);
    counts.set(cand.family, (counts.get(cand.family) ?? 0) + 1);
    const scored: Scored = { cand, bounds: b, s };
    if (better(scored, best.get(cand.family))) best.set(cand.family, scored);
  }
  return { best, counts, infeasible, evaluated };
}

function viewsFor(chains: EnrichedChain[], scenario: Scenario, horizonDays: number, now: number, sigmaMult = 1, target = scenario.targetPrice) {
  return new Map(chains.map((c) => [c, grid(userView(c.spot, target, horizonDays, c.atmIv * sigmaMult, c.expiration, now), sigmaMult)]));
}

const sigKey = (c: Candidate) => `${c.chain.expiration}|${c.family}|${c.legs.map((l) => `${l.sign}${l.kind}${l.K}x${l.units}`).join(",")}`;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export interface RecommendInput {
  symbol: string;
  chains: EnrichedChain[];
  scenario: Scenario;
  horizonDays: number;
  now: number;
}

export function inferOutlook(spot: number, target: number, sigma: number, horizonDays: number): Outlook {
  const em = expectedMove(spot, sigma, horizonDays / 365);
  const z = (target - spot) / Math.max(em, 1e-9);
  if (Math.abs(z) < 0.25) return "neutral";
  if (z >= 1) return "bullish";
  if (z > 0) return "moderately_bullish";
  if (z <= -1) return "bearish";
  return "moderately_bearish";
}

export function recommend(inp: RecommendInput): GenerationResult {
  const { symbol, chains, scenario, horizonDays, now } = inp;
  const objective = objectiveFor(scenario.preference);
  const allowUndefined = !scenario.maxLoss;
  const cands = chains.flatMap((c) => generate(symbol, c, scenario.targetPrice, allowUndefined));
  const vm = scenario.volView ?? 1;
  const views = viewsFor(chains, scenario, horizonDays, now, vm);
  const base = search(cands, views, scenario, objective);

  // Rank family winners by the objective (families with positive expected P/L first)
  const winners = [...base.best.values()].sort((a, b) => (better(a, b) ? -1 : 1));
  const primary = chains[0];

  const toResult = (w: Scored, rank: number): StrategyResult => {
    const meta = FAMILY[w.cand.family];
    const res = finalize({ id: w.cand.family, name: meta.name, bias: meta.bias, definedRisk: meta.definedRisk, profiles: [] }, toLegs(w.cand), w.cand.label, {
      symbol,
      chain: w.cand.chain,
      scenario,
      now,
    });
    res.score = { ...w.s, rank, candidatesInFamily: base.counts.get(w.cand.family) ?? 0 };
    return res;
  };
  const strategies = winners.map((w, i) => toResult(w, i + 1));
  const top = winners[0];
  const material = !!top && top.s.expectedPnl > 0 && top.s.value >= MIN_EDGE[objective];
  const pickScored = material ? top : null;
  const pick = pickScored ? strategies[winners.indexOf(pickScored)] : null;

  // ---- Robustness / sensitivity ("distillation"): perturb assumptions, re-optimise
  const drivers: Driver[] = [];
  if (pickScored) {
    const pickKey = sigKey(pickScored.cand);
    const move = scenario.targetPrice - primary.spot;
    const tests: { key: string; label: string; views: Map<EnrichedChain, Grid>; costMult?: number }[] = [
      { key: "target_half", label: "Stock moves only half-way to your target", views: viewsFor(chains, scenario, horizonDays, now, vm, primary.spot + move * 0.5) },
      { key: "target_over", label: "Stock overshoots your target by 50%", views: viewsFor(chains, scenario, horizonDays, now, vm, primary.spot + move * 1.5) },
      { key: "vol_up", label: "Outcomes 25% more dispersed than assumed", views: viewsFor(chains, scenario, horizonDays, now, vm * 1.25) },
      { key: "vol_down", label: "Outcomes 25% less dispersed than assumed", views: viewsFor(chains, scenario, horizonDays, now, vm * 0.75) },
      { key: "costs", label: "Trading costs double (wider spreads)", views, costMult: 2 },
    ];
    for (const t of tests) {
      const r = search(cands, t.views, scenario, objective, t.costMult ?? 1);
      const top = [...r.best.values()].sort((a, b) => (better(a, b) ? -1 : 1))[0];
      const pickNow = evaluate(pickScored.cand, t.views.get(pickScored.cand.chain)!, pickScored.bounds, objective, t.costMult ?? 1);
      drivers.push({
        key: t.key,
        label: t.label,
        delta: pickNow.value - pickScored.s.value,
        pickUnder: top ? (top.s.expectedPnl > 0 ? `${FAMILY[top.cand.family].name} (${top.cand.label.replace(`${symbol} `, "")}, ${top.cand.chain.expiration})` : "No trade (no positive expected value)") : "—",
        samePick: !!top && sigKey(top.cand) === pickKey,
        sameFamily: !!top && top.s.expectedPnl > 0 && top.cand.family === pickScored.cand.family,
      });
    }
    drivers.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  }

  // ---- Explanation
  const obj = OBJECTIVES.find((o) => o.key === objective)!;
  const narrative: string[] = [];
  const expList = chains.map((c) => c.expiration).join(", ");
  narrative.push(
    `The model searched ${base.evaluated.toLocaleString()} feasible positions across ${base.best.size} structure types and ${chains.length} expiration${chains.length > 1 ? "s" : ""} (${expList}), scoring each one on its full distribution of outcomes at expiration under your view — an expected price of ${money(scenario.targetPrice)} by the end of your horizon, with dispersion ${vm === 1 ? "set by implied volatility" : vm < 1 ? "25% below implied volatility (your calmer-market view)" : "25% above implied volatility (your more-volatile view)"} — net of estimated bid/ask costs.`,
  );
  narrative.push(
    `Objective: ${obj.label.split(" — ")[1]} (${obj.short}). ${scenario.maxCapital || scenario.maxLoss ? `Hard constraints: ${[scenario.maxCapital ? `capital ≤ ${money(scenario.maxCapital)}` : "", scenario.maxLoss ? `maximum loss ≤ ${money(scenario.maxLoss)}` : ""].filter(Boolean).join(", ")}.` : "No capital or loss limits were set."}`,
  );
  let noTradeReason: string | undefined;
  if (pick && pickScored) {
    const s = pickScored.s;
    narrative.push(
      `Top-ranked: ${pick.name} (${pick.label}, ${pick.expiration}). Under your view the model estimates an expected P/L of ${money(s.expectedPnl, { sign: true })} (±${money(s.stdPnl)} one standard deviation), a ${pct(s.popView, { decimals: 0 })} chance of profit (vs ${pct(pick.metrics.pop, { decimals: 0 })} under market-implied odds), and an average loss of ${money(Math.min(s.cvar5, 0))} in the worst 5% of outcomes.`,
    );
    const runner = winners.find((w) => w !== pickScored && w.s.expectedPnl > 0);
    if (runner) {
      const r = runner.s;
      const why =
        objective === "sharpe"
          ? r.stdPnl / Math.max(r.expectedPnl, 1e-9) > s.stdPnl / Math.max(s.expectedPnl, 1e-9)
            ? "it carries more P/L volatility per dollar of expected profit"
            : "its expected P/L is smaller relative to its risk"
          : objective === "tail"
            ? "its worst-case outcomes are larger relative to its expected profit"
            : "its expected profit is smaller relative to the capital it ties up";
      narrative.push(`Runner-up: ${FAMILY[runner.cand.family].name} (${runner.cand.label.replace(`${symbol} `, "")}) scored ${r.value.toFixed(2)} vs ${s.value.toFixed(2)} — ${why}.`);
    }
    if (s.costs > 0.1 * Math.abs(s.expectedPnl))
      narrative.push(`Estimated spread costs of ${money(s.costs)} are already deducted; they are material relative to the expected edge, so execution quality matters.`);
    const exact = drivers.filter((d) => d.samePick).length;
    const fam = drivers.filter((d) => d.sameFamily).length;
    const n = drivers.length;
    narrative.push(
      fam === n
        ? `Robustness: a ${pick.name.toLowerCase()} stays top-ranked under all ${n} stress tests${exact === n ? " with the same strikes" : ` (the exact strikes hold in ${exact}; otherwise they shift with the assumption)`}.`
        : `Robustness: a ${pick.name.toLowerCase()} stays top-ranked in ${fam} of ${n} stress tests (same strikes in ${exact}). The pick is sensitive to the assumptions flagged under “What drives this recommendation”.`,
    );
    narrative.push(
      "Important: under market-implied (risk-neutral) odds every position's expected P/L is roughly zero minus costs. Any positive expected value here comes entirely from your target view — if the view is wrong, so is the ranking.",
    );
  } else {
    const volHint =
      vm === 1
        ? " A price target close to the market's forward carries almost no edge on its own; neutral structures (iron condors, butterflies, short premium) only have an edge if you expect calmer markets than options imply — set your volatility view to test that."
        : "";
    noTradeReason =
      base.evaluated === 0
        ? "No position satisfies your capital and loss limits for these expirations."
        : top && top.s.expectedPnl > 0
          ? `The best position found scores only ${top.s.value.toFixed(2)} on the ${obj.label.split(" — ")[1]} objective, below the model's minimum of ${MIN_EDGE[objective]} for a meaningful edge after costs. The model does not recommend a trade.${volHint}`
          : `No searched position has a positive expected P/L under your view after trading costs. The model does not recommend a trade.${volHint}`;
    narrative.push(noTradeReason);
    narrative.push("The highest-scoring positions are still listed below for reference.");
  }

  // ---- Exclusions & warnings
  const excluded: ExcludedStrategy[] = [...base.infeasible.entries()]
    .filter(([f]) => !base.best.has(f))
    .map(([f, reason]) => ({ templateId: f, name: FAMILY[f].name, reason }));
  if (!allowUndefined) excluded.push({ templateId: "short_strangle", name: "Short Strangle", reason: "Undefined (unlimited) risk is not searched when a maximum loss is set." });

  const warnings: string[] = [];
  const em = expectedMove(primary.spot, primary.atmIv, horizonDays / 365);
  if (Math.abs(scenario.targetPrice - primary.spot) > 2 * em)
    warnings.push(`Your target is more than two implied standard deviations away (±${money(em)} one-σ move over your horizon). The market assigns this a low probability; results depend heavily on your view being right.`);
  if (chains.some((c) => c.usesLastPrices))
    warnings.push("Live bid/ask quotes were unavailable (market likely closed), so premiums use last traded prices and spread costs are estimated. Re-run during market hours for execution-grade numbers.");
  const bias = outlookBias(scenario.outlook);
  if (pick && pick.bias !== "neutral" && bias !== "neutral" && pick.bias !== bias)
    warnings.push("The top-ranked structure's direction differs from your stated outlook. Check that the target price reflects your view.");

  const recommendation: Recommendation = {
    pick,
    objective,
    candidatesEvaluated: base.evaluated,
    expirationsSearched: chains.map((c) => c.expiration),
    drivers,
    narrative,
    noTradeReason,
  };
  return { strategies, excluded, warnings, expiration: pick?.expiration ?? primary.expiration, recommendation };
}

/** Re-optimise a single structure type on a specific expiration (used by the detail drawer). */
export function optimizeFamily(templateId: StrategyId, chain: EnrichedChain, inp: Omit<RecommendInput, "chains">): StrategyResult | { error: string } {
  if (!(templateId in FAMILY)) return { error: "This structure cannot be re-optimised." };
  const family = templateId as Family;
  const objective = objectiveFor(inp.scenario.preference);
  const cands = generate(inp.symbol, chain, inp.scenario.targetPrice, true).filter((c) => c.family === family);
  const views = viewsFor([chain], inp.scenario, inp.horizonDays, inp.now, inp.scenario.volView ?? 1);
  const r = search(cands, views, inp.scenario, objective);
  const w = r.best.get(family);
  if (!w) return { error: r.infeasible.get(family) ?? "No suitable strikes were available in this expiration." };
  const meta = FAMILY[family];
  const res = finalize({ id: family, name: meta.name, bias: meta.bias, definedRisk: meta.definedRisk, profiles: [] }, toLegs(w.cand), w.cand.label, {
    symbol: inp.symbol,
    chain,
    scenario: inp.scenario,
    now: inp.now,
  });
  res.score = { ...w.s, rank: 0, candidatesInFamily: r.counts.get(family) ?? 0 };
  return res;
}

/**
 * Invariant check used by the self-test: under the market's own (risk-neutral) view, the largest
 * expected P/L before costs across all candidates, relative to each candidate's capital.
 */
export function maxEdgeUnderMarketView(symbol: string, chain: EnrichedChain): { label: string; edge: number } {
  const g = grid(marketView(chain));
  let worst = { label: "", edge: 0 };
  for (const c of generate(symbol, chain, chain.spot, true)) {
    const b = bounds(c);
    const e = consistentMean(c, g, 0) / Math.max(b.capital, 100);
    if (Math.abs(e) > Math.abs(worst.edge)) worst = { label: c.label, edge: e };
  }
  return worst;
}

/** Expirations to search: the one matching the horizon plus its neighbours. */
export function expirationsToSearch(expirations: string[], horizonDays: number, now: number): string[] {
  const future = expirations.filter((e) => yearsUntil(e, now) * 365 > 1.5);
  if (!future.length) return [];
  const target = now + horizonDays * 86_400_000;
  let idx = future.findIndex((e) => Date.parse(`${e}T20:00:00Z`) >= target - 2 * 86_400_000);
  if (idx === -1) idx = future.length - 1;
  const out = [future[idx]];
  const prev = future[idx - 1];
  if (prev && yearsUntil(prev, now) * 365 >= horizonDays * 0.6) out.push(prev);
  if (future[idx + 1]) out.push(future[idx + 1]);
  return out;
}
