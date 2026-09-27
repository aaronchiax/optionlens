"use client";

import { useMemo, useState } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import clsx from "clsx";
import type { StockSnapshot } from "@/lib/market-data/service";
import { money } from "@/lib/format";
import { ModelTag } from "./DataBadge";

const RANGES = [
  { key: "3M", days: 91 },
  { key: "6M", days: 182 },
  { key: "1Y", days: 366 },
] as const;

type Pt = { t: number; close?: number; path?: number; band?: [number, number] };

export function PriceChart({ snap, target, horizonDays }: { snap: StockSnapshot; target: number | null; horizonDays: number }) {
  const [range, setRange] = useState<(typeof RANGES)[number]["key"]>("6M");
  const [showLevels, setShowLevels] = useState(true);
  const spot = snap.quote.price;
  const sigma = snap.stats.atmIv ?? snap.stats.hv1y ?? 0.35;

  const data = useMemo(() => {
    const days = RANGES.find((r) => r.key === range)!.days;
    const cutoff = Date.now() - days * 86_400_000;
    const hist: Pt[] = snap.history.map((h) => ({ t: Date.parse(`${h.date}T20:00:00Z`), close: h.close })).filter((p) => p.t >= cutoff);
    const lastT = hist.length ? hist[hist.length - 1].t : Date.now();
    // model-generated forward section: target path + IV-implied 1σ band
    const fwd: Pt[] = [];
    const steps = 24;
    for (let i = 0; i <= steps; i++) {
      const d = (horizonDays * i) / steps;
      const T = d / 365;
      const w = sigma * Math.sqrt(T);
      fwd.push({
        t: lastT + d * 86_400_000,
        band: [spot * Math.exp(-w), spot * Math.exp(w)],
        path: target ? spot + ((target - spot) * i) / steps : undefined,
        ...(i === 0 ? { close: spot } : {}),
      });
    }
    return { points: [...hist.slice(0, -1), ...fwd], lastT, endT: fwd[fwd.length - 1].t };
  }, [snap.history, range, horizonDays, sigma, spot, target]);

  const q = snap.quote;
  const yVals = data.points.flatMap((p) => [p.close, p.path, ...(p.band ?? [])]).filter((v): v is number => typeof v === "number");
  if (target) yVals.push(target);
  const lo = Math.min(...yVals), hi = Math.max(...yVals);
  const pad = (hi - lo) * 0.08;

  return (
    <section className="card p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Price & your target</h2>
          <p className="mt-0.5 text-xs text-muted">Solid line: historical closes. Dashed/shaded: model-generated projection from your assumptions.</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-ink-2">
            <input type="checkbox" checked={showLevels} onChange={(e) => setShowLevels(e.target.checked)} /> Levels
          </label>
          <div className="flex rounded-lg border border-line p-0.5">
            {RANGES.map((r) => (
              <button key={r.key} onClick={() => setRange(r.key)} className={clsx("rounded-md px-2.5 py-1 text-xs font-medium", range === r.key ? "bg-surface-2 text-ink" : "text-muted hover:text-ink")}>
                {r.key}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
        <Legend color="var(--chart-price)" label="Price (historical)" />
        <Legend color="var(--chart-model)" dashed label="Target path (your assumption)" />
        <Legend color="var(--chart-model)" area label={`IV-implied ±1σ range (${(sigma * 100).toFixed(0)}% vol)`} />
        <ModelTag>model</ModelTag>
      </div>

      <div className="mt-3 h-72 sm:h-80">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data.points} margin={{ top: 10, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={["dataMin", "dataMax"]}
              tickFormatter={(t) => {
                const d = new Date(t);
                return `${d.toLocaleDateString("en-US", { month: "short" })} ’${String(d.getFullYear()).slice(2)}`;
              }}
              tick={{ fill: "var(--chart-label)", fontSize: 11 }}
              stroke="var(--chart-axis)"
              minTickGap={40}
            />
            <YAxis
              domain={[lo - pad, hi + pad]}
              tickFormatter={(v) => `$${v.toFixed(0)}`}
              tick={{ fill: "var(--chart-label)", fontSize: 11 }}
              stroke="var(--chart-axis)"
              width={52}
              orientation="right"
            />
            <Tooltip content={<ChartTip />} />
            <Area dataKey="band" stroke="none" fill="var(--chart-model)" fillOpacity={0.1} isAnimationActive={false} />
            <ReferenceLine x={data.lastT} stroke="var(--chart-axis)" strokeDasharray="2 3" label={{ value: "Today", position: "insideTopLeft", fill: "var(--chart-label)", fontSize: 10 }} />
            {showLevels && q.fiftyTwoWeekHigh && <ReferenceLine y={q.fiftyTwoWeekHigh} stroke="var(--chart-ref)" strokeOpacity={0.5} strokeDasharray="4 4" label={{ value: `52w high ${money(q.fiftyTwoWeekHigh)}`, position: "insideBottomLeft", fill: "var(--chart-label)", fontSize: 10 }} />}
            {showLevels && q.fiftyTwoWeekLow && q.fiftyTwoWeekLow > lo - pad && <ReferenceLine y={q.fiftyTwoWeekLow} stroke="var(--chart-ref)" strokeOpacity={0.5} strokeDasharray="4 4" label={{ value: `52w low ${money(q.fiftyTwoWeekLow)}`, position: "insideTopLeft", fill: "var(--chart-label)", fontSize: 10 }} />}
            {showLevels && snap.stats.support && <ReferenceLine y={snap.stats.support} stroke="var(--chart-gain)" strokeOpacity={0.45} strokeDasharray="1 3" label={{ value: `60d support ${money(snap.stats.support)}`, position: "insideBottomLeft", fill: "var(--chart-label)", fontSize: 10 }} />}
            {showLevels && snap.stats.resistance && snap.stats.resistance !== q.fiftyTwoWeekHigh && <ReferenceLine y={snap.stats.resistance} stroke="var(--chart-loss)" strokeOpacity={0.45} strokeDasharray="1 3" label={{ value: `60d resistance ${money(snap.stats.resistance)}`, position: "insideTopLeft", fill: "var(--chart-label)", fontSize: 10 }} />}
            <Line dataKey="close" stroke="var(--chart-price)" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
            <Line dataKey="path" stroke="var(--chart-model)" strokeWidth={2} strokeDasharray="6 4" dot={false} isAnimationActive={false} />
            {target && <ReferenceDot x={data.endT} y={target} r={5} fill="var(--chart-model)" stroke="rgb(var(--surface))" strokeWidth={2} label={{ value: `Target ${money(target)}`, position: "left", fill: "var(--chart-model)", fontSize: 11, fontWeight: 600 }} />}
            <ReferenceDot x={data.lastT} y={spot} r={4} fill="var(--chart-price)" stroke="rgb(var(--surface))" strokeWidth={2} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function Legend({ color, label, dashed, area }: { color: string; label: string; dashed?: boolean; area?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {area ? (
        <span className="h-2.5 w-4 rounded-sm" style={{ background: color, opacity: 0.25 }} />
      ) : (
        <svg width="18" height="4">
          <line x1="0" y1="2" x2="18" y2="2" stroke={color} strokeWidth="2" strokeDasharray={dashed ? "4 3" : undefined} />
        </svg>
      )}
      {label}
    </span>
  );
}

function ChartTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload as Pt;
  const future = p.close === undefined || p.band;
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-pop">
      <div className="font-medium">{new Date(label).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" })}</div>
      {p.close !== undefined && <div className="tnum text-ink-2">Close {money(p.close)}</div>}
      {future && p.path !== undefined && <div className="tnum text-model">Target path {money(p.path)}</div>}
      {future && p.band && (
        <div className="tnum text-ink-2">
          ±1σ range {money(p.band[0])} – {money(p.band[1])}
        </div>
      )}
    </div>
  );
}
