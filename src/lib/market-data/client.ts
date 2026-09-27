// Browser-side data access. Two deployment modes share every component:
//  • server mode (default): calls the Next.js API routes, which use the configured provider
//  • static mode (GitHub Pages, NEXT_PUBLIC_STATIC_DATA=1): reads the pre-built JSON snapshot
//    and runs the same composition logic in the browser
// Simulated mode (?source=simulated) runs the SimulatedProvider locally in static mode.

import type { EnrichedChain } from "../engine/chain";
import { chainFromProvider, snapshotFromProvider, type StockSnapshot } from "./compose";
import { SimulatedProvider } from "./simulated-provider";
import { StaticSnapshotProvider } from "./static-provider";
import { MarketDataError, type MarketDataProvider, type Quote, type SearchResult } from "./types";

export const STATIC_MODE = process.env.NEXT_PUBLIC_STATIC_DATA === "1";
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

let staticProvider: StaticSnapshotProvider | null = null;
export function snapshotProvider(): StaticSnapshotProvider {
  return (staticProvider ??= new StaticSnapshotProvider(BASE_PATH));
}
const localProvider = (simulated: boolean): MarketDataProvider => (simulated ? new SimulatedProvider() : snapshotProvider());

async function api<T>(url: string): Promise<T> {
  let r: Response;
  try {
    r = await fetch(url);
  } catch {
    throw new MarketDataError("Network error", 0);
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new MarketDataError(j.error ?? "Request failed", r.status);
  return j as T;
}

export async function loadSnapshot(symbol: string, simulated: boolean): Promise<StockSnapshot> {
  if (STATIC_MODE) return snapshotFromProvider(localProvider(simulated), symbol);
  return api<StockSnapshot>(`/api/stock/${encodeURIComponent(symbol)}${simulated ? "?source=simulated" : ""}`);
}

export async function loadChain(symbol: string, expiration: string, simulated: boolean): Promise<EnrichedChain> {
  if (STATIC_MODE) return (await chainFromProvider(localProvider(simulated), symbol, expiration)).chain;
  const j = await api<{ chain: EnrichedChain }>(`/api/options/${encodeURIComponent(symbol)}?expiration=${expiration}${simulated ? "&source=simulated" : ""}`);
  return j.chain;
}

export async function searchSymbols(q: string): Promise<SearchResult[]> {
  if (STATIC_MODE) return (await snapshotProvider().search(q)).data;
  return (await api<{ results: SearchResult[] }>(`/api/search?q=${encodeURIComponent(q)}`)).results ?? [];
}

export async function loadQuotes(symbols: string[]): Promise<(Quote | { symbol: string; error: string })[]> {
  if (STATIC_MODE) return (await snapshotProvider().getQuotes(symbols)).data;
  return (await api<{ quotes: (Quote | { symbol: string; error: string })[] }>(`/api/quotes?symbols=${symbols.join(",")}`)).quotes;
}

/** Tickers available in static mode (null in server mode, where any ticker works). */
export async function coveredTickers(): Promise<string[] | null> {
  if (!STATIC_MODE) return null;
  return (await snapshotProvider().getIndex()).tickers.map((t) => t.symbol);
}
