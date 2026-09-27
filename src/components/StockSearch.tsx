"use client";

import { Loader2, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import type { SearchResult } from "@/lib/market-data/types";
import { coveredTickers, searchSymbols } from "@/lib/market-data/client";

export function StockSearch({ size = "lg", autoFocus = false, className }: { size?: "lg" | "md"; autoFocus?: boolean; className?: string }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const [navigating, setNavigating] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 1) {
      setResults([]);
      return;
    }
    let stale = false;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await searchSymbols(term);
        if (!stale) {
          setResults(res);
          setActive(0);
        }
      } catch {}
      if (!stale) setLoading(false);
    }, 250);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [q]);

  // GitHub Pages edition: only snapshot tickers have pages
  const [covered, setCovered] = useState<string[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    coveredTickers().then(setCovered).catch(() => {});
  }, []);

  useEffect(() => {
    const h = (e: MouseEvent) => boxRef.current && !boxRef.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const go = (symbol: string) => {
    const s = symbol.trim().toUpperCase();
    if (!s) return;
    if (covered && !covered.includes(s)) {
      setNotice(`${s} isn't in this edition's data. Available: ${covered.join(", ")}.`);
      return;
    }
    setNotice(null);
    setNavigating(true);
    setOpen(false);
    router.push(`/analyze/${encodeURIComponent(s)}`);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (open && results[active]) go(results[active].symbol);
    else if (!/^[A-Za-z.\-]{1,6}$/.test(q.trim()) && results[0]) go(results[0].symbol);
    else go(q);
  };

  const big = size === "lg";
  return (
    <div ref={boxRef} className={clsx("relative w-full", className)}>
      <form onSubmit={submit} className={clsx("flex items-center gap-2 rounded-2xl border border-line bg-surface shadow-card transition focus-within:border-accent focus-within:ring-4 focus-within:ring-accent/15", big ? "p-2" : "p-1.5")}>
        <Search className="ml-2 shrink-0 text-muted" size={big ? 20 : 16} />
        <input
          autoFocus={autoFocus}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Escape") setOpen(false);
          }}
          placeholder="Search ticker or company — e.g. NVDA"
          aria-label="Search ticker or company"
          className={clsx("min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-muted", big ? "px-1 py-2 text-base" : "px-1 py-1 text-sm")}
        />
        {loading && <Loader2 size={16} className="animate-spin text-muted" />}
        <button type="submit" className={clsx("btn-primary", big ? "px-5 py-3" : "px-3 py-1.5")} disabled={!q.trim() || navigating}>
          {navigating ? <Loader2 size={16} className="animate-spin" /> : null}
          Analyze
        </button>
      </form>
      {notice && <p className="mt-2 text-left text-sm text-warn">{notice}</p>}
      {open && results.length > 0 && (
        <ul className="absolute left-0 right-0 top-full z-30 mt-2 overflow-hidden rounded-xl border border-line bg-surface shadow-pop" role="listbox">
          {results.slice(0, 8).map((r, i) => (
            <li key={r.symbol}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => go(r.symbol)}
                className={clsx("flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm", i === active && "bg-surface-2")}
              >
                <span className="w-20 shrink-0 font-semibold">{r.symbol}</span>
                <span className="flex-1 truncate text-ink-2">{r.name}</span>
                <span className="text-xs text-muted">{r.exchange}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
