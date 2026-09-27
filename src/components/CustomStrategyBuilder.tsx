"use client";

import { Plus, Sparkles, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import type { EnrichedChain, OptionContract, PricingContext } from "@/lib/engine/chain";
import { legFromContract, netPremium, stockLeg, type Leg } from "@/lib/engine/position";
import { analyzeCustom } from "@/lib/engine/strategies";
import type { Scenario } from "@/lib/engine/types";
import { fmtDate, money, pct, riskRewardText } from "@/lib/format";
import { PayoffChart } from "./PayoffChart";
import { ScenarioSimulator } from "./ScenarioSimulator";
import { RiskAnalysis } from "./RiskAnalysis";
import { LegsTable, StrategyExplanation } from "./StrategyDetail";

export function CustomStrategyBuilder({
  symbol,
  ctx,
  scenario,
  expirations,
  defaultExpiration,
  loadChain,
  legs,
  setLegs,
}: {
  symbol: string;
  ctx: PricingContext;
  scenario: Scenario;
  expirations: string[];
  defaultExpiration: string | null;
  loadChain: (exp: string) => Promise<EnrichedChain>;
  legs: Leg[];
  setLegs: (fn: (l: Leg[]) => Leg[]) => void;
}) {
  const [chains, setChains] = useState<Record<string, EnrichedChain>>({});
  const [analyzed, setAnalyzed] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const ensure = useCallback(
    async (exp: string) => {
      if (chains[exp]) return chains[exp];
      const c = await loadChain(exp);
      setChains((m) => ({ ...m, [exp]: c }));
      return c;
    },
    [chains, loadChain],
  );

  // load chains needed by legs
  useEffect(() => {
    const need = new Set(legs.filter((l) => l.expiration).map((l) => l.expiration!));
    if (defaultExpiration) need.add(defaultExpiration);
    need.forEach((e) => {
      if (!chains[e]) ensure(e).catch((x) => setErr((x as Error).message));
    });
  }, [legs, defaultExpiration, chains, ensure]);

  const find = (exp: string, type: "call" | "put", strike: number): OptionContract | undefined =>
    (type === "call" ? chains[exp]?.calls : chains[exp]?.puts)?.find((c) => c.strike === strike);

  const update = (id: string, patch: Partial<Leg>, chainOverride?: EnrichedChain) =>
    setLegs((ls) =>
      ls.map((l) => {
        if (l.id !== id) return l;
        const next = { ...l, ...patch };
        if (next.instrument === "stock") return { ...next, strike: undefined, expiration: undefined, contract: undefined, iv: undefined, premium: patch.instrument ? ctx.spot : next.premium, quantity: patch.instrument ? 100 : next.quantity };
        if (patch.instrument && l.instrument === "stock") next.quantity = 1;
        const exp = next.expiration ?? defaultExpiration!;
        const chain = chainOverride ?? chains[exp];
        const strikeChanged = patch.strike !== undefined || patch.expiration !== undefined || patch.instrument !== undefined;
        if (chain && strikeChanged) {
          const list = next.instrument === "call" ? chain.calls : chain.puts;
          const k = next.strike ?? ctx.spot;
          const c = list.find((x) => x.strike === k) ?? list.reduce((b, x) => (Math.abs(x.strike - k) < Math.abs(b.strike - k) ? x : b), list[0]);
          if (c) {
            const fresh = legFromContract(c, next.action, next.quantity);
            return { ...fresh, id: l.id };
          }
        }
        return { ...next, expiration: exp };
      }),
    );

  const addOption = async () => {
    if (!defaultExpiration) return;
    const chain = await ensure(defaultExpiration);
    const c = chain.calls.reduce((b, x) => (Math.abs(x.strike - ctx.spot) < Math.abs(b.strike - ctx.spot) ? x : b), chain.calls[0]);
    if (c) setLegs((ls) => [...ls, legFromContract(c, "buy")]);
  };

  const result = useMemo(() => {
    if (!analyzed || !legs.length) return null;
    const exps = legs.filter((l) => l.expiration).map((l) => l.expiration!).sort();
    const chain = chains[exps[0] ?? defaultExpiration ?? ""];
    if (!chain) return null;
    try {
      return analyzeCustom(symbol, legs, chain, scenario, ctx.now);
    } catch {
      return null;
    }
  }, [analyzed, legs, chains, symbol, scenario, ctx.now, defaultExpiration]);

  const np = netPremium(legs);
  const m = result?.metrics;

  return (
    <section className="card p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Custom Strategy Builder</h2>
          <p className="text-xs text-muted">Build any position — add legs here or from the options chain. Prices default to the chain premium and can be edited.</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-ghost py-2" onClick={addOption} disabled={!defaultExpiration}><Plus size={15} /> Option leg</button>
          <button className="btn-ghost py-2" onClick={() => setLegs((ls) => [...ls, stockLeg(ctx.spot)])}><Plus size={15} /> Stock</button>
        </div>
      </div>

      {err && <p className="mt-3 text-sm text-loss">{err}</p>}

      <div className="mt-4 space-y-2">
        {legs.length === 0 && (
          <div className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-muted">
            No legs yet. Try <span className="font-mono">+ Buy 1 {symbol} call</span> and <span className="font-mono">− Sell 1 {symbol} call</span> at a higher strike to build a call spread.
          </div>
        )}
        {legs.map((l) => {
          const chain = l.expiration ? chains[l.expiration] : undefined;
          const strikes = chain ? (l.instrument === "put" ? chain.puts : chain.calls).map((c) => c.strike) : l.strike ? [l.strike] : [];
          return (
            <div key={l.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface-2/50 p-2.5">
              <div className="flex rounded-lg border border-line bg-surface p-0.5">
                {(["buy", "sell"] as const).map((a) => (
                  <button key={a} onClick={() => update(l.id, { action: a })} className={clsx("rounded-md px-2.5 py-1 text-xs font-semibold", l.action === a ? (a === "buy" ? "bg-gain/15 text-gain" : "bg-loss/15 text-loss") : "text-muted")}>
                    {a === "buy" ? "+ Buy" : "− Sell"}
                  </button>
                ))}
              </div>
              <input
                type="number"
                min={1}
                className="w-20 rounded-lg border border-line bg-surface px-2 py-1.5 text-sm tnum"
                value={l.quantity}
                onChange={(e) => update(l.id, { quantity: Math.max(1, parseInt(e.target.value) || 1) })}
                aria-label="Quantity"
              />
              <span className="text-sm text-muted">{symbol}</span>
              <select className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm" value={l.instrument} onChange={(e) => update(l.id, { instrument: e.target.value as Leg["instrument"], strike: l.strike, expiration: l.expiration ?? defaultExpiration ?? undefined })} aria-label="Instrument">
                <option value="call">Call</option>
                <option value="put">Put</option>
                <option value="stock">Shares</option>
              </select>
              {l.instrument !== "stock" && (
                <>
                  <select className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm tnum" value={l.strike} onChange={(e) => update(l.id, { strike: parseFloat(e.target.value) })} aria-label="Strike">
                    {strikes.map((k) => (
                      <option key={k} value={k}>${k}</option>
                    ))}
                  </select>
                  <select className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm" value={l.expiration} onChange={(e) => { const v = e.target.value; ensure(v).then((c) => update(l.id, { expiration: v, strike: l.strike }, c)); }} aria-label="Expiration">
                    {expirations.map((e) => (
                      <option key={e} value={e}>{fmtDate(e)}</option>
                    ))}
                  </select>
                </>
              )}
              <label className="flex items-center gap-1 text-xs text-muted">
                @
                <input
                  type="number"
                  step="0.01"
                  className="w-24 rounded-lg border border-line bg-surface px-2 py-1.5 text-sm tnum text-ink"
                  value={Number(l.premium.toFixed(2))}
                  onChange={(e) => update(l.id, { premium: Math.max(0, parseFloat(e.target.value) || 0) })}
                  aria-label="Price per share"
                />
              </label>
              <button onClick={() => setLegs((ls) => ls.filter((x) => x.id !== l.id))} className="ml-auto grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-loss/10 hover:text-loss" aria-label="Remove leg">
                <Trash2 size={15} />
              </button>
            </div>
          );
        })}
      </div>

      {legs.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm">
            Net premium: <span className={clsx("font-semibold tnum", np > 0 ? "text-loss" : "text-gain")}>{np > 0 ? `${money(np)} debit` : `${money(-np)} credit`}</span>
          </div>
          <div className="flex gap-2">
            <button className="btn-ghost py-2" onClick={() => { setLegs(() => []); setAnalyzed(false); }}>Clear</button>
            <button className="btn-primary py-2" onClick={() => setAnalyzed(true)}>
              <Sparkles size={15} /> Analyze Strategy
            </button>
          </div>
        </div>
      )}

      {result && m && (
        <div className="mt-6 space-y-6 border-t border-line pt-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { k: "Net premium", v: np > 0 ? `${money(np)} debit` : `${money(-np)} credit` },
              { k: "Max profit", v: money(m.maxProfit), tone: "gain" },
              { k: "Max loss", v: money(m.maxLoss), tone: "loss" },
              { k: "Breakeven", v: m.breakevens.map((b) => money(b)).join(" / ") || "—" },
              { k: "Capital", v: money(m.capital), sub: m.capitalBasis === "estimated-margin" ? "estimated margin" : undefined },
              { k: "Prob. of profit", v: pct(m.pop, { decimals: 0 }), sub: "model estimate" },
              { k: `P/L at ${money(scenario.targetPrice)}`, v: money(m.pnlAtTarget, { sign: true }), tone: m.pnlAtTarget >= 0 ? "gain" : "loss" },
              { k: "Risk / reward", v: riskRewardText(m.riskReward, m.maxProfit) },
            ].map((x) => (
              <div key={x.k} className="rounded-xl border border-line p-3">
                <div className="label">{x.k}</div>
                <div className={clsx("mt-0.5 font-semibold tnum", x.tone === "gain" && "text-gain", x.tone === "loss" && "text-loss")}>{x.v}</div>
                {x.sub && <div className="text-[11px] text-muted">{x.sub}</div>}
              </div>
            ))}
          </div>
          {!m.sameExpiration && <p className="rounded-lg bg-warn/10 px-3 py-2 text-sm text-warn">Legs have different expirations: “expiration” values are measured at the first expiration, with later legs valued by the model. Max profit/loss are estimates.</p>}
          <PayoffChart legs={legs} metrics={m} ctx={ctx} target={scenario.targetPrice} symbol={symbol} />
          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <h3 className="mb-3 font-semibold">Plain-English explanation</h3>
              <StrategyExplanation s={result} />
            </div>
            <div>
              <h3 className="mb-3 font-semibold">Legs & Greeks</h3>
              <LegsTable s={result} />
            </div>
          </div>
          <div>
            <h3 className="mb-3 font-semibold">What If?</h3>
            <ScenarioSimulator legs={legs} metrics={m} ctx={ctx} target={scenario.targetPrice} symbol={symbol} />
          </div>
          <div>
            <h3 className="mb-3 font-semibold">Risk analysis</h3>
            <RiskAnalysis risks={result.risks} />
          </div>
        </div>
      )}
    </section>
  );
}
