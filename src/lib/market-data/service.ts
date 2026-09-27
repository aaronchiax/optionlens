// Server-side entry points used by the API routes.

import { getProvider } from ".";
import { chainFromProvider, snapshotFromProvider } from "./compose";

export type { StockSnapshot } from "./compose";

export function getStockSnapshot(symbol: string, source?: string | null) {
  return snapshotFromProvider(getProvider(source), symbol);
}

export function getEnrichedChain(symbol: string, expiration: string, source?: string | null) {
  return chainFromProvider(getProvider(source), symbol, expiration);
}
