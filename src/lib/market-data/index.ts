// Provider factory. Swap providers via MARKET_DATA_PROVIDER without touching callers.
// To add Polygon/Tradier/etc: implement MarketDataProvider and register it here.

import { SimulatedProvider } from "./simulated-provider";
import type { MarketDataProvider } from "./types";
import { YFinanceProvider } from "./yfinance-provider";

export * from "./types";

export function getProvider(source?: string | null): MarketDataProvider {
  const id = (source ?? process.env.MARKET_DATA_PROVIDER ?? "yfinance").toLowerCase();
  switch (id) {
    case "simulated":
      return new SimulatedProvider();
    case "yfinance":
    default:
      return new YFinanceProvider(process.env.YFINANCE_SERVICE_URL ?? "http://127.0.0.1:8765");
  }
}
