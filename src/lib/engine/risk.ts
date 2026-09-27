// Plain-language risk breakdown for any position.

import { money, pct, strike as fmtK } from "../format";
import type { EnrichedChain } from "./chain";
import type { Leg, PositionMetrics } from "./position";
import type { RiskItem, StrategyId } from "./types";

export function buildRisks(x: { symbol: string; legs: Leg[]; metrics: PositionMetrics; chain: EnrichedChain; templateId: StrategyId }): RiskItem[] {
  const { symbol, legs, metrics: m, chain } = x;
  const shorts = legs.filter((l) => l.instrument !== "stock" && l.action === "sell");
  const items: RiskItem[] = [];

  items.push({
    key: "maxLoss",
    title: "Maximum loss",
    level: m.maxLoss === Infinity ? "high" : "info",
    value: money(m.maxLoss),
    text:
      m.maxLoss === Infinity
        ? "Losses are theoretically unlimited if the stock moves sharply against the position. Losses can exceed the capital initially set aside."
        : `The most this position can lose at expiration is ${money(m.maxLoss)} per 1-lot, under the modelled assumptions.`,
  });
  items.push({
    key: "maxProfit",
    title: "Maximum profit",
    level: "info",
    value: money(m.maxProfit),
    text: m.maxProfit === Infinity ? "Profit potential is theoretically unlimited as the stock moves in your favour." : `Gains are capped at ${money(m.maxProfit)} per 1-lot.`,
  });
  items.push({
    key: "breakeven",
    title: "Breakeven",
    level: "info",
    value: m.breakevens.map((b) => money(b)).join(" / ") || "—",
    text: m.breakevens.length
      ? `At expiration, ${symbol} needs to be ${m.breakevens.length > 1 ? "between / beyond these prices" : `${m.greeks.delta >= 0 ? "above" : "below"} ${money(m.breakevens[0])}`} for the position to show a profit.`
      : "No breakeven within the modelled price range.",
  });
  items.push({
    key: "capital",
    title: "Capital at risk",
    level: "info",
    value: money(m.capital),
    text:
      m.capitalBasis === "estimated-margin"
        ? `Roughly ${money(m.capital)} of margin may be required (a rule-of-thumb estimate; your broker's requirement may differ and can increase as the stock moves).`
        : m.capitalBasis === "net-debit"
          ? `You pay ${money(m.capital)} up front; that is the full amount at risk.`
          : `About ${money(m.capital)} is set aside as collateral / cost, which equals the maximum loss.`,
  });

  // Assignment
  if (shorts.length) {
    const itmShort = shorts.filter((l) => (l.instrument === "call" ? chain.spot > l.strike! : chain.spot < l.strike!));
    items.push({
      key: "assignment",
      title: "Assignment risk",
      level: itmShort.length ? "high" : "medium",
      text: `You are short ${shorts.map((l) => `${fmtK(l.strike)} ${l.instrument}`).join(", ")}. If a short option finishes in the money, you may be assigned — ${shorts.some((l) => l.instrument === "put") ? "buying 100 shares per short put" : ""}${shorts.some((l) => l.instrument === "put") && shorts.some((l) => l.instrument === "call") ? " or " : ""}${shorts.some((l) => l.instrument === "call") ? "delivering 100 shares per short call" : ""}.${itmShort.length ? " At least one short leg is currently in the money." : " The short legs are currently out of the money."}`,
    });
    const extrinsicLow = shorts.some((l) => {
      const intr = l.instrument === "call" ? Math.max(chain.spot - l.strike!, 0) : Math.max(l.strike! - chain.spot, 0);
      return intr > 0 && l.premium - intr < 0.1;
    });
    const nearDiv = chain.q > 0 && shorts.some((l) => l.instrument === "call");
    items.push({
      key: "earlyExercise",
      title: "Early exercise risk",
      level: extrinsicLow ? "high" : nearDiv ? "medium" : "low",
      text: `US equity options are American-style, so short options can be exercised before expiration. This is most likely when a short leg is deep in the money with little time value left${nearDiv ? ", or (for short calls) just before an ex-dividend date" : ""}. ${extrinsicLow ? "A short leg currently has very little time value." : "Current time value on the short legs makes early exercise less likely today."}`,
    });
  } else {
    items.push({ key: "assignment", title: "Assignment risk", level: "low", text: "No short options, so there is no assignment risk. Long options can be exercised at your discretion." });
    items.push({ key: "earlyExercise", title: "Early exercise risk", level: "low", text: "Not applicable — you hold only long positions." });
  }

  // Theta
  const theta = m.greeks.theta;
  items.push({
    key: "theta",
    title: "Time decay",
    level: theta < 0 ? (Math.abs(theta) > m.capital * 0.01 ? "high" : "medium") : "low",
    value: `${money(theta, { sign: true })}/day`,
    text:
      theta < 0
        ? `The position loses approximately ${money(Math.abs(theta))} in theoretical value per day from time decay, all else equal. Decay typically accelerates in the final weeks before expiration.`
        : `The position gains approximately ${money(theta)} in theoretical value per day from time decay, all else equal — time works in your favour if the stock behaves as expected.`,
  });

  // Vega
  const vega = m.greeks.vega;
  items.push({
    key: "vega",
    title: "Volatility risk",
    level: Math.abs(vega) > m.capital * 0.02 ? "medium" : "low",
    value: `${money(vega, { sign: true })} per vol pt`,
    text: `If implied volatility rises by 1 percentage point, the position's theoretical value changes by about ${money(vega, { sign: true })}. ${vega > 0 ? "A drop in volatility (for example after earnings) would hurt the position." : "A rise in volatility (for example ahead of earnings or on market stress) would hurt the position."} Current at-the-money IV for this expiration is about ${pct(chain.atmIv)}.`,
  });

  // Liquidity
  const l = m.liquidity;
  const spreadTxt = l.worstSpreadPct !== null ? `The widest bid/ask spread among the legs is ${pct(l.worstSpreadPct, { decimals: 0 })} of the mid price.` : "Live bid/ask quotes were not available for all legs.";
  const liqLevel = l.worstSpreadPct === null ? "medium" : l.worstSpreadPct > 0.15 || (l.minOpenInterest ?? 0) < 100 ? "high" : l.worstSpreadPct > 0.06 ? "medium" : "low";
  items.push({
    key: "liquidity",
    title: "Liquidity",
    level: liqLevel,
    value: l.minOpenInterest !== null ? `Min OI ${l.minOpenInterest.toLocaleString()}` : undefined,
    text: `${spreadTxt} ${l.roundTripCost > 0 ? `Crossing the spread to open and close could cost about ${money(l.roundTripCost)}. ` : ""}${l.usesLastPrices ? "Some premiums are based on last traded prices, which may be stale. " : ""}Lower open interest can mean wider spreads and harder exits.`,
  });

  const days = m.daysToEval;
  if (days <= 10)
    items.push({ key: "shortDated", title: "Short-dated position", level: "high", text: `Only ~${days} days to expiration. Prices can swing sharply (high gamma) and there is little time for the thesis to play out.` });

  return items;
}
