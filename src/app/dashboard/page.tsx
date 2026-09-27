"use client";

import { Info, Plus, RefreshCw, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import type { Quote } from "@/lib/market-data/types";
import { coveredTickers, loadQuotes } from "@/lib/market-data/client";
import { HORIZONS, OUTLOOKS } from "@/lib/engine/types";
import { fmtDate, money, pct } from "@/lib/format";
import { scenarioToQuery, userData, type SavedAnalysis } from "@/lib/user-data/repository";

type Q = Quote | { symbol: string; error: string };

export default function Dashboard() {
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [quotes, setQuotes] = useState<Record<string, Q>>({});
  const [analyses, setAnalyses] = useState<SavedAnalysis[]>([]);
  const [adding, setAdding] = useState("");
  const [loading, setLoading] = useState(false);
  const [quoteErr, setQuoteErr] = useState<string | null>(null);

  const refreshQuotes = useCallback(async (syms: string[]) => {
    if (!syms.length) return;
    setLoading(true);
    setQuoteErr(null);
    try {
      const quotes = await loadQuotes(syms);
      setQuotes(Object.fromEntries(quotes.map((q) => [q.symbol, q])));
    } catch (e) {
      setQuoteErr((e as Error).message || "Could not load quotes");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    userData.getWatchlist().then((w) => {
      setWatchlist(w);
      refreshQuotes(w);
    });
    userData.listAnalyses().then(setAnalyses);
  }, [refreshQuotes]);

  const setWL = async (next: string[]) => {
    setWatchlist(next);
    await userData.setWatchlist(next);
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const s = adding.trim().toUpperCase();
    if (!/^[A-Z0-9.\-^=]{1,15}$/.test(s) || watchlist.includes(s)) return;
    const covered = await coveredTickers();
    if (covered && !covered.includes(s)) {
      setQuoteErr(`${s} isn't in this edition's data. Available: ${covered.join(", ")}.`);
      return;
    }
    const next = [...watchlist, s];
    setAdding("");
    await setWL(next);
    refreshQuotes(next);
  };

  return (
    <div className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6">
      <div className="flex items-start gap-3 rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm text-ink-2">
        <Info size={16} className="mt-0.5 shrink-0" />
        <p>Your watchlist and saved analyses are stored on this device. Account sync (sign-up, cross-device history) is designed in via a repository interface and Supabase schema, and can be enabled later.</p>
      </div>

      <section>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">My Watchlist</h1>
            <p className="text-sm text-muted">Delayed quotes. Click a symbol to analyze with the latest data.</p>
          </div>
          <div className="flex gap-2">
            <form onSubmit={add} className="flex gap-2">
              <input className="input w-32 py-2" placeholder="Add ticker" value={adding} onChange={(e) => setAdding(e.target.value)} aria-label="Add ticker to watchlist" />
              <button className="btn-ghost py-2" type="submit"><Plus size={15} /> Add</button>
            </form>
            <button className="btn-ghost py-2" onClick={() => refreshQuotes(watchlist)} aria-label="Refresh quotes">
              <RefreshCw size={15} className={clsx(loading && "animate-spin")} />
            </button>
          </div>
        </div>
        {quoteErr && <p className="mt-3 text-sm text-loss">{quoteErr}</p>}
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {watchlist.map((s) => {
            const q = quotes[s];
            const ok = q && !("error" in q);
            const up = ok && ((q as Quote).change ?? 0) >= 0;
            return (
              <div key={s} className="card group relative p-4 transition hover:border-accent/50">
                <button onClick={() => setWL(watchlist.filter((x) => x !== s))} className="absolute right-2 top-2 hidden h-6 w-6 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-ink group-hover:grid" aria-label={`Remove ${s}`}>
                  <X size={13} />
                </button>
                <Link href={`/analyze/${s}`} className="block">
                  <div className="font-semibold">{s}</div>
                  <div className="truncate text-xs text-muted">{ok ? (q as Quote).name : q ? "Unavailable" : "…"}</div>
                  <div className="mt-3 text-lg font-semibold tnum">{ok ? money((q as Quote).price) : "—"}</div>
                  <div className={clsx("text-xs font-medium tnum", up ? "text-gain" : "text-loss")}>
                    {ok ? pct(((q as Quote).changePercent ?? 0) / 100, { sign: true, decimals: 2 }) : ""}
                  </div>
                </Link>
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold tracking-tight">Saved analyses</h2>
        <p className="text-sm text-muted">Rerun any scenario with updated market data — strikes, premiums and probabilities are recomputed.</p>
        {analyses.length === 0 ? (
          <div className="card mt-4 p-8 text-center text-sm text-ink-2">No saved analyses yet. Generate strategies for a stock and click “Save analysis”.</div>
        ) : (
          <div className="card mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-line">
                <tr>
                  <th className="th">Saved</th>
                  <th className="th">Symbol</th>
                  <th className="th">Scenario</th>
                  <th className="th">Strategies (at save time)</th>
                  <th className="th" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {analyses.map((a) => (
                  <tr key={a.id} className="align-top">
                    <td className="td text-muted">{fmtDate(a.createdAt, true)}</td>
                    <td className="td font-semibold">{a.symbol}</td>
                    <td className="td whitespace-normal">
                      <div>{money(a.spotAtSave)} → {money(a.scenario.targetPrice)}</div>
                      <div className="text-xs text-muted">
                        {HORIZONS.find((h) => h.key === a.scenario.horizon)?.label} · {OUTLOOKS.find((o) => o.key === a.scenario.outlook)?.label}
                        {a.expiration && ` · exp ${a.expiration}`}
                      </div>
                    </td>
                    <td className="td whitespace-normal">
                      <ul className="space-y-0.5">
                        {a.strategies.slice(0, 4).map((s) => (
                          <li key={s.label} className="text-xs"><span className="font-medium">{s.name}</span> <span className="text-muted">· cap {money(s.capital)} · POP {pct(s.pop, { decimals: 0 })}</span></li>
                        ))}
                        {a.strategies.length > 4 && <li className="text-xs text-muted">+{a.strategies.length - 4} more</li>}
                      </ul>
                    </td>
                    <td className="td text-right">
                      <div className="flex justify-end gap-2">
                        <Link href={`/analyze/${a.symbol}?${scenarioToQuery(a.scenario)}`} className="btn-primary px-3 py-1.5 text-xs"><RefreshCw size={13} /> Rerun</Link>
                        <button
                          className="btn-ghost px-2 py-1.5"
                          aria-label="Delete analysis"
                          onClick={async () => {
                            await userData.deleteAnalysis(a.id);
                            setAnalyses(await userData.listAnalyses());
                          }}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
