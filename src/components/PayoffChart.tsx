"use client";

import { useEffect, useMemo, useState } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import clsx from "clsx";
import { expirationMs, type PricingContext } from "@/lib/engine/chain";
import { earliestExpiration, pnlAt, type Leg, type PositionMetrics } from "@/lib/engine/position";
import { fmtDate, money } from "@/lib/format";
import { ModelTag } from "./DataBadge";

interface Props {
  legs: Leg[];
  metrics: PositionMetrics;
  ctx: PricingContext;
  target: number;
  symbol: string;
  /** optional control (e.g. expiration selector) rendered in the header */
  headerSlot?: React.ReactNode;
  height?: number;
}

export function PayoffChart({ legs, metrics, ctx, target, symbol, headerSlot, height = 340 }: Props) {
  const exp = earliestExpiration(legs);
  const expMs = exp ? expirationMs(exp) : ctx.now + 30 * 86_400_000;
  const totalDays = Math.max(Math.ceil((expMs - ctx.now) / 86_400_000), 1);

  const [price, setPrice] = useState(target);
  const [dayOffset, setDayOffset] = useState(0);
  useEffect(() => setPrice(target), [target]);
  useEffect(() => setDayOffset((d) => Math.min(d, totalDays)), [totalDays]);

  const evalMs = Math.min(ctx.now + dayOffset * 86_400_000, expMs);
  const atExpiry = dayOffset >= totalDays;

  const { data, lo, hi, off, yMin, yMax } = useMemo(() => {
    const strikes = legs.filter((l) => l.strike).map((l) => l.strike!);
    const pts = [ctx.spot, target, ...strikes, ...metrics.breakevens];
    const lo = Math.max(0, Math.min(...pts) * 0.8);
    const hi = Math.max(...pts) * 1.2;
    const N = 160;
    const data = Array.from({ length: N + 1 }, (_, i) => {
      const x = lo + ((hi - lo) * i) / N;
      return { x, exp: pnlAt(legs, x, expMs, ctx), now: pnlAt(legs, x, evalMs, ctx) };
    });
    const ys = data.flatMap((d) => [d.exp, d.now]);
    const yMax = Math.max(...ys, 0), yMin = Math.min(...ys, 0);
    // gradient offsets are relative to the expiration area's own bounding box (which includes the 0 baseline)
    const eMax = Math.max(...data.map((d) => d.exp), 0), eMin = Math.min(...data.map((d) => d.exp), 0);
    const off = eMax - eMin === 0 ? 0.5 : eMax / (eMax - eMin);
    return { data, lo, hi, off, yMin, yMax };
  }, [legs, ctx, target, metrics.breakevens, expMs, evalMs]);

  const pnlExp = pnlAt(legs, price, expMs, ctx);
  const pnlNow = pnlAt(legs, price, evalMs, ctx);
  const gid = useMemo(() => `pg-${Math.random().toString(36).slice(2)}`, []);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
          <LegendSwatch color="var(--chart-gain)" label="P/L at expiration" />
          {!atExpiry && <LegendSwatch color="var(--chart-t0)" label={`Est. P/L on ${fmtDate(new Date(evalMs).toISOString())}`} />}
          <ModelTag>model</ModelTag>
        </div>
        {headerSlot}
      </div>

      <div className="mt-3" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 16, right: 16, bottom: 18, left: 8 }}>
            <defs>
              <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                <stop offset={0} stopColor="var(--chart-gain)" stopOpacity={0.28} />
                <stop offset={off} stopColor="var(--chart-gain)" stopOpacity={0.06} />
                <stop offset={off} stopColor="var(--chart-loss)" stopOpacity={0.06} />
                <stop offset={1} stopColor="var(--chart-loss)" stopOpacity={0.28} />
              </linearGradient>
              <linearGradient id={`${gid}-s`} x1="0" y1="0" x2="0" y2="1">
                <stop offset={0} stopColor="var(--chart-gain)" />
                <stop offset={off} stopColor="var(--chart-gain)" />
                <stop offset={off} stopColor="var(--chart-loss)" />
                <stop offset={1} stopColor="var(--chart-loss)" />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--chart-grid)" />
            <XAxis
              dataKey="x"
              type="number"
              domain={[lo, hi]}
              tickFormatter={(v) => `$${v.toFixed(0)}`}
              tick={{ fill: "var(--chart-label)", fontSize: 11 }}
              stroke="var(--chart-axis)"
              label={{ value: "Stock price at expiration", position: "insideBottom", offset: -12, fill: "var(--chart-label)", fontSize: 11 }}
            />
            <YAxis
              domain={[yMin - (yMax - yMin) * 0.06, yMax + (yMax - yMin) * 0.06]}
              tickFormatter={(v) => (Math.abs(v) >= 1000 ? `${v < 0 ? "−" : ""}$${(Math.abs(v) / 1000).toFixed(1)}k` : `${v < 0 ? "−" : ""}$${Math.abs(v).toFixed(0)}`)}
              tick={{ fill: "var(--chart-label)", fontSize: 11 }}
              stroke="var(--chart-axis)"
              width={56}
              label={{ value: "Profit / Loss", angle: -90, position: "insideLeft", fill: "var(--chart-label)", fontSize: 11, dy: 40 }}
            />
            <Tooltip content={<Tip symbol={symbol} showNow={!atExpiry} />} />
            <ReferenceLine y={0} stroke="var(--chart-axis)" strokeWidth={1.5} />
            {Number.isFinite(metrics.maxProfit) && metrics.maxProfit > 0 && (
              <ReferenceLine y={metrics.maxProfit} stroke="var(--chart-gain)" strokeDasharray="4 4" strokeOpacity={0.6} label={{ value: `Max profit ${money(metrics.maxProfit)}`, position: "insideTopLeft", fill: "var(--chart-label)", fontSize: 10 }} />
            )}
            {Number.isFinite(metrics.maxLoss) && metrics.maxLoss > 0 && (
              <ReferenceLine y={-metrics.maxLoss} stroke="var(--chart-loss)" strokeDasharray="4 4" strokeOpacity={0.6} label={{ value: `Max loss ${money(-metrics.maxLoss)}`, position: "insideBottomLeft", fill: "var(--chart-label)", fontSize: 10 }} />
            )}
            <ReferenceLine x={ctx.spot} stroke="var(--chart-price)" strokeDasharray="3 3" label={{ value: `Now ${money(ctx.spot)}`, position: "top", fill: "var(--chart-price)", fontSize: 10 }} />
            <ReferenceLine x={target} stroke="var(--chart-model)" strokeDasharray="6 3" label={{ value: `Target ${money(target)}`, position: "top", fill: "var(--chart-model)", fontSize: 10, dy: 12 }} />
            {metrics.breakevens.filter((b) => b > lo && b < hi).map((b) => (
              <ReferenceLine key={b} x={b} stroke="var(--chart-ref)" strokeOpacity={0.5} label={{ value: `BE ${money(b)}`, position: "insideBottom", fill: "var(--chart-label)", fontSize: 10, dy: -4 }} />
            ))}
            <ReferenceLine x={price} stroke="rgb(var(--ink))" strokeOpacity={0.35} />
            <Area type="linear" dataKey="exp" stroke={`url(#${gid}-s)`} strokeWidth={2} fill={`url(#${gid})`} isAnimationActive={false} baseValue={0} />
            {!atExpiry && <Line type="monotone" dataKey="now" stroke="var(--chart-t0)" strokeWidth={2} dot={false} isAnimationActive={false} />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Interactive readout */}
      <div className="mt-2 grid gap-4 rounded-xl bg-surface-2 p-4 md:grid-cols-2">
        <div>
          <div className="flex items-center justify-between">
            <label className="label" htmlFor={`${gid}-px`}>Stock price</label>
            <input
              className="w-24 rounded-md border border-line bg-surface px-2 py-0.5 text-right text-sm tnum"
              value={price.toFixed(2)}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (v > 0) setPrice(v);
              }}
              aria-label="Stock price value"
            />
          </div>
          <input id={`${gid}-px`} type="range" min={lo} max={hi} step={(hi - lo) / 400} value={price} onChange={(e) => setPrice(parseFloat(e.target.value))} className="mt-2 w-full" />
          <p className="mt-2 text-sm">
            If {symbol} = <span className="font-semibold tnum">{money(price)}</span> at expiration → Estimated P/L ={" "}
            <span className={clsx("font-semibold tnum", pnlExp >= 0 ? "text-gain" : "text-loss")}>{money(pnlExp, { sign: true })}</span>
          </p>
          {!atExpiry && (
            <p className="mt-1 text-sm text-ink-2">
              On {fmtDate(new Date(evalMs).toISOString())} → <span className={clsx("font-semibold tnum", pnlNow >= 0 ? "text-gain" : "text-loss")}>{money(pnlNow, { sign: true })}</span>{" "}
              <span className="text-xs text-muted">(model, IV unchanged)</span>
            </p>
          )}
        </div>
        <div>
          <div className="flex items-center justify-between">
            <label className="label" htmlFor={`${gid}-dt`}>Valuation date</label>
            <span className="text-sm tnum">{atExpiry ? `Expiration (${fmtDate(exp)})` : `${fmtDate(new Date(evalMs).toISOString())} · ${totalDays - dayOffset}d left`}</span>
          </div>
          <input id={`${gid}-dt`} type="range" min={0} max={totalDays} step={1} value={dayOffset} onChange={(e) => setDayOffset(parseInt(e.target.value))} className="mt-2 w-full" />
          <p className="mt-2 text-xs leading-relaxed text-muted">
            Move the date to see how the position&apos;s theoretical value evolves before expiration (Black-Scholes, holding implied volatility constant). At the far right the curve equals the expiration payoff.
          </p>
        </div>
      </div>
    </div>
  );
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-0.5 w-4 rounded" style={{ background: color }} />
      {label}
    </span>
  );
}

function Tip({ active, payload, symbol, showNow }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload as { x: number; exp: number; now: number };
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-pop">
      <div className="font-medium">{symbol} @ {money(d.x)}</div>
      <div className={clsx("tnum", d.exp >= 0 ? "text-gain" : "text-loss")}>At expiration {money(d.exp, { sign: true })}</div>
      {showNow && <div className="tnum text-ink-2">On valuation date {money(d.now, { sign: true })}</div>}
    </div>
  );
}
