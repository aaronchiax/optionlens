"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { expirationMs, type PricingContext } from "@/lib/engine/chain";
import { earliestExpiration, pnlAt, type Leg, type PositionMetrics } from "@/lib/engine/position";
import { money, pct } from "@/lib/format";

/** "What If?" — P/L across a ladder of stock prices, with an adjustable target. */
export function ScenarioSimulator({ legs, metrics, ctx, target: initialTarget, symbol }: { legs: Leg[]; metrics: PositionMetrics; ctx: PricingContext; target: number; symbol: string }) {
  const [target, setTarget] = useState(initialTarget);
  useEffect(() => setTarget(initialTarget), [initialTarget]);
  const exp = earliestExpiration(legs);
  const expMs = exp ? expirationMs(exp) : ctx.now;
  const midMs = ctx.now + (expMs - ctx.now) / 2;
  const capital = metrics.capital;

  const rows = useMemo(() => {
    const lo = Math.min(ctx.spot, target) * 0.85;
    const hi = Math.max(ctx.spot, target) * 1.15;
    const raw = Array.from({ length: 11 }, (_, i) => lo + ((hi - lo) * i) / 10);
    const rawStep = (hi - lo) / 10;
    const mag = 10 ** Math.floor(Math.log10(rawStep));
    const n = rawStep / mag;
    const niceStep = (n > 5 ? 10 : n > 2 ? 5 : n > 1 ? 2 : 1) * mag;
    const prices = [...new Set([...raw.map((p) => Math.round(p / niceStep) * niceStep), ctx.spot, target, ...metrics.breakevens.filter((b) => b > lo && b < hi)])].sort((a, b) => a - b);
    return prices.map((p) => ({ p, exp: pnlAt(legs, p, expMs, ctx), mid: pnlAt(legs, p, midMs, ctx) }));
  }, [legs, ctx, target, expMs, midMs, metrics.breakevens]);

  const band = (t: number) => ({ price: t, pnl: pnlAt(legs, t, expMs, ctx) });
  const below = band(target - Math.abs(target - ctx.spot) * 0.5 - ctx.spot * 0.03);
  const at = band(target);
  const above = band(target + Math.abs(target - ctx.spot) * 0.5 + ctx.spot * 0.03);
  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.exp)), 1);

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="w-full max-w-sm">
          <div className="flex items-center justify-between">
            <label className="label" htmlFor="wi-t">Target price</label>
            <span className="text-sm font-semibold tnum">{money(target)} <span className={clsx("text-xs", target >= ctx.spot ? "text-gain" : "text-loss")}>({pct((target - ctx.spot) / ctx.spot, { sign: true })})</span></span>
          </div>
          <input id="wi-t" type="range" min={ctx.spot * 0.6} max={ctx.spot * 1.4} step={ctx.spot / 400} value={target} onChange={(e) => setTarget(parseFloat(e.target.value))} className="mt-2 w-full" />
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {[
          { k: "Below target", ...below },
          { k: "At target", ...at },
          { k: "Above target", ...above },
        ].map((c) => (
          <div key={c.k} className={clsx("rounded-xl border p-3.5", c.k === "At target" ? "border-model/40 bg-model/5" : "border-line")}>
            <div className="label">{c.k}</div>
            <div className="mt-1 text-sm text-ink-2 tnum">{symbol} {money(c.price)}</div>
            <div className={clsx("mt-0.5 text-lg font-semibold tnum", c.pnl >= 0 ? "text-gain" : "text-loss")}>{money(c.pnl, { sign: true })}</div>
            {capital > 0 && <div className="text-xs text-muted tnum">{pct(c.pnl / capital, { sign: true, decimals: 0 })} on capital</div>}
          </div>
        ))}
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-line">
            <tr>
              <th className="th">Stock price</th>
              <th className="th text-right">Move</th>
              <th className="th text-right">P/L at expiration</th>
              <th className="th hidden sm:table-cell" />
              <th className="th text-right">Est. P/L halfway <span className="normal-case">(model)</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => {
              const isSpot = Math.abs(r.p - ctx.spot) < 1e-6;
              const isTarget = Math.abs(r.p - target) < 1e-6;
              const isBE = metrics.breakevens.some((b) => Math.abs(b - r.p) < 1e-6);
              return (
                <tr key={r.p} className={clsx(isTarget && "bg-model/5", isSpot && "bg-accent/5")}>
                  <td className="td font-medium">
                    {money(r.p)}
                    {isSpot && <span className="ml-2 text-[10px] font-semibold uppercase text-accent">now</span>}
                    {isTarget && <span className="ml-2 text-[10px] font-semibold uppercase text-model">target</span>}
                    {isBE && <span className="ml-2 text-[10px] font-semibold uppercase text-muted">breakeven</span>}
                  </td>
                  <td className="td text-right text-muted">{pct((r.p - ctx.spot) / ctx.spot, { sign: true })}</td>
                  <td className={clsx("td text-right font-semibold", r.exp >= 0.005 ? "text-gain" : r.exp <= -0.005 ? "text-loss" : "")}>{money(r.exp, { sign: true })}</td>
                  <td className="td hidden w-40 sm:table-cell">
                    <div className="relative h-2">
                      <div className="absolute left-1/2 top-0 h-2 w-px bg-line" />
                      <div
                        className={clsx("absolute top-0 h-2 rounded-sm", r.exp >= 0 ? "left-1/2 bg-gain/70" : "right-1/2 bg-loss/70")}
                        style={{ width: `${(Math.abs(r.exp) / maxAbs) * 50}%` }}
                      />
                    </div>
                  </td>
                  <td className={clsx("td text-right", r.mid >= 0 ? "text-gain/80" : "text-loss/80")}>{money(r.mid, { sign: true })}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
