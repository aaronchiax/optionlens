"use client";

import { ArrowRight, BadgeCheck, Ban, CheckCircle2, CircleAlert, Cpu } from "lucide-react";
import clsx from "clsx";
import type { PricingContext } from "@/lib/engine/chain";
import { OBJECTIVES } from "@/lib/engine/recommend";
import type { Recommendation, Scenario } from "@/lib/engine/types";
import { fmtDate, money, pct, riskRewardText } from "@/lib/format";
import { BiasChip, MiniPayoff, RiskChip } from "./StrategyCard";

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "gain" | "loss" | "model" }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className={clsx("mt-0.5 text-lg font-semibold tnum", tone === "gain" && "text-gain", tone === "loss" && "text-loss", tone === "model" && "text-model")}>{value}</div>
      {sub && <div className="text-[11px] text-muted">{sub}</div>}
    </div>
  );
}

export function RecommendationPanel({ rec, ctx, scenario, onOpen }: { rec: Recommendation; ctx: PricingContext; scenario: Scenario; onOpen: () => void }) {
  const obj = OBJECTIVES.find((o) => o.key === rec.objective)!;
  const p = rec.pick;
  const s = p?.score;
  const maxAbs = Math.max(...rec.drivers.map((d) => Math.abs(d.delta)), 1e-9);

  return (
    <section className="card relative overflow-hidden">
      <div aria-hidden className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-model via-accent to-model" />
      <div className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-model/10 px-2.5 py-1 text-xs font-semibold text-model">
            <Cpu size={13} /> Model recommendation
          </span>
          <span className="chip">Objective: {obj.label.split(" — ")[1]}</span>
          <span className="chip">{rec.candidatesEvaluated.toLocaleString()} positions searched</span>
          <span className="chip">{rec.expirationsSearched.length} expirations</span>
        </div>

        {p && s ? (
          <>
            <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <BadgeCheck size={20} className="text-model" />
                  <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">{p.name}</h2>
                  <BiasChip bias={p.bias} />
                  <RiskChip defined={p.definedRisk} />
                </div>
                <p className="mt-1 font-mono text-sm text-ink-2">{p.label} · expires {fmtDate(p.expiration)} ({p.metrics.daysToEval}d)</p>
              </div>
              <MiniPayoff s={p} ctx={ctx} target={scenario.targetPrice} />
            </div>

            <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 rounded-xl bg-surface-2 p-4 sm:grid-cols-4">
              <Stat label="Capital required" value={money(p.metrics.capital)} sub={p.metrics.capitalBasis === "estimated-margin" ? "estimated margin" : undefined} />
              <Stat label="Max profit" value={money(p.metrics.maxProfit)} tone="gain" />
              <Stat label="Max loss" value={money(p.metrics.maxLoss)} tone="loss" />
              <Stat label="Breakeven" value={p.metrics.breakevens.map((b) => money(b)).join(" / ") || "—"} />
              <Stat label="Expected P/L · your view" value={money(s.expectedPnl, { sign: true })} sub={`±${money(s.stdPnl)} (1σ), after costs`} tone="model" />
              <Stat label="Chance of profit" value={pct(s.popView, { decimals: 0 })} sub={`your view · ${pct(p.metrics.pop, { decimals: 0 })} market-implied`} />
              <Stat label="Avg. of worst 5%" value={money(Math.min(s.cvar5, 0))} sub="expected shortfall" tone="loss" />
              <Stat label={`Score (${rec.objective === "sharpe" ? "Sharpe" : rec.objective === "tail" ? "return / tail" : "E[return]"})`} value={rec.objective === "return" ? pct(s.value, { decimals: 1 }) : s.value.toFixed(2)} sub={`risk / reward ${riskRewardText(p.metrics.riskReward, p.metrics.maxProfit)}`} />
            </div>

            <div className="mt-5 grid gap-6 lg:grid-cols-2">
              <div>
                <h3 className="label mb-2">Why the model chose this</h3>
                <ul className="space-y-2">
                  {rec.narrative.map((n) => (
                    <li key={n} className="flex gap-2 text-sm leading-relaxed text-ink-2">
                      <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-model" />
                      {n}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="label mb-2">What drives this recommendation</h3>
                <p className="mb-3 text-xs text-muted">Each row changes one assumption, re-runs the full search, and shows how the pick&apos;s score moves and what would be top-ranked instead.</p>
                <ul className="space-y-2.5">
                  {rec.drivers.map((d) => (
                    <li key={d.key} className="rounded-lg border border-line p-2.5">
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="flex items-center gap-1.5">
                          {d.sameFamily ? <CheckCircle2 size={14} className="shrink-0 text-gain" /> : <CircleAlert size={14} className="shrink-0 text-warn" />}
                          {d.label}
                        </span>
                        <span className={clsx("shrink-0 font-semibold tnum", d.delta >= 0 ? "text-gain" : "text-loss")}>
                          {d.delta >= 0 ? "+" : "−"}
                          {Math.abs(rec.objective === "return" ? d.delta * 100 : d.delta).toFixed(2)}
                          {rec.objective === "return" ? " pp" : ""}
                        </span>
                      </div>
                      <div className="relative mt-1.5 h-1.5 rounded bg-surface-2">
                        <div className="absolute left-1/2 top-0 h-1.5 w-px bg-line" />
                        <div className={clsx("absolute top-0 h-1.5 rounded", d.delta >= 0 ? "left-1/2 bg-gain/70" : "right-1/2 bg-loss/70")} style={{ width: `${(Math.abs(d.delta) / maxAbs) * 50}%` }} />
                      </div>
                      <div className="mt-1.5 text-xs text-muted">
                        {d.samePick ? (
                          "Still top-ranked, same strikes"
                        ) : d.sameFamily ? (
                          <>Same structure, strikes shift: <span className="text-ink-2">{d.pickUnder}</span></>
                        ) : (
                          <>Top-ranked instead: <span className="text-ink-2">{d.pickUnder}</span></>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
              <p className="max-w-2xl text-xs leading-relaxed text-muted">
                Method adapted from Cong, Tang &amp; Wang, <em>AlphaPortfolio: Goal-Oriented Investment Management Through Deep Reinforcement Learning</em> (SSRN 3554486): direct optimisation of your objective over a large policy space, costs inside the objective, and sensitivity-based interpretation. This is a model output based on your assumptions — not personalised financial advice.
              </p>
              <button className="btn-primary" onClick={onOpen}>
                View payoff, what-if &amp; risk <ArrowRight size={15} />
              </button>
            </div>
          </>
        ) : (
          <div className="mt-4 flex gap-3 rounded-xl border border-line bg-surface-2 p-4">
            <Ban size={20} className="mt-0.5 shrink-0 text-ink-2" />
            <div>
              <h2 className="font-semibold">No trade recommended</h2>
              <ul className="mt-1.5 space-y-1.5">
                {rec.narrative.map((n) => (
                  <li key={n} className="text-sm leading-relaxed text-ink-2">{n}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
