// Strategy engine: builds candidate structures from a live (enriched) chain for the user's
// scenario, computes metrics, and filters by outlook, preference and risk constraints.
// Deliberately does NOT produce a single "best" score — results are sortable by the user.

import { isTradable, type EnrichedChain, type OptionContract, type PricingContext } from "./chain";
import { expectedMove } from "./math";
import { analyzePosition, legFromContract, stockLeg, type Leg } from "./position";
import { explainStrategy } from "./explain";
import { buildRisks } from "./risk";
import {
  HORIZONS,
  type Bias,
  type ExcludedStrategy,
  type GenerationResult,
  type Outlook,
  type Preference,
  type Scenario,
  type StrategyId,
  type StrategyResult,
} from "./types";

export interface BuildContext {
  symbol: string;
  chain: EnrichedChain;
  scenario: Scenario;
  now: number;
}

interface Template {
  id: StrategyId;
  name: string;
  bias: Bias;
  outlooks: Outlook[];
  profiles: Preference[];
  definedRisk: boolean;
  applies?: (b: BuildContext) => string | null; // returns a reason when not applicable
  build: (b: BuildContext, h: Helpers) => { legs: Leg[]; label: string } | null;
}

// ---------------------------------------------------------------------------
// Strike-selection helpers
// ---------------------------------------------------------------------------
interface Helpers {
  calls: OptionContract[];
  puts: OptionContract[];
  spot: number;
  target: number;
  width: number;
  em: number;
  pref: Exclude<Preference, "all">;
  nearest: (list: OptionContract[], x: number) => OptionContract | null;
  byDelta: (list: OptionContract[], d: number) => OptionContract | null;
  wing: (list: OptionContract[], from: OptionContract, width: number, dir: 1 | -1) => OptionContract | null;
  pick: <T>(m: Record<Exclude<Preference, "all">, T>) => T;
}

function helpers(b: BuildContext): Helpers {
  const usable = (list: OptionContract[]) => {
    const t = list.filter(isTradable);
    return t.length >= 4 ? t : list.filter((c) => c.premium > 0);
  };
  const calls = usable(b.chain.calls);
  const puts = usable(b.chain.puts);
  const spot = b.chain.spot;
  const strikes = [...new Set(calls.map((c) => c.strike))].sort((a, z) => a - z);
  const nearSpot = strikes.filter((k) => Math.abs(k - spot) / spot < 0.15);
  const steps = nearSpot.slice(1).map((k, i) => k - nearSpot[i]).sort((a, z) => a - z);
  const step = steps.length ? steps[Math.floor(steps.length / 2)] : spot * 0.025;
  const em = expectedMove(spot, b.chain.atmIv, b.chain.T);
  const width = Math.max(step, Math.round((spot * 0.05) / step) * step);
  const pref: Exclude<Preference, "all"> = b.scenario.preference === "all" ? "balanced" : b.scenario.preference;

  const nearest = (list: OptionContract[], x: number) =>
    list.length ? list.reduce((best, c) => (Math.abs(c.strike - x) < Math.abs(best.strike - x) ? c : best)) : null;
  const byDelta = (list: OptionContract[], d: number) =>
    list.length ? list.reduce((best, c) => (Math.abs(Math.abs(c.delta) - d) < Math.abs(Math.abs(best.delta) - d) ? c : best)) : null;
  const wing = (list: OptionContract[], from: OptionContract, w: number, dir: 1 | -1) => {
    const beyond = list.filter((c) => (dir === 1 ? c.strike > from.strike : c.strike < from.strike));
    return nearest(beyond, from.strike + dir * w);
  };
  return { calls, puts, spot, target: b.scenario.targetPrice, width, em, pref, nearest, byDelta, wing, pick: (m) => m[pref] };
}

const $ = (k: number) => `$${Number.isInteger(k) ? k : k.toFixed(2)}`;

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------
const TEMPLATES: Template[] = [
  {
    id: "long_call",
    name: "Long Call",
    bias: "bullish",
    outlooks: ["bullish", "moderately_bullish"],
    profiles: ["balanced", "aggressive"],
    definedRisk: true,
    build: (b, h) => {
      const c =
        h.pref === "conservative" ? h.byDelta(h.calls, 0.7)
        : h.pref === "aggressive" && h.target > h.spot ? h.nearest(h.calls.filter((x) => x.strike >= h.spot), h.spot + 0.5 * (h.target - h.spot))
        : h.nearest(h.calls, h.spot);
      if (!c) return null;
      return { legs: [legFromContract(c, "buy")], label: `${b.symbol} ${$(c.strike)} Call` };
    },
  },
  {
    id: "bull_call_spread",
    name: "Bull Call Spread",
    bias: "bullish",
    outlooks: ["bullish", "moderately_bullish"],
    profiles: ["conservative", "balanced"],
    definedRisk: true,
    build: (b, h) => {
      const long = h.pref === "conservative" ? h.byDelta(h.calls, 0.65) : h.nearest(h.calls, h.spot);
      if (!long) return null;
      const above = h.calls.filter((c) => c.strike > long.strike);
      const short = h.target > long.strike ? h.nearest(above, h.target) : h.wing(h.calls, long, h.width, 1);
      if (!short) return null;
      return { legs: [legFromContract(long, "buy"), legFromContract(short, "sell")], label: `${b.symbol} ${$(long.strike)}/${$(short.strike)} Call Spread` };
    },
  },
  {
    id: "otm_call_debit_spread",
    name: "OTM Call Debit Spread",
    bias: "bullish",
    outlooks: ["bullish", "moderately_bullish"],
    profiles: ["aggressive"],
    definedRisk: true,
    applies: (b) => (b.scenario.targetPrice > b.chain.spot * 1.03 ? null : "Needs a target at least ~3% above the current price."),
    build: (b, h) => {
      const long = h.nearest(h.calls.filter((c) => c.strike > h.spot), h.spot + 0.5 * (h.target - h.spot));
      if (!long) return null;
      const short = h.nearest(h.calls.filter((c) => c.strike > long.strike), h.target);
      if (!short) return null;
      return { legs: [legFromContract(long, "buy"), legFromContract(short, "sell")], label: `${b.symbol} ${$(long.strike)}/${$(short.strike)} OTM Call Spread` };
    },
  },
  {
    id: "bull_put_spread",
    name: "Bull Put Spread",
    bias: "bullish",
    outlooks: ["bullish", "moderately_bullish"],
    profiles: ["conservative", "balanced"],
    definedRisk: true,
    build: (b, h) => {
      const short = h.byDelta(h.puts.filter((p) => p.strike <= h.spot * 1.02), h.pick({ conservative: 0.25, balanced: 0.35, aggressive: 0.45 }));
      if (!short) return null;
      const long = h.wing(h.puts, short, h.width, -1);
      if (!long) return null;
      return { legs: [legFromContract(short, "sell"), legFromContract(long, "buy")], label: `${b.symbol} ${$(short.strike)}/${$(long.strike)} Put Credit Spread` };
    },
  },
  {
    id: "cash_secured_put",
    name: "Cash-Secured Put",
    bias: "bullish",
    outlooks: ["bullish", "moderately_bullish", "neutral"],
    profiles: ["conservative", "balanced"],
    definedRisk: true,
    build: (b, h) => {
      const short = h.byDelta(h.puts.filter((p) => p.strike <= h.spot * 1.02), h.pick({ conservative: 0.25, balanced: 0.3, aggressive: 0.4 }));
      if (!short) return null;
      return { legs: [legFromContract(short, "sell")], label: `${b.symbol} ${$(short.strike)} Cash-Secured Put` };
    },
  },
  {
    id: "covered_call",
    name: "Covered Call",
    bias: "bullish",
    outlooks: ["moderately_bullish", "neutral"],
    profiles: ["conservative"],
    definedRisk: true,
    build: (b, h) => {
      const otm = h.calls.filter((c) => c.strike > h.spot);
      const call =
        b.scenario.outlook === "moderately_bullish" && h.target > h.spot ? h.nearest(otm, h.target) : h.byDelta(otm, 0.3);
      if (!call) return null;
      return { legs: [stockLeg(h.spot), legFromContract(call, "sell")], label: `100 ${b.symbol} + ${$(call.strike)} Covered Call` };
    },
  },
  {
    id: "long_put",
    name: "Long Put",
    bias: "bearish",
    outlooks: ["bearish", "moderately_bearish"],
    profiles: ["balanced", "aggressive"],
    definedRisk: true,
    build: (b, h) => {
      const p =
        h.pref === "conservative" ? h.byDelta(h.puts, 0.7)
        : h.pref === "aggressive" && h.target < h.spot ? h.nearest(h.puts.filter((x) => x.strike <= h.spot), h.spot - 0.5 * (h.spot - h.target))
        : h.nearest(h.puts, h.spot);
      if (!p) return null;
      return { legs: [legFromContract(p, "buy")], label: `${b.symbol} ${$(p.strike)} Put` };
    },
  },
  {
    id: "bear_put_spread",
    name: "Bear Put Spread",
    bias: "bearish",
    outlooks: ["bearish", "moderately_bearish"],
    profiles: ["conservative", "balanced", "aggressive"],
    definedRisk: true,
    build: (b, h) => {
      const long = h.pref === "conservative" ? h.byDelta(h.puts, 0.65) : h.nearest(h.puts, h.spot);
      if (!long) return null;
      const below = h.puts.filter((p) => p.strike < long.strike);
      const short = h.target < long.strike ? h.nearest(below, h.target) : h.wing(h.puts, long, h.width, -1);
      if (!short) return null;
      return { legs: [legFromContract(long, "buy"), legFromContract(short, "sell")], label: `${b.symbol} ${$(long.strike)}/${$(short.strike)} Put Spread` };
    },
  },
  {
    id: "bear_call_spread",
    name: "Bear Call Spread",
    bias: "bearish",
    outlooks: ["bearish", "moderately_bearish"],
    profiles: ["conservative", "balanced"],
    definedRisk: true,
    build: (b, h) => {
      const short = h.byDelta(h.calls.filter((c) => c.strike >= h.spot * 0.98), h.pick({ conservative: 0.25, balanced: 0.35, aggressive: 0.45 }));
      if (!short) return null;
      const long = h.wing(h.calls, short, h.width, 1);
      if (!long) return null;
      return { legs: [legFromContract(short, "sell"), legFromContract(long, "buy")], label: `${b.symbol} ${$(short.strike)}/${$(long.strike)} Call Credit Spread` };
    },
  },
  {
    id: "iron_condor",
    name: "Iron Condor",
    bias: "neutral",
    outlooks: ["neutral"],
    profiles: ["conservative", "balanced"],
    definedRisk: true,
    build: (b, h) => {
      const d = h.pick({ conservative: 0.15, balanced: 0.2, aggressive: 0.25 });
      const sp = h.byDelta(h.puts.filter((p) => p.strike < h.spot), d);
      const sc = h.byDelta(h.calls.filter((c) => c.strike > h.spot), d);
      if (!sp || !sc) return null;
      const lp = h.wing(h.puts, sp, h.width, -1);
      const lc = h.wing(h.calls, sc, h.width, 1);
      if (!lp || !lc) return null;
      return {
        legs: [legFromContract(lp, "buy"), legFromContract(sp, "sell"), legFromContract(sc, "sell"), legFromContract(lc, "buy")],
        label: `${b.symbol} ${$(lp.strike)}/${$(sp.strike)} · ${$(sc.strike)}/${$(lc.strike)} Iron Condor`,
      };
    },
  },
  {
    id: "call_butterfly",
    name: "Call Butterfly",
    bias: "neutral",
    outlooks: ["neutral", "moderately_bullish", "bullish"],
    profiles: ["balanced", "aggressive"],
    definedRisk: true,
    applies: (b) => (b.scenario.targetPrice >= b.chain.spot ? null : "Call butterfly is centred on targets at or above the current price."),
    build: (b, h) => butterfly(b, h, h.calls, "Call"),
  },
  {
    id: "put_butterfly",
    name: "Put Butterfly",
    bias: "neutral",
    outlooks: ["neutral", "moderately_bearish", "bearish"],
    profiles: ["balanced", "aggressive"],
    definedRisk: true,
    applies: (b) => (b.scenario.targetPrice < b.chain.spot ? null : "Put butterfly is centred on targets below the current price."),
    build: (b, h) => butterfly(b, h, h.puts, "Put"),
  },
  {
    id: "short_strangle",
    name: "Short Strangle",
    bias: "neutral",
    outlooks: ["neutral"],
    profiles: ["aggressive"],
    definedRisk: false,
    build: (b, h) => {
      const d = h.pick({ conservative: 0.1, balanced: 0.16, aggressive: 0.16 });
      const sp = h.byDelta(h.puts.filter((p) => p.strike < h.spot), d);
      const sc = h.byDelta(h.calls.filter((c) => c.strike > h.spot), d);
      if (!sp || !sc) return null;
      return { legs: [legFromContract(sp, "sell"), legFromContract(sc, "sell")], label: `${b.symbol} ${$(sp.strike)}P / ${$(sc.strike)}C Short Strangle` };
    },
  },
];

function butterfly(b: BuildContext, h: Helpers, list: OptionContract[], kind: "Call" | "Put") {
  const center = h.nearest(list, h.target);
  if (!center) return null;
  const w = Math.max(h.width, h.em * 0.4);
  const lower = h.wing(list, center, w, -1);
  if (!lower) return null;
  const upper = h.nearest(list.filter((c) => c.strike > center.strike), center.strike + (center.strike - lower.strike));
  if (!upper) return null;
  const mk = (c: OptionContract, a: "buy" | "sell", q = 1) => legFromContract(c, a, q);
  return {
    legs: [mk(lower, "buy"), mk(center, "sell", 2), mk(upper, "buy")],
    label: `${b.symbol} ${$(lower.strike)}/${$(center.strike)}/${$(upper.strike)} ${kind} Butterfly`,
  };
}

export const TEMPLATE_INDEX: Record<string, { name: string; definedRisk: boolean; bias: Bias }> = Object.fromEntries(
  TEMPLATES.map((t) => [t.id, { name: t.name, definedRisk: t.definedRisk, bias: t.bias }]),
);

export function pricingContext(chain: EnrichedChain, now: number): PricingContext {
  return { spot: chain.spot, r: chain.r, q: chain.q, now };
}

/** Build one template on a given chain (used for re-pricing a strategy on another expiration). */
export function buildStrategy(templateId: StrategyId, b: BuildContext): StrategyResult | { error: string } {
  const t = TEMPLATES.find((x) => x.id === templateId);
  if (!t) return { error: "Unknown strategy" };
  const na = t.applies?.(b);
  if (na) return { error: na };
  const built = t.build(b, helpers(b));
  if (!built) return { error: "No suitable strikes were available in this expiration." };
  return finalize(t, built.legs, built.label, b);
}

export type StrategyMeta = Pick<Template, "id" | "name" | "bias" | "definedRisk" | "profiles">;

export function finalize(t: StrategyMeta, legs: Leg[], label: string, b: BuildContext): StrategyResult {
  const ctx = pricingContext(b.chain, b.now);
  const metrics = analyzePosition(legs, ctx, { target: b.scenario.targetPrice, sigma: b.chain.atmIv });
  const base = {
    key: `${t.id}:${b.chain.expiration}:${legs.map((l) => `${l.action}${l.quantity}${l.instrument}${l.strike ?? ""}`).join("|")}`,
    templateId: t.id,
    name: t.name,
    label,
    bias: t.bias,
    definedRisk: t.definedRisk,
    profiles: t.profiles,
    expiration: b.chain.expiration,
    legs,
    metrics,
    fitsWithinBudget:
      b.scenario.maxCapital && metrics.capital > 0 ? Math.floor(b.scenario.maxCapital / metrics.capital) : null,
  };
  return {
    ...base,
    explanation: explainStrategy(t.id, { symbol: b.symbol, chain: b.chain, scenario: b.scenario, legs, metrics }),
    risks: buildRisks({ symbol: b.symbol, legs, metrics, chain: b.chain, templateId: t.id }),
  };
}

export function outlookBias(o: Outlook): Bias {
  return o.includes("bullish") ? "bullish" : o.includes("bearish") ? "bearish" : "neutral";
}

export function generateStrategies(b: BuildContext): GenerationResult {
  const { scenario, chain } = b;
  const warnings: string[] = [];
  const excluded: ExcludedStrategy[] = [];
  const strategies: StrategyResult[] = [];
  const seen = new Set<string>();

  const movePct = (scenario.targetPrice - chain.spot) / chain.spot;
  const bias = outlookBias(scenario.outlook);
  if (bias === "bullish" && movePct < 0)
    warnings.push("Your outlook is bullish but your target is below the current price. Structures are built for the stated outlook; review the target.");
  if (bias === "bearish" && movePct > 0)
    warnings.push("Your outlook is bearish but your target is above the current price. Structures are built for the stated outlook; review the target.");
  if (bias === "neutral" && Math.abs(movePct) > 0.08)
    warnings.push("A neutral outlook usually assumes the stock stays near its current price, but your target is more than 8% away.");
  const em = expectedMove(chain.spot, chain.atmIv, chain.T);
  if (Math.abs(scenario.targetPrice - chain.spot) > 2 * em)
    warnings.push(
      `Your target is more than two implied standard deviations away (the options market prices a ~±$${em.toFixed(2)} one-standard-deviation move by ${chain.expiration}). The model assigns this a low probability.`,
    );
  if (chain.usesLastPrices)
    warnings.push("Live bid/ask quotes were unavailable (market likely closed), so premiums use last traded prices. Actual fills may differ.");

  const horizonDays = HORIZONS.find((h) => h.key === scenario.horizon)?.days ?? 30;
  if (chain.dte > horizonDays * 1.5 + 7)
    warnings.push(`The nearest listed expiration after your horizon is ${chain.expiration} (${chain.dte} days).`);

  for (const t of TEMPLATES) {
    if (!t.outlooks.includes(scenario.outlook)) continue;
    if (scenario.preference !== "all" && !t.profiles.includes(scenario.preference)) continue;

    const res = buildStrategy(t.id, b);
    if ("error" in res) {
      excluded.push({ templateId: t.id, name: t.name, reason: res.error });
      continue;
    }
    const sig = res.legs.map((l) => `${l.action}${l.quantity}${l.instrument}${l.strike ?? ""}`).sort().join("|");
    if (seen.has(sig)) continue;
    seen.add(sig);

    const m = res.metrics;
    if (scenario.maxCapital && m.capital > scenario.maxCapital) {
      excluded.push({ templateId: t.id, name: t.name, reason: `Requires about $${Math.round(m.capital).toLocaleString()} per 1-lot, above your $${scenario.maxCapital.toLocaleString()} capital limit.` });
      continue;
    }
    if (scenario.maxLoss) {
      if (m.maxLoss === Infinity) {
        excluded.push({ templateId: t.id, name: t.name, reason: "Has undefined (theoretically unlimited) risk, which exceeds your maximum-loss setting." });
        continue;
      }
      if (m.maxLoss > scenario.maxLoss) {
        excluded.push({ templateId: t.id, name: t.name, reason: `Maximum loss of about $${Math.round(m.maxLoss).toLocaleString()} exceeds your $${scenario.maxLoss.toLocaleString()} limit.` });
        continue;
      }
    }
    strategies.push(res);
  }

  return { strategies, excluded, warnings, expiration: chain.expiration };
}

/** Analyze an arbitrary set of legs (custom builder). */
export function analyzeCustom(symbol: string, legs: Leg[], chain: EnrichedChain, scenario: Scenario, now: number): StrategyResult {
  const t: Template = {
    id: "custom",
    name: "Custom Strategy",
    bias: "neutral",
    outlooks: [],
    profiles: [],
    definedRisk: true,
    build: () => null,
  };
  const res = finalize(t, legs, `${symbol} Custom Position`, { symbol, chain, scenario, now });
  res.definedRisk = res.metrics.maxLoss !== Infinity;
  const d = res.metrics.greeks.delta;
  res.bias = d > 5 ? "bullish" : d < -5 ? "bearish" : "neutral";
  return res;
}
