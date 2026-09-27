// Plain-English explanations. This is a deterministic, rule-based generator that follows
// the product's language rules (no advice, no guarantees, always state trade-offs).
// It sits behind a single function so an LLM-backed explainer can replace it later
// (see ExplanationProvider) without changing any UI.

import { money, pct, strike as fmtK } from "../format";
import type { EnrichedChain } from "./chain";
import { expectedMove } from "./math";
import type { Leg, PositionMetrics } from "./position";
import { HORIZONS, type Explanation, type Scenario, type StrategyId } from "./types";

export interface ExplainInput {
  symbol: string;
  chain: EnrichedChain;
  scenario: Scenario;
  legs: Leg[];
  metrics: PositionMetrics;
}

export interface ExplanationProvider {
  explain(templateId: StrategyId, input: ExplainInput): Promise<Explanation>;
}

export function scenarioSentence(symbol: string, spot: number, s: Scenario): string {
  const h = HORIZONS.find((x) => x.key === s.horizon)?.label ?? s.horizon;
  const move = (s.targetPrice - spot) / spot;
  const dir = Math.abs(move) < 0.01 ? "stay near" : "reach";
  return `${symbol} is currently ${money(spot)}. You expect it to ${dir} ${money(s.targetPrice)} (${pct(move, { sign: true })}) within ${h}.`;
}

const k = (legs: Leg[], i: number) => fmtK(legs[i]?.strike);

export function explainStrategy(id: StrategyId, x: ExplainInput): Explanation {
  const { symbol, chain, scenario, legs, metrics: m } = x;
  const spot = chain.spot;
  const move = (scenario.targetPrice - spot) / spot;
  const moveTxt = `${pct(Math.abs(move))} ${move >= 0 ? "upside" : "downside"}`;
  const em = expectedMove(spot, chain.atmIv, chain.T);
  const be = m.breakevens.map((b) => money(b)).join(" and ") || "n/a";
  const popTxt = m.pop !== null ? `the model estimates roughly a ${pct(m.pop, { decimals: 0 })} probability of finishing above zero at expiration` : "";
  const tgtTxt = `Under these assumptions, the estimated P/L at ${money(scenario.targetPrice)} on ${chain.expiration} is ${money(m.pnlAtTarget, { sign: true })}.`;

  let summary = "";
  let why = "";
  let structure = "";
  const tradeOffs: string[] = [];

  switch (id) {
    case "long_call":
      structure = `Buy one ${k(legs, 0)} call expiring ${chain.expiration}.`;
      summary = `A long call gains value as ${symbol} rises above ${k(legs, 0)}, with the loss limited to the ${money(m.netPremium)} premium paid.`;
      why = `Because your target implies about ${moveTxt}, a long call offers leveraged exposure to that move for a fraction of the cost of 100 shares. ${tgtTxt}`;
      tradeOffs.push(`The stock needs to finish above ${be} at expiration just to break even — a move of ${pct((m.breakevens[0] - spot) / spot, { sign: true })}.`);
      tradeOffs.push("Time decay works against the position every day, and a drop in implied volatility can reduce its value even if the stock rises.");
      tradeOffs.push("If the move happens after expiration, the premium can be lost in full.");
      break;
    case "bull_call_spread":
    case "otm_call_debit_spread":
      structure = `Buy the ${k(legs, 0)} call and sell the ${k(legs, 1)} call, both expiring ${chain.expiration}.`;
      summary = `A call debit spread profits between ${k(legs, 0)} and ${k(legs, 1)}. Selling the upper call reduces the cost compared with buying a call outright.`;
      why =
        Math.abs((legs[1]?.strike ?? 0) - scenario.targetPrice) / spot < 0.03
          ? `Your target of ${money(scenario.targetPrice)} sits near the short strike, which is where this structure reaches its maximum value. The defined-risk structure limits the maximum loss to the ${money(m.netPremium)} debit. ${tgtTxt}`
          : (legs[0]?.strike ?? 0) > spot
            ? `Both strikes sit above the current price, so the position is cheaper than an at-the-money spread but needs ${symbol} to move meaningfully toward ${money(scenario.targetPrice)}. ${tgtTxt}`
            : `The defined-risk structure limits the maximum loss to the ${money(m.netPremium)} debit while capturing the move toward ${money(scenario.targetPrice)}. ${tgtTxt}`;
      tradeOffs.push(`Upside is capped at ${money(m.maxProfit)} above ${k(legs, 1)}; any move beyond that level does not add profit.`);
      tradeOffs.push(`Breakeven at expiration is ${be}.`);
      if (id === "otm_call_debit_spread") tradeOffs.push("Because it starts out of the money, the model assigns a lower probability of profit than an at-the-money spread.");
      break;
    case "bull_put_spread":
      structure = `Sell the ${k(legs, 0)} put and buy the ${k(legs, 1)} put, both expiring ${chain.expiration}.`;
      summary = `A put credit spread collects ${money(-m.netPremium)} up front and keeps it if ${symbol} stays above ${k(legs, 0)} at expiration.`;
      why = `This structure may fit a view where ${symbol} holds steady or rises — it does not require your full target to be reached. ${popTxt ? popTxt.charAt(0).toUpperCase() + popTxt.slice(1) + "." : ""} ${tgtTxt}`;
      tradeOffs.push(`Maximum profit is limited to the ${money(m.maxProfit)} credit, even if ${symbol} reaches or exceeds your target.`);
      tradeOffs.push(`The maximum loss of ${money(m.maxLoss)} occurs below ${k(legs, 1)} — the loss is larger than the potential gain, which is typical of higher-probability credit structures.`);
      tradeOffs.push("Short puts can be assigned early, especially if they move deep in the money.");
      break;
    case "cash_secured_put":
      structure = `Sell one ${k(legs, 0)} put expiring ${chain.expiration}, reserving cash to buy 100 shares at ${k(legs, 0)} if assigned.`;
      summary = `Collects ${money(-m.netPremium)} of premium. If ${symbol} is below ${k(legs, 0)} at expiration you would likely buy 100 shares at an effective cost of ${be}.`;
      why = `This structure may suit an investor who is bullish-to-neutral and would be comfortable owning ${symbol} at a lower price. ${tgtTxt}`;
      tradeOffs.push(`Profit is capped at the premium received; upside beyond that toward ${money(scenario.targetPrice)} is not captured.`);
      tradeOffs.push(`It ties up about ${money(m.capital)} of cash, and downside risk is similar to owning the stock below the breakeven.`);
      break;
    case "covered_call":
      structure = `Own 100 shares of ${symbol} and sell one ${k(legs, 1)} call expiring ${chain.expiration}.`;
      summary = `The call premium (${money(Math.abs(legs[1].premium * 100))}) lowers the effective cost of the shares, in exchange for capping gains above ${k(legs, 1)}.`;
      why = `With a target near ${money(scenario.targetPrice)}, selling a call around that level may generate income while the stock moves toward it. ${tgtTxt}`;
      tradeOffs.push(`Gains above ${k(legs, 1)} are given up — the shares may be called away.`);
      tradeOffs.push(`The downside is nearly the same as owning the stock outright; the premium only cushions the first ${money(legs[1].premium)} per share of decline.`);
      tradeOffs.push("Requires the capital to purchase 100 shares.");
      break;
    case "long_put":
      structure = `Buy one ${k(legs, 0)} put expiring ${chain.expiration}.`;
      summary = `A long put gains value as ${symbol} falls below ${k(legs, 0)}, with the loss limited to the ${money(m.netPremium)} premium paid.`;
      why = `Your target implies about ${moveTxt}. A long put provides leveraged downside exposure with a known maximum loss. ${tgtTxt}`;
      tradeOffs.push(`${symbol} needs to finish below ${be} at expiration to break even.`);
      tradeOffs.push("Time decay and falling implied volatility work against the position.");
      break;
    case "bear_put_spread":
      structure = `Buy the ${k(legs, 0)} put and sell the ${k(legs, 1)} put, both expiring ${chain.expiration}.`;
      summary = `A put debit spread profits as ${symbol} falls toward ${k(legs, 1)}, at a lower cost than buying the put alone.`;
      why = `Your target of ${money(scenario.targetPrice)} is close to the short strike, where this structure reaches its maximum value. ${tgtTxt}`;
      tradeOffs.push(`Profit is capped at ${money(m.maxProfit)} below ${k(legs, 1)}.`);
      tradeOffs.push(`Breakeven at expiration is ${be}.`);
      break;
    case "bear_call_spread":
      structure = `Sell the ${k(legs, 0)} call and buy the ${k(legs, 1)} call, both expiring ${chain.expiration}.`;
      summary = `A call credit spread collects ${money(-m.netPremium)} and keeps it if ${symbol} stays below ${k(legs, 0)}.`;
      why = `This structure may fit a view that ${symbol} stays flat or declines — it does not require the stock to fall all the way to your target. ${tgtTxt}`;
      tradeOffs.push(`Maximum profit is limited to the credit (${money(m.maxProfit)}).`);
      tradeOffs.push(`A rally above ${k(legs, 1)} produces the maximum loss of ${money(m.maxLoss)}.`);
      break;
    case "iron_condor":
      structure = `Sell the ${k(legs, 1)} put and ${k(legs, 2)} call, and buy the ${k(legs, 0)} put and ${k(legs, 3)} call as protection, all expiring ${chain.expiration}.`;
      summary = `An iron condor collects ${money(-m.netPremium)} and keeps it if ${symbol} stays between ${k(legs, 1)} and ${k(legs, 2)}.`;
      why = `For a range-bound view, the profit zone spans ${be}. The options market implies a one-standard-deviation move of about ±${money(em)} by expiration. ${tgtTxt}`;
      tradeOffs.push(`Maximum profit is the credit; a sharp move in either direction produces losses up to ${money(m.maxLoss)}.`);
      tradeOffs.push("Four legs mean four bid/ask spreads, so execution costs are higher.");
      break;
    case "call_butterfly":
    case "put_butterfly":
      structure = `Buy one ${k(legs, 0)}, sell two ${k(legs, 1)}, and buy one ${k(legs, 2)} ${id === "call_butterfly" ? "calls" : "puts"}, all expiring ${chain.expiration}.`;
      summary = `A butterfly is a low-cost structure that reaches its maximum value if ${symbol} finishes exactly at ${k(legs, 1)} at expiration.`;
      why = `It is centred on your ${money(scenario.targetPrice)} target, so it expresses a precise price view for a small debit of ${money(m.netPremium)}. ${tgtTxt}`;
      tradeOffs.push(`The profit zone is narrow (${be}); if ${symbol} misses the target by a wide margin, most or all of the debit can be lost.`);
      tradeOffs.push("Maximum profit is typically only reached very close to expiration.");
      break;
    case "short_strangle":
      structure = `Sell the ${k(legs, 0)} put and the ${k(legs, 1)} call, both expiring ${chain.expiration}, with no protective wings.`;
      summary = `A short strangle collects ${money(-m.netPremium)} and keeps it if ${symbol} stays between the two strikes.`;
      why = `For a neutral view, this structure has a wide profit zone (${be}). ${popTxt ? popTxt.charAt(0).toUpperCase() + popTxt.slice(1) + "." : ""}`;
      tradeOffs.push("Risk is undefined: a large move — especially to the upside — can create losses far larger than the premium received.");
      tradeOffs.push(`Margin requirements are significant (estimated ~${money(m.capital)}) and can increase if the stock moves against the position.`);
      tradeOffs.push("Generally only suitable for experienced traders with appropriate account approval.");
      break;
    case "custom":
    default:
      structure = describeStructure(symbol, legs);
      summary = `Custom position with net ${m.netPremium >= 0 ? "debit" : "credit"} of ${money(Math.abs(m.netPremium))}.`;
      why = tgtTxt;
      if (m.maxLoss === Infinity) tradeOffs.push("This position has undefined (theoretically unlimited) risk.");
      if (m.maxProfit !== Infinity) tradeOffs.push(`Profit is capped at ${money(m.maxProfit)}.`);
      tradeOffs.push(`Breakeven(s) at expiration: ${be}.`);
  }

  return {
    scenario: scenarioSentence(symbol, spot, scenario),
    summary,
    whyItFits: why.trim(),
    tradeOffs,
    structure,
    source: "rule-based",
  };
}

/** Recognise common structures from arbitrary legs, and describe them in plain English. */
export function describeStructure(symbol: string, legs: Leg[]): string {
  if (!legs.length) return "No legs yet.";
  const opts = legs.filter((l) => l.instrument !== "stock");
  const stock = legs.filter((l) => l.instrument === "stock");
  const sameExp = new Set(opts.map((l) => l.expiration)).size <= 1;
  const sorted = [...opts].sort((a, b) => (a.strike ?? 0) - (b.strike ?? 0));
  const types = new Set(opts.map((l) => l.instrument));
  let name = "";

  if (stock.length === 1 && opts.length === 1 && opts[0].instrument === "call" && opts[0].action === "sell" && stock[0].action === "buy") name = "covered call";
  else if (stock.length === 1 && opts.length === 1 && opts[0].instrument === "put" && opts[0].action === "buy" && stock[0].action === "buy") name = "protective put";
  else if (!stock.length && opts.length === 1) name = `${opts[0].action === "buy" ? "long" : "short"} ${opts[0].instrument}`;
  else if (!stock.length && opts.length === 2 && sameExp && types.size === 1) {
    const [lo, hi] = sorted;
    const t = lo.instrument;
    if (lo.action !== hi.action && lo.quantity === hi.quantity) {
      if (t === "call") name = lo.action === "buy" ? "bull call spread (call debit spread)" : "bear call spread (call credit spread)";
      else name = hi.action === "buy" ? "bear put spread (put debit spread)" : "bull put spread (put credit spread)";
    } else if (lo.action === hi.action) name = `${lo.action === "buy" ? "long" : "short"} pair of ${t}s`;
  } else if (!stock.length && opts.length === 2 && sameExp && types.size === 2 && opts[0].action === opts[1].action) {
    const same = opts[0].strike === opts[1].strike;
    name = `${opts[0].action === "buy" ? "long" : "short"} ${same ? "straddle" : "strangle"}`;
  } else if (!stock.length && opts.length === 2 && !sameExp && types.size === 1 && opts[0].strike === opts[1].strike && opts[0].action !== opts[1].action)
    name = "calendar spread";
  else if (!stock.length && opts.length === 3 && sameExp && types.size === 1 && sorted[1].quantity === 2 * sorted[0].quantity && sorted[0].action === sorted[2].action && sorted[1].action !== sorted[0].action)
    name = `${sorted[0].action === "buy" ? "long" : "short"} ${sorted[0].instrument} butterfly`;
  else if (!stock.length && opts.length === 4 && sameExp && types.size === 2) name = "iron condor / iron butterfly-type structure";

  const legTxt = legs
    .map((l) =>
      l.instrument === "stock"
        ? `${l.action} ${l.quantity} shares at ${money(l.premium)}`
        : `${l.action} ${l.quantity} ${fmtK(l.strike)} ${l.instrument}${l.quantity > 1 ? "s" : ""} (${l.expiration})`,
    )
    .join("; ");
  return `${name ? `This looks like a ${name} on ${symbol}. ` : ""}Legs: ${legTxt}.`;
}
