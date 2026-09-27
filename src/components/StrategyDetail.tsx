"use client";

import { Loader2, Wrench, X } from "lucide-react";
import { useEffect, useState } from "react";
import clsx from "clsx";
import type { EnrichedChain, PricingContext } from "@/lib/engine/chain";
import { optimizeFamily } from "@/lib/engine/recommend";
import { HORIZONS, type Scenario, type StrategyResult } from "@/lib/engine/types";
import { fmtDate, money, num, pct, riskRewardText, strike as fmtK } from "@/lib/format";
import { BiasChip, RiskChip } from "./StrategyCard";
import { PayoffChart } from "./PayoffChart";
import { ScenarioSimulator } from "./ScenarioSimulator";
import { RiskAnalysis } from "./RiskAnalysis";
import { ModelTag } from "./DataBadge";

type Tab = "why" | "whatif" | "risk" | "legs";

export function StrategyExplanation({ s }: { s: StrategyResult }) {
  const e = s.explanation;
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-line bg-surface-2 p-4">
        <div className="label">Your scenario</div>
        <p className="mt-1 text-sm">{e.scenario}</p>
      </div>
      <div>
        <div className="flex items-center gap-2">
          <div className="label">Why this structure may fit</div>
          <ModelTag>{e.source === "ai" ? "AI-generated" : "Generated explanation"}</ModelTag>
        </div>
        <p className="mt-1.5 text-sm leading-relaxed">{e.summary}</p>
        <p className="mt-2 text-sm leading-relaxed text-ink-2">{e.whyItFits}</p>
      </div>
      <div>
        <div className="label">Trade-offs</div>
        <ul className="mt-1.5 space-y-1.5">
          {e.tradeOffs.map((t) => (
            <li key={t} className="flex gap-2 text-sm leading-relaxed text-ink-2">
              <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-ink-2" />
              {t}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <div className="label">Structure</div>
        <p className="mt-1.5 text-sm text-ink-2">{e.structure}</p>
      </div>
      <p className="text-xs text-muted">This is an analytical scenario based on your assumptions and the market data shown — not a recommendation to trade.</p>
    </div>
  );
}

export function LegsTable({ s }: { s: StrategyResult }) {
  const g = s.metrics.greeks;
  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-line">
            <tr>
              <th className="th">Action</th>
              <th className="th">Contract</th>
              <th className="th text-right">Premium</th>
              <th className="th text-right">Bid / Ask</th>
              <th className="th text-right">IV</th>
              <th className="th text-right">OI</th>
              <th className="th">Price source</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {s.legs.map((l) => (
              <tr key={l.id}>
                <td className={clsx("td font-semibold", l.action === "buy" ? "text-gain" : "text-loss")}>{l.action === "buy" ? "+ Buy" : "− Sell"} {l.quantity}</td>
                <td className="td">{l.instrument === "stock" ? "Shares" : `${fmtK(l.strike)} ${l.instrument} · ${l.expiration}`}</td>
                <td className="td text-right">{money(l.premium)}</td>
                <td className="td text-right">{l.contract && l.contract.bid > 0 ? `${money(l.contract.bid)} / ${money(l.contract.ask)}` : "—"}</td>
                <td className="td text-right">{l.iv ? pct(l.iv) : "—"}</td>
                <td className="td text-right">{l.contract ? num(l.contract.openInterest) : "—"}</td>
                <td className="td text-xs text-muted">{l.instrument === "stock" ? "last price" : l.contract?.premiumSource === "mid" ? "bid/ask mid" : l.contract?.premiumSource === "last" ? "last trade" : "model"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <div className="flex items-center gap-2">
          <div className="label">Position Greeks</div>
          <ModelTag>Black-Scholes</ModelTag>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { k: "Delta", v: num(g.delta, 1), d: "≈ share-equivalent exposure" },
            { k: "Gamma", v: num(g.gamma, 2), d: "delta change per $1" },
            { k: "Theta", v: money(g.theta, { sign: true }), d: "per day, all else equal" },
            { k: "Vega", v: money(g.vega, { sign: true }), d: "per 1 pt of IV" },
          ].map((x) => (
            <div key={x.k} className="rounded-xl border border-line p-3">
              <div className="label">{x.k}</div>
              <div className="mt-0.5 font-semibold tnum">{x.v}</div>
              <div className="text-[11px] text-muted">{x.d}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function StrategyDetail({
  strategy: initial,
  symbol,
  ctx,
  scenario,
  expirations,
  loadChain,
  onClose,
  onCustomize,
}: {
  strategy: StrategyResult;
  symbol: string;
  ctx: PricingContext;
  scenario: Scenario;
  expirations: string[];
  loadChain: (exp: string) => Promise<EnrichedChain>;
  onClose: () => void;
  onCustomize: (s: StrategyResult) => void;
}) {
  const [s, setS] = useState(initial);
  const [tab, setTab] = useState<Tab>("why");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => setS(initial), [initial]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", h);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const changeExpiration = async (exp: string) => {
    setBusy(true);
    setErr(null);
    try {
      const chain = await loadChain(exp);
      const horizonDays = HORIZONS.find((h) => h.key === scenario.horizon)?.days ?? 30;
      // Re-optimise strikes for this structure on the new expiration (same objective as the search)
      const res = optimizeFamily(s.templateId, chain, { symbol, scenario, horizonDays, now: Date.now() });
      if ("error" in res) setErr(res.error);
      else setS(res);
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  };

  const m = s.metrics;
  const futureExps = expirations;
  const expSelect =
    s.templateId !== "custom" ? (
      <label className="flex items-center gap-2 text-xs text-ink-2">
        {busy && <Loader2 size={14} className="animate-spin" />}
        Expiration
        <select className="input w-auto py-1 text-xs" value={s.expiration} onChange={(e) => changeExpiration(e.target.value)} disabled={busy}>
          {futureExps.map((e) => (
            <option key={e} value={e}>{fmtDate(e)}</option>
          ))}
        </select>
      </label>
    ) : null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-[2px]" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${s.name} details`}
        className="h-full w-full max-w-4xl animate-slide-in overflow-y-auto border-l border-line bg-canvas shadow-pop"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-line bg-canvas/90 px-5 py-4 backdrop-blur sm:px-8">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold">{s.name}</h2>
              <BiasChip bias={s.bias} />
              <RiskChip defined={s.definedRisk} />
            </div>
            <p className="mt-0.5 font-mono text-sm text-ink-2">{s.label} · {fmtDate(s.expiration)}</p>
          </div>
          <button onClick={onClose} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line hover:bg-surface-2" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-6 px-5 py-6 sm:px-8">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { k: "Capital required", v: money(m.capital), sub: m.capitalBasis === "estimated-margin" ? "estimated margin" : m.capitalBasis === "net-debit" ? "net debit" : "collateral" },
              { k: "Max profit", v: money(m.maxProfit), tone: "gain" },
              { k: "Max loss", v: money(m.maxLoss), tone: "loss" },
              { k: "Breakeven", v: m.breakevens.map((b) => money(b)).join(" / ") || "—" },
              { k: "Max return", v: m.returnOnCapital === Infinity ? "Unlimited" : pct(m.returnOnCapital, { decimals: 0 }) },
              s.score
                ? { k: "Exp. P/L (your view)", v: money(s.score.expectedPnl, { sign: true }), sub: `${pct(s.score.popView, { decimals: 0 })} chance of profit · ${pct(m.pop, { decimals: 0 })} market`, tone: s.score.expectedPnl >= 0 ? "gain" : "loss" }
                : { k: "Prob. of profit", v: pct(m.pop, { decimals: 0 }), sub: "model estimate" },
              { k: `P/L at ${money(scenario.targetPrice)}`, v: money(m.pnlAtTarget, { sign: true }), tone: m.pnlAtTarget >= 0 ? "gain" : "loss" },
              { k: "Risk / reward", v: riskRewardText(m.riskReward, m.maxProfit) },
            ].map((x) => (
              <div key={x.k} className="card p-3.5">
                <div className="label">{x.k}</div>
                <div className={clsx("mt-1 text-base font-semibold tnum", x.tone === "gain" && "text-gain", x.tone === "loss" && "text-loss")}>{x.v}</div>
                {x.sub && <div className="text-[11px] text-muted">{x.sub}</div>}
              </div>
            ))}
          </div>

          <section className="card p-5">
            <h3 className="mb-3 font-semibold">Payoff diagram</h3>
            {err && <p className="mb-2 rounded-lg bg-warn/10 px-3 py-2 text-sm text-warn">{err}</p>}
            <PayoffChart legs={s.legs} metrics={m} ctx={ctx} target={scenario.targetPrice} symbol={symbol} headerSlot={expSelect} />
          </section>

          <section className="card p-5">
            <div className="mb-4 flex gap-1 overflow-x-auto border-b border-line">
              {(
                [
                  ["why", "Why this strategy?"],
                  ["whatif", "What If?"],
                  ["risk", "Risk analysis"],
                  ["legs", "Legs & Greeks"],
                ] as [Tab, string][]
              ).map(([k, l]) => (
                <button
                  key={k}
                  onClick={() => setTab(k)}
                  className={clsx("-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition", tab === k ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink")}
                >
                  {l}
                </button>
              ))}
            </div>
            {tab === "why" && <StrategyExplanation s={s} />}
            {tab === "whatif" && <ScenarioSimulator legs={s.legs} metrics={m} ctx={ctx} target={scenario.targetPrice} symbol={symbol} />}
            {tab === "risk" && <RiskAnalysis risks={s.risks} />}
            {tab === "legs" && <LegsTable s={s} />}
          </section>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted">Per 1-lot. Excludes commissions and fees. Model values assume constant implied volatility.</p>
            <button className="btn-ghost" onClick={() => onCustomize(s)}>
              <Wrench size={15} /> Customize in strategy builder
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
