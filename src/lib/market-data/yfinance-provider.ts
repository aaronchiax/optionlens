import { MarketDataError, type DataMeta, type MarketDataProvider, type WithMeta } from "./types";

/** Talks to the Python yfinance service in /market-data-service. Delayed data. */
export class YFinanceProvider implements MarketDataProvider {
  readonly id = "yfinance";
  constructor(private baseUrl: string) {}

  private async get<T>(path: string): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, { cache: "no-store", signal: AbortSignal.timeout(25_000) });
    } catch {
      throw new MarketDataError(
        "The market-data service is unreachable. Start it with `npm run dev:api` (or `npm run dev` to run everything).",
        503,
      );
    }
    if (!res.ok) {
      let detail = res.statusText;
      try {
        detail = (await res.json()).detail ?? detail;
      } catch {}
      throw new MarketDataError(detail, res.status === 404 ? 404 : 502);
    }
    return res.json() as Promise<T>;
  }

  async search(q: string) {
    const r = await this.get<{ results: WithMeta<never>["data"]; meta: DataMeta }>(`/search?q=${encodeURIComponent(q)}`);
    return { data: r.results, meta: r.meta };
  }
  async getQuote(symbol: string) {
    const r = await this.get<{ quote: any; meta: DataMeta }>(`/quote/${encodeURIComponent(symbol)}`);
    return { data: r.quote, meta: r.meta };
  }
  async getQuotes(symbols: string[]) {
    const r = await this.get<{ quotes: any[]; meta: DataMeta }>(`/quotes?symbols=${encodeURIComponent(symbols.join(","))}`);
    return { data: r.quotes, meta: r.meta };
  }
  async getHistory(symbol: string, period = "1y") {
    const r = await this.get<{ history: any[]; meta: DataMeta }>(`/history/${encodeURIComponent(symbol)}?period=${period}`);
    return { data: r.history, meta: r.meta };
  }
  async getExpirations(symbol: string) {
    const r = await this.get<{ expirations: string[]; meta: DataMeta }>(`/options/${encodeURIComponent(symbol)}/expirations`);
    return { data: r.expirations, meta: r.meta };
  }
  async getChain(symbol: string, expiration: string) {
    const r = await this.get<{ chain: any; meta: DataMeta }>(`/options/${encodeURIComponent(symbol)}/chain?expiration=${expiration}`);
    return { data: r.chain, meta: r.meta };
  }
  async getRiskFreeRate() {
    try {
      const r = await this.get<{ rate: number; source: string }>(`/rates/risk-free`);
      return { rate: r.rate, source: r.source };
    } catch {
      return { rate: 0.04, source: "fallback 4.0%" };
    }
  }
}
