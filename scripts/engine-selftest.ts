// Engine sanity checks: closed-form invariants + a live run against the market-data service.
// Run: npm test   (requires the Python service for the live section; skipped if unreachable)
import assert from "node:assert/strict";
import { bsPrice, impliedVol, bsGreeks } from "../src/lib/engine/math";
import { enrichChain, pickExpiration, type EnrichedChain } from "../src/lib/engine/chain";
import { analyzePosition, type Leg } from "../src/lib/engine/position";
import { generateStrategies } from "../src/lib/engine/strategies";
import { expirationsToSearch, maxEdgeUnderMarketView, recommend } from "../src/lib/engine/recommend";
import type { RawChain } from "../src/lib/market-data/types";

const close = (a: number, b: number, tol = 1e-2) => assert.ok(Math.abs(a - b) < tol, `${a} !~ ${b}`);

// --- Black-Scholes reference value (S=100,K=100,T=1,r=5%,σ=20%): call 10.4506, put 5.5735
close(bsPrice({ S: 100, K: 100, T: 1, r: 0.05, q: 0, sigma: 0.2, type: "call" }), 10.4506);
close(bsPrice({ S: 100, K: 100, T: 1, r: 0.05, q: 0, sigma: 0.2, type: "put" }), 5.5735);
close(impliedVol(10.4506, { S: 100, K: 100, T: 1, r: 0.05, q: 0, type: "call" })!, 0.2, 1e-3);
close(bsGreeks({ S: 100, K: 100, T: 1, r: 0.05, q: 0, sigma: 0.2, type: "call" }).delta, 0.6368, 1e-3);
console.log("✓ Black-Scholes / IV / Greeks");

// --- Bull call spread invariants: 100/110 for 4.00 debit → max profit 600, max loss 400, BE 104
const ctx = { spot: 100, r: 0.04, q: 0, now: Date.UTC(2026, 0, 1) };
const exp = "2026-03-20";
const legs: Leg[] = [
  { id: "a", instrument: "call", action: "buy", quantity: 1, strike: 100, expiration: exp, premium: 6, iv: 0.3 },
  { id: "b", instrument: "call", action: "sell", quantity: 1, strike: 110, expiration: exp, premium: 2, iv: 0.3 },
];
let m = analyzePosition(legs, ctx, { target: 110 });
close(m.maxProfit, 600);
close(m.maxLoss, 400);
close(m.breakevens[0], 104);
close(m.capital, 400);
close(m.pnlAtTarget, 600);
assert.ok(m.pop! > 0 && m.pop! < 1);
console.log("✓ Bull call spread metrics", { pop: m.pop!.toFixed(3) });

// --- Long call: unlimited profit, BE = K + premium
m = analyzePosition([legs[0]], ctx, { target: 120 });
assert.equal(m.maxProfit, Infinity);
close(m.maxLoss, 600);
close(m.breakevens[0], 106);
// --- Short strangle: unlimited loss, two breakevens
m = analyzePosition(
  [
    { id: "p", instrument: "put", action: "sell", quantity: 1, strike: 90, expiration: exp, premium: 1.5, iv: 0.3 },
    { id: "c", instrument: "call", action: "sell", quantity: 1, strike: 110, expiration: exp, premium: 2, iv: 0.3 },
  ],
  ctx,
  { target: 100 },
);
assert.equal(m.maxLoss, Infinity);
close(m.maxProfit, 350);
assert.equal(m.breakevens.length, 2);
close(m.breakevens[0], 86.5);
close(m.breakevens[1], 113.5);
// --- Covered call: capped profit, finite loss
m = analyzePosition(
  [
    { id: "s", instrument: "stock", action: "buy", quantity: 100, premium: 100 },
    { id: "c", instrument: "call", action: "sell", quantity: 1, strike: 110, expiration: exp, premium: 2, iv: 0.3 },
  ],
  ctx,
  { target: 110 },
);
close(m.maxProfit, 1200);
close(m.maxLoss, 9800);
close(m.breakevens[0], 98);
// --- Iron butterfly-ish butterfly
m = analyzePosition(
  [
    { id: "1", instrument: "call", action: "buy", quantity: 1, strike: 95, expiration: exp, premium: 8, iv: 0.3 },
    { id: "2", instrument: "call", action: "sell", quantity: 2, strike: 100, expiration: exp, premium: 5, iv: 0.3 },
    { id: "3", instrument: "call", action: "buy", quantity: 1, strike: 105, expiration: exp, premium: 3, iv: 0.3 },
  ],
  ctx,
  { target: 100 },
);
close(m.maxLoss, 100);
close(m.maxProfit, 400);
close(m.breakevens[0], 96);
close(m.breakevens[1], 104);
console.log("✓ Long call / strangle / covered call / butterfly invariants");

// --- Live run
const base = process.env.YFINANCE_SERVICE_URL ?? "http://127.0.0.1:8765";
async function live() {
  const sym = process.argv[2] ?? "NVDA";
  const quote = (await (await fetch(`${base}/quote/${sym}`)).json()).quote;
  const exps: string[] = (await (await fetch(`${base}/options/${sym}/expirations`)).json()).expirations;
  const now = Date.now();
  const expiration = pickExpiration(exps, 91, now)!;
  const raw: RawChain = (await (await fetch(`${base}/options/${sym}/chain?expiration=${expiration}`)).json()).chain;
  const chain: EnrichedChain = enrichChain(sym, raw, { spot: quote.price, r: 0.04, q: quote.dividendYield, now });
  console.log(`\nLive ${sym} spot=${quote.price} exp=${expiration} dte=${chain.dte} atmIv=${chain.atmIv.toFixed(3)} lastPrices=${chain.usesLastPrices}`);
  for (const outlook of ["moderately_bullish", "bullish", "neutral", "bearish"] as const) {
    const target = outlook.includes("bull") ? quote.price * 1.1 : outlook === "bearish" ? quote.price * 0.9 : quote.price;
    const res = generateStrategies({ symbol: sym, chain, now, scenario: { targetPrice: Math.round(target), horizon: "3m", outlook, preference: "all", maxCapital: outlook === "moderately_bullish" ? 2000 : undefined } });
    console.log(`\n[${outlook}] target=${Math.round(target)}  warnings=${res.warnings.length}`);
    for (const s of res.strategies) {
      const x = s.metrics;
      console.log(
        `  ${s.label.padEnd(48)} cap=${x.capital.toFixed(0).padStart(6)} maxP=${String(x.maxProfit === Infinity ? "∞" : x.maxProfit.toFixed(0)).padStart(6)} maxL=${String(x.maxLoss === Infinity ? "∞" : x.maxLoss.toFixed(0)).padStart(6)} BE=${x.breakevens.map((b) => b.toFixed(2)).join("/")} POP=${(x.pop! * 100).toFixed(0)}% @tgt=${x.pnlAtTarget.toFixed(0)} θ=${x.greeks.theta.toFixed(2)}`,
      );
    }
    for (const e of res.excluded) console.log(`  - excluded ${e.name}: ${e.reason}`);
  }

  // Goal-oriented recommender across neighbouring expirations
  const exps3 = expirationsToSearch(exps, 91, now);
  const chains = await Promise.all(
    exps3.map(async (e) => enrichChain(sym, (await (await fetch(`${base}/options/${sym}/chain?expiration=${e}`)).json()).chain, { spot: quote.price, r: 0.04, q: quote.dividendYield, now })),
  );
  for (const ch of chains) {
    const w = maxEdgeUnderMarketView(sym, ch);
    assert.ok(Math.abs(w.edge) < 0.01, `phantom edge under market view: ${w.label} ${w.edge}`);
    console.log(`✓ No phantom edge under market view on ${ch.expiration} (max |E|/capital before costs = ${(w.edge * 100).toFixed(3)}%)`);
  }
  for (const [pref, target, cap, vol] of [["balanced", 1.1, 2000, 1], ["conservative", 1.1, undefined, 1], ["aggressive", 1.1, undefined, 1], ["balanced", 1.0, undefined, 1], ["balanced", 1.0, undefined, 0.75], ["conservative", 1.0, 5000, 0.75], ["balanced", 0.9, 3000, 1]] as const) {
    const t0 = performance.now();
    const res = recommend({ symbol: sym, chains, horizonDays: 91, now, scenario: { targetPrice: Math.round(quote.price * target), horizon: "3m", outlook: "moderately_bullish", preference: pref, maxCapital: cap, volView: vol } });
    const r = res.recommendation!;
    const p = r.pick;
    console.log(
      `\n[recommend ${pref} target×${target} cap=${cap ?? "-"} vol×${vol}] ${r.candidatesEvaluated} candidates in ${(performance.now() - t0).toFixed(0)}ms over ${r.expirationsSearched.join(",")}`,
    );
    console.log(p ? `  PICK ${p.label} ${p.expiration} score=${p.score!.value.toFixed(3)} E[P/L]=${p.score!.expectedPnl.toFixed(0)} sd=${p.score!.stdPnl.toFixed(0)} popView=${(p.score!.popView * 100).toFixed(0)}% cap=${p.metrics.capital.toFixed(0)}` : `  NO TRADE: ${r.noTradeReason}`);
    for (const s of res.strategies.slice(1, 4)) console.log(`   #${s.score!.rank} ${s.label.padEnd(44)} score=${s.score!.value.toFixed(3)} E=${s.score!.expectedPnl.toFixed(0)}`);
    for (const d of r.drivers) console.log(`   · ${d.label}: Δ=${d.delta.toFixed(3)} same=${d.samePick} → ${d.pickUnder}`);
  }
}
live().catch((e) => console.log(`\n(live section skipped: ${e.message})`));
