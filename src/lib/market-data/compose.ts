// Provider-agnostic composition of market data into UI payloads. Pure apart from the
// provider's own I/O, so it runs on the server (API routes) and in the browser
// (static GitHub Pages edition, simulated mode).

import { enrichChain, pickExpiration, type EnrichedChain } from "../engine/chain";
import type { DataMeta, HistoryBar, MarketDataProvider, Quote } from "./types";

export interface StockSnapshot {
  quote: Quote;
  history: { date: string; close: number; high: number; low: number }[];
  expirations: string[];
  riskFree: { rate: number; source: string };
  stats: {
    hv30: number | null;
    hv1y: number | null;
    atmIv: number | null;
    atmIvExpiration: string | null;
    support: number | null;
    resistance: number | null;
  };
  meta: DataMeta;
}

function histVol(closes: number[]): number | null {
  if (closes.length < 5) return null;
  const rets = closes.slice(1).map((c, i) => Math.log(c / closes[i]));
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const v = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(v * 252);
}

export async function snapshotFromProvider(p: MarketDataProvider, symbol: string): Promise<StockSnapshot> {
  const [q, h, e, rf] = await Promise.all([
    p.getQuote(symbol),
    p.getHistory(symbol, "1y"),
    p.getExpirations(symbol).catch(() => ({ data: [] as string[], meta: null })),
    p.getRiskFreeRate(),
  ]);
  const bars = (h.data as HistoryBar[]).filter((b) => b.close !== null) as Required<{ [K in keyof HistoryBar]: NonNullable<HistoryBar[K]> }>[];
  const closes = bars.map((b) => b.close);
  const last60 = bars.slice(-60);

  // ATM IV from the expiration closest to ~30 days out
  let atmIv: number | null = null;
  let atmIvExpiration: string | null = null;
  const now = Date.now();
  const exp30 = pickExpiration(e.data, 30, now);
  if (exp30) {
    try {
      const c = await p.getChain(symbol, exp30);
      const enriched = enrichChain(symbol, c.data, { spot: q.data.price, r: rf.rate, q: q.data.dividendYield ?? 0, now });
      if (enriched.atmIvSource === "chain") {
        atmIv = enriched.atmIv;
        atmIvExpiration = exp30;
      }
    } catch {}
  }

  return {
    quote: q.data,
    history: bars.map((b) => ({ date: b.date, close: b.close, high: b.high, low: b.low })),
    expirations: e.data,
    riskFree: rf,
    stats: {
      hv30: histVol(closes.slice(-22)),
      hv1y: histVol(closes),
      atmIv,
      atmIvExpiration,
      support: last60.length ? Math.min(...last60.map((b) => b.low)) : null,
      resistance: last60.length ? Math.max(...last60.map((b) => b.high)) : null,
    },
    meta: q.meta,
  };
}

export async function chainFromProvider(p: MarketDataProvider, symbol: string, expiration: string): Promise<{ chain: EnrichedChain; quote: Quote; meta: DataMeta }> {
  const [q, c, rf] = await Promise.all([p.getQuote(symbol), p.getChain(symbol, expiration), p.getRiskFreeRate()]);
  const chain = enrichChain(symbol, c.data, { spot: q.data.price, r: rf.rate, q: q.data.dividendYield ?? 0, now: Date.now() });
  return { chain, quote: q.data, meta: c.meta };
}
