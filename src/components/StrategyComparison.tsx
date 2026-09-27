"use client";

import clsx from "clsx";
import type { StrategyResult } from "@/lib/engine/types";
import { money, pct } from "@/lib/format";

export type SortKey = "model" | "expected" | "target" | "capital" | "maxLoss" | "pop" | "return";

export const SORTS: { key: SortKey; label: string }[] = [
  { key: "model", label: "Model ranking (your objective)" },
  { key: "expected", label: "Highest expected P/L (your view)" },
  { key: "target", label: "Closest to target (P/L at target)" },
  { key: "capital", label: "Lowest capital required" },
  { key: "maxLoss", label: "Lowest maximum loss" },
  { key: "pop", label: "Highest probability of profit" },
  { key: "return", label: "Highest potential return" },
];

const fin = (v: number | null, dflt: number) => (v === null || !Number.isFinite(v) ? dflt : v);

export function sortStrategies(list: StrategyResult[], key: SortKey, definedOnly: boolean): StrategyResult[] {
  const f = definedOnly ? list.filter((s) => s.metrics.maxLoss !== Infinity) : list;
  const v = (s: StrategyResult) => {
    const m = s.metrics;
    switch (key) {
      case "model": return s.score?.rank ?? 1e9;
      case "expected": return -(s.score?.expectedPnl ?? -1e12);
      case "capital": return m.capital;
      case "maxLoss": return fin(m.maxLoss, 1e15);
      case "pop": return -(m.pop ?? 0);
      case "return": return -fin(m.returnOnCapital, 1e6);
      case "target": return -fin(m.returnAtTarget, -1e6);
    }
  };
  return [...f].sort((a, b) => v(a) - v(b));
}

export function SortBar({ sort, setSort, definedOnly, setDefinedOnly }: { sort: SortKey; setSort: (k: SortKey) => void; definedOnly: boolean; setDefinedOnly: (v: boolean) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-2 text-sm text-ink-2">
        Sort by
        <select className="input w-auto py-1.5 text-sm" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
          {SORTS.map((s) => (
            <option key={s.key} value={s.key}>{s.label}</option>
          ))}
        </select>
      </label>
      <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-2">
        <input type="checkbox" checked={definedOnly} onChange={(e) => setDefinedOnly(e.target.checked)} />
        Defined risk only
      </label>
    </div>
  );
}

export function StrategyComparison({ list, onOpen, sort }: { list: StrategyResult[]; onOpen: (s: StrategyResult) => void; sort: SortKey }) {
  const cols: { key?: SortKey; label: string; right?: boolean }[] = [
    { key: "model", label: "Rank" },
    { label: "Strategy" },
    { key: "expected", label: "Exp. P/L (view)", right: true },
    { key: "capital", label: "Capital", right: true },
    { label: "Max profit", right: true },
    { key: "maxLoss", label: "Max loss", right: true },
    { label: "Breakeven", right: true },
    { key: "pop", label: "Prob. of profit", right: true },
    { key: "return", label: "Max return", right: true },
    { key: "target", label: "P/L at target", right: true },
  ];
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b border-line">
          <tr>
            {cols.map((c) => (
              <th key={c.label} className={clsx("th", c.right && "text-right", c.key === sort && "text-accent")}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {list.map((s) => {
            const m = s.metrics;
            return (
              <tr key={s.key} className="cursor-pointer transition hover:bg-surface-2" onClick={() => onOpen(s)}>
                <td className="td font-semibold text-ink-2">{s.score ? `#${s.score.rank}` : "—"}</td>
                <td className="td">
                  <div className="font-medium">{s.name}</div>
                  <div className="font-mono text-[11px] text-muted">{s.label.replace(/^\S+\s/, "")} · {s.expiration}</div>
                </td>
                <td className={clsx("td text-right font-medium", (s.score?.expectedPnl ?? 0) >= 0 ? "text-gain" : "text-loss")}>{s.score ? money(s.score.expectedPnl, { sign: true }) : "—"}</td>
                <td className="td text-right">{money(m.capital)}</td>
                <td className="td text-right text-gain">{money(m.maxProfit)}</td>
                <td className="td text-right text-loss">{money(m.maxLoss)}</td>
                <td className="td text-right">{m.breakevens.map((b) => money(b)).join(" / ") || "—"}</td>
                <td className="td text-right">{pct(m.pop, { decimals: 0 })}</td>
                <td className="td text-right">{m.returnOnCapital === Infinity ? "Unlimited" : pct(m.returnOnCapital, { decimals: 0 })}</td>
                <td className={clsx("td text-right font-medium", m.pnlAtTarget >= 0 ? "text-gain" : "text-loss")}>{money(m.pnlAtTarget, { sign: true })}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-3 text-xs text-muted">
        Figures are per 1-lot (100 shares per contract) at expiration, priced from the premiums shown. Each row is the highest-scoring version of that structure found by the search; rank reflects your chosen objective under your view. Expected P/L is net of estimated bid/ask costs. Probability of profit in this table is market-implied (lognormal, at-the-money IV). Re-sort by any column to compare on other criteria.
      </p>
    </div>
  );
}
