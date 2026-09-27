"use client";

import { ArrowRight, Bookmark, ShieldCheck, TriangleAlert } from "lucide-react";
import { useMemo } from "react";
import clsx from "clsx";
import type { PricingContext } from "@/lib/engine/chain";
import { pnlAtExpiry } from "@/lib/engine/position";
import type { StrategyResult } from "@/lib/engine/types";
import { fmtDate, money, pct, riskRewardText } from "@/lib/format";

export function BiasChip({ bias }: { bias: StrategyResult["bias"] }) {
  const cls = bias === "bullish" ? "text-gain bg-gain/10" : bias === "bearish" ? "text-loss bg-loss/10" : "text-ink-2 bg-surface-2";
  return <span className={clsx("rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize", cls)}>{bias}</span>;
}

export function RiskChip({ defined }: { defined: boolean }) {
  return defined ? (
    <span className="chip"><ShieldCheck size={11} /> Defined risk</span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-loss/10 px-2 py-0.5 text-[11px] font-semibold text-loss"><TriangleAlert size={11} /> Undefined risk</span>
  );
}

export function MiniPayoff({ s, ctx, target }: { s: StrategyResult; ctx: PricingContext; target: number }) {
  const { path, zeroY, tx } = useMemo(() => {
    const strikes = s.legs.filter((l) => l.strike).map((l) => l.strike!);
    const lo = Math.min(ctx.spot, target, ...strikes) * 0.85;
    const hi = Math.max(ctx.spot, target, ...strikes) * 1.15;
    const pts = Array.from({ length: 60 }, (_, i) => {
      const x = lo + ((hi - lo) * i) / 59;
      return [x, pnlAtExpiry(s.legs, x, ctx)] as const;
    });
    const ys = pts.map((p) => p[1]);
    const yMin = Math.min(...ys, 0), yMax = Math.max(...ys, 0);
    const W = 120, H = 40;
    const sx = (x: number) => ((x - lo) / (hi - lo)) * W;
    const sy = (y: number) => H - ((y - yMin) / (yMax - yMin || 1)) * H;
    return { path: pts.map(([x, y], i) => `${i ? "L" : "M"}${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join(" "), zeroY: sy(0), tx: sx(target) };
  }, [s.legs, ctx, target]);
  return (
    <svg width="120" height="40" viewBox="0 0 120 40" className="overflow-visible" aria-hidden>
      <line x1="0" x2="120" y1={zeroY} y2={zeroY} stroke="var(--chart-axis)" strokeWidth="1" />
      <line x1={tx} x2={tx} y1="0" y2="40" stroke="var(--chart-model)" strokeWidth="1" strokeDasharray="2 2" />
      <path d={path} fill="none" stroke="var(--chart-price)" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

function Metric({ label, value, tone, sub }: { label: string; value: string; tone?: "gain" | "loss"; sub?: string }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className={clsx("mt-0.5 text-[15px] font-semibold tnum", tone === "gain" && "text-gain", tone === "loss" && "text-loss")}>{value}</div>
      {sub && <div className="text-[11px] text-muted">{sub}</div>}
    </div>
  );
}

export function StrategyCard({
  s,
  ctx,
  target,
  onOpen,
  onSave,
  saved,
}: {
  s: StrategyResult;
  ctx: PricingContext;
  target: number;
  onOpen: () => void;
  onSave?: () => void;
  saved?: boolean;
}) {
  const m = s.metrics;
  return (
    <article className="card flex animate-fade-up flex-col p-5 transition hover:border-ink-2/30">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {s.score && <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-xs font-semibold text-ink-2 tnum" title="Model rank under your objective">#{s.score.rank}</span>}
            <h3 className="text-base font-semibold">{s.name}</h3>
            <BiasChip bias={s.bias} />
          </div>
          <p className="mt-1 truncate font-mono text-[13px] text-ink-2" title={s.label}>{s.label}</p>
        </div>
        <MiniPayoff s={s} ctx={ctx} target={target} />
      </header>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span>Expiration <span className="font-medium text-ink-2">{fmtDate(s.expiration)}</span> ({m.daysToEval}d)</span>
        <span>Current <span className="font-medium text-ink-2 tnum">{money(ctx.spot)}</span></span>
        <span>Target <span className="font-medium text-ink-2 tnum">{money(target)}</span></span>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-x-3 gap-y-3 rounded-xl bg-surface-2 p-3.5">
        <Metric label="Capital" value={money(m.capital)} sub={m.capitalBasis === "estimated-margin" ? "est. margin" : undefined} />
        <Metric label="Max profit" value={money(m.maxProfit)} tone="gain" />
        <Metric label="Max loss" value={money(m.maxLoss)} tone="loss" />
        <Metric label="Breakeven" value={m.breakevens.length ? m.breakevens.map((b) => money(b)).join(" / ") : "—"} />
        {s.score ? (
          <>
            <Metric label="Exp. P/L" value={money(s.score.expectedPnl, { sign: true })} tone={s.score.expectedPnl >= 0 ? "gain" : "loss"} sub="your view, after costs" />
            <Metric label="Chance of profit" value={pct(s.score.popView, { decimals: 0 })} sub={`${pct(m.pop, { decimals: 0 })} market-implied`} />
          </>
        ) : (
          <>
            <Metric label="Max return" value={pct(m.returnOnCapital, { decimals: 0 })} />
            <Metric label="Prob. of profit" value={pct(m.pop, { decimals: 0 })} sub="model" />
          </>
        )}
        <Metric label="P/L at target" value={money(m.pnlAtTarget, { sign: true })} tone={m.pnlAtTarget >= 0 ? "gain" : "loss"} />
        <Metric label="Return at target" value={pct(m.returnAtTarget, { decimals: 0, sign: true })} />
        <Metric label="Risk / reward" value={riskRewardText(m.riskReward, m.maxProfit)} />
      </div>

      <div className="mt-4 flex-1">
        <div className="label mb-1">Why this strategy?</div>
        <p className="text-sm leading-relaxed text-ink-2">{s.explanation.summary}</p>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <RiskChip defined={s.definedRisk} />
        {s.fitsWithinBudget !== null && s.fitsWithinBudget > 1 && <span className="chip">Budget fits ×{s.fitsWithinBudget}</span>}
        <div className="ml-auto flex gap-2">
          {onSave && (
            <button onClick={onSave} className="btn-ghost px-2.5 py-2" title={saved ? "Saved" : "Save strategy"} aria-label="Save strategy">
              <Bookmark size={15} fill={saved ? "currentColor" : "none"} />
            </button>
          )}
          <button onClick={onOpen} className="btn-primary py-2">
            View payoff diagram <ArrowRight size={15} />
          </button>
        </div>
      </div>
    </article>
  );
}
