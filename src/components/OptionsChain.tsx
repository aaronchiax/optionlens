"use client";

import { ChevronDown, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import type { EnrichedChain, OptionContract } from "@/lib/engine/chain";
import type { Action } from "@/lib/engine/position";
import { fmtDate, num, pct } from "@/lib/format";
import { ModelTag } from "./DataBadge";

export function OptionsChain({
  expirations,
  initialExpiration,
  loadChain,
  onAdd,
}: {
  expirations: string[];
  initialExpiration: string | null;
  loadChain: (exp: string) => Promise<EnrichedChain>;
  onAdd: (c: OptionContract, action: Action) => void;
}) {
  const [open, setOpen] = useState(false);
  const [exp, setExp] = useState<string | null>(initialExpiration);
  const [chain, setChain] = useState<EnrichedChain | null>(null);
  const [side, setSide] = useState<"call" | "put">("call");
  const [all, setAll] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    if (initialExpiration) setExp(initialExpiration);
  }, [initialExpiration]);

  useEffect(() => {
    if (!open || !exp) return;
    let alive = true;
    setLoading(true);
    setErr(null);
    loadChain(exp)
      .then((c) => alive && setChain(c))
      .catch((e) => alive && setErr((e as Error).message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [open, exp, loadChain]);

  const rows = useMemo(() => {
    if (!chain) return [];
    const list = side === "call" ? chain.calls : chain.puts;
    if (all) return list;
    const i = list.findIndex((c) => c.strike >= chain.spot);
    const idx = i === -1 ? list.length - 1 : i;
    return list.slice(Math.max(0, idx - 12), idx + 12);
  }, [chain, side, all]);

  const add = (c: OptionContract, a: Action) => {
    onAdd(c, a);
    setFlash(`${a === "buy" ? "Added: Buy" : "Added: Sell"} ${c.strike} ${c.type}`);
    setTimeout(() => setFlash(null), 1800);
  };

  return (
    <section className="card">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between px-5 py-4 text-left sm:px-6" aria-expanded={open}>
        <div>
          <h2 className="font-semibold">Options chain</h2>
          <p className="text-xs text-muted">Browse strikes and add contracts to the custom strategy builder.</p>
        </div>
        <ChevronDown size={18} className={clsx("text-muted transition", open && "rotate-180")} />
      </button>
      {open && (
        <div className="border-t border-line px-5 pb-5 pt-4 sm:px-6">
          <div className="flex flex-wrap items-center gap-3">
            <select className="input w-auto py-1.5 text-sm" value={exp ?? ""} onChange={(e) => setExp(e.target.value)}>
              {expirations.map((e) => (
                <option key={e} value={e}>{fmtDate(e)}</option>
              ))}
            </select>
            <div className="flex rounded-lg border border-line p-0.5">
              {(["call", "put"] as const).map((s) => (
                <button key={s} onClick={() => setSide(s)} className={clsx("rounded-md px-3 py-1 text-sm font-medium capitalize", side === s ? "bg-surface-2 text-ink" : "text-muted")}>
                  {s}s
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-sm text-ink-2">
              <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> All strikes
            </label>
            {chain && (
              <span className="text-xs text-muted">
                {chain.dte}d · ATM IV {pct(chain.atmIv)} {chain.usesLastPrices && "· bid/ask unavailable, showing last trades"}
              </span>
            )}
            <span className="ml-auto flex items-center gap-1.5 text-xs text-muted">IV & Greeks <ModelTag>calc</ModelTag></span>
          </div>
          {flash && <div className="mt-3 rounded-lg bg-accent/10 px-3 py-1.5 text-sm text-accent">{flash} → see Custom Strategy Builder</div>}
          {err && <p className="mt-3 text-sm text-loss">{err}</p>}
          {loading && !chain ? (
            <div className="grid h-40 place-items-center text-muted"><Loader2 className="animate-spin" /></div>
          ) : chain ? (
            <div className={clsx("mt-3 max-h-[480px] overflow-auto rounded-lg border border-line", loading && "opacity-60")}>
              <table className="w-full text-[13px]">
                <thead className="sticky top-0 z-10 bg-surface-2">
                  <tr>
                    {["Strike", "Bid", "Ask", "Last", "Volume", "Open Int.", "IV", "Delta", "Gamma", "Theta", "Vega", ""].map((h) => (
                      <th key={h} className={clsx("th", h !== "Strike" && "text-right")}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((c) => {
                    const itm = c.type === "call" ? c.strike < chain.spot : c.strike > chain.spot;
                    return (
                      <tr key={c.contractSymbol} className={clsx("hover:bg-surface-2", itm && "bg-accent/[0.04]")}>
                        <td className="td font-semibold">{c.strike}{itm && <span className="ml-1.5 text-[9px] font-semibold text-accent">ITM</span>}</td>
                        <td className="td text-right">{c.bid ? c.bid.toFixed(2) : "—"}</td>
                        <td className="td text-right">{c.ask ? c.ask.toFixed(2) : "—"}</td>
                        <td className="td text-right">{c.last ? c.last.toFixed(2) : "—"}</td>
                        <td className="td text-right">{num(c.volume)}</td>
                        <td className="td text-right">{num(c.openInterest)}</td>
                        <td className={clsx("td text-right", c.ivSource === "fallback" && "text-muted")} title={c.ivSource === "fallback" ? "Estimated (no reliable market price)" : undefined}>{pct(c.iv)}</td>
                        <td className="td text-right">{c.delta.toFixed(2)}</td>
                        <td className="td text-right">{c.gamma.toFixed(3)}</td>
                        <td className="td text-right">{c.theta.toFixed(3)}</td>
                        <td className="td text-right">{c.vega.toFixed(3)}</td>
                        <td className="td text-right">
                          <div className="flex justify-end gap-1">
                            <button onClick={() => add(c, "buy")} className="rounded-md border border-gain/40 px-2 py-0.5 text-xs font-semibold text-gain hover:bg-gain/10" aria-label={`Buy ${c.strike} ${c.type}`}>+ Buy</button>
                            <button onClick={() => add(c, "sell")} className="rounded-md border border-loss/40 px-2 py-0.5 text-xs font-semibold text-loss hover:bg-loss/10" aria-label={`Sell ${c.strike} ${c.type}`}>− Sell</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
          <p className="mt-2 text-xs text-muted">Theta is $ per share per day; vega is $ per share per 1 vol point. Multiply by 100 per contract.</p>
        </div>
      )}
    </section>
  );
}
