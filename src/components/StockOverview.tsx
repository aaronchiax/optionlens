"use client";

import { Star } from "lucide-react";
import clsx from "clsx";
import type { StockSnapshot } from "@/lib/market-data/service";
import { compactNum, money, pct } from "@/lib/format";
import { DataBadge, ModelTag } from "./DataBadge";

export function StockOverview({ snap, watched, onToggleWatch }: { snap: StockSnapshot; watched: boolean; onToggleWatch: () => void }) {
  const q = snap.quote;
  const up = (q.change ?? 0) >= 0;
  const stats: { label: string; value: string; hint?: string; model?: boolean }[] = [
    { label: "Market cap", value: money(q.marketCap, { compact: true }) },
    { label: "Implied vol (ATM)", value: pct(snap.stats.atmIv), hint: snap.stats.atmIvExpiration ? `~30d · ${snap.stats.atmIvExpiration}` : "unavailable", model: true },
    { label: "Historical vol (30d)", value: pct(snap.stats.hv30), hint: `1y: ${pct(snap.stats.hv1y)}` },
    { label: "Avg volume", value: compactNum(q.averageVolume) },
    { label: "52-week high", value: money(q.fiftyTwoWeekHigh) },
    { label: "52-week low", value: money(q.fiftyTwoWeekLow) },
  ];
  return (
    <section className="card p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{q.name}</h1>
            <button
              onClick={onToggleWatch}
              aria-label={watched ? "Remove from watchlist" : "Add to watchlist"}
              title={watched ? "Remove from watchlist" : "Add to watchlist"}
              className={clsx("grid h-8 w-8 place-items-center rounded-lg border border-line transition", watched ? "text-warn" : "text-muted hover:text-ink")}
            >
              <Star size={15} fill={watched ? "currentColor" : "none"} />
            </button>
          </div>
          <div className="mt-1 flex items-center gap-2 text-sm text-muted">
            <span className="font-semibold text-ink-2">{q.symbol}</span>
            {q.exchange && <span>· {q.exchange}</span>}
            <span>· {q.currency}</span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-3xl font-semibold tracking-tight tnum">{money(q.price)}</div>
          <div className={clsx("mt-0.5 text-sm font-medium tnum", up ? "text-gain" : "text-loss")}>
            {money(q.change, { sign: true })} ({pct((q.changePercent ?? 0) / 100, { sign: true, decimals: 2 })}) <span className="font-normal text-muted">today</span>
          </div>
        </div>
      </div>
      <div className="mt-4">
        <DataBadge meta={snap.meta} />
      </div>
      <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-line pt-5 sm:grid-cols-3 lg:grid-cols-6">
        {stats.map((s) => (
          <div key={s.label}>
            <dt className="label flex items-center gap-1.5">
              {s.label}
              {s.model && <ModelTag>calc</ModelTag>}
            </dt>
            <dd className="mt-1 text-base font-semibold tnum">{s.value}</dd>
            {s.hint && <dd className="text-xs text-muted">{s.hint}</dd>}
          </div>
        ))}
      </dl>
    </section>
  );
}
