// Provider-agnostic market-data contracts. Any provider (yfinance, Polygon, Tradier, ...)
// implements MarketDataProvider and returns these shapes; nothing downstream knows the source.

export type DataType = "realtime" | "delayed" | "simulated";

export interface DataMeta {
  provider: string;
  dataType: DataType;
  /** timestamp the data represents (e.g. last regular-market trade) */
  asOf: string;
  retrievedAt: string;
}

export interface SearchResult {
  symbol: string;
  name: string;
  exchange?: string;
  type?: string;
}

export interface Quote {
  symbol: string;
  name: string;
  exchange?: string | null;
  currency: string;
  price: number;
  previousClose: number | null;
  change: number | null;
  changePercent: number | null;
  marketCap: number | null;
  averageVolume: number | null;
  volume: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  /** decimal, e.g. 0.004 */
  dividendYield: number;
  exDividendDate?: string | null;
  marketState?: string | null;
  regularMarketTime?: string | null;
}

export interface HistoryBar {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
}

export interface RawOption {
  contractSymbol: string;
  strike: number;
  bid: number;
  ask: number;
  last: number;
  volume: number;
  openInterest: number;
  impliedVolatility: number | null;
  inTheMoney: boolean;
  lastTradeDate: string | null;
}

export interface RawChain {
  expiration: string;
  calls: RawOption[];
  puts: RawOption[];
}

export interface WithMeta<T> {
  data: T;
  meta: DataMeta;
}

export interface MarketDataProvider {
  readonly id: string;
  search(query: string): Promise<WithMeta<SearchResult[]>>;
  getQuote(symbol: string): Promise<WithMeta<Quote>>;
  getQuotes(symbols: string[]): Promise<WithMeta<(Quote | { symbol: string; error: string })[]>>;
  getHistory(symbol: string, period?: string): Promise<WithMeta<HistoryBar[]>>;
  getExpirations(symbol: string): Promise<WithMeta<string[]>>;
  getChain(symbol: string, expiration: string): Promise<WithMeta<RawChain>>;
  getRiskFreeRate(): Promise<{ rate: number; source: string }>;
}

export class MarketDataError extends Error {
  constructor(message: string, public status = 502) {
    super(message);
  }
}
