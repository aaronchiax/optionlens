// Simulated provider for demos / offline development. Every response is labelled
// dataType: "simulated" and the UI shows a prominent banner. Never presented as real data.

import { bsPrice } from "../engine/math";
import { expirationMs } from "../engine/chain";
import type { HistoryBar, MarketDataProvider, Quote, RawChain, RawOption } from "./types";

function seedFrom(s: string) {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const meta = () => ({ provider: "simulated", dataType: "simulated" as const, asOf: new Date().toISOString(), retrievedAt: new Date().toISOString() });

function profile(symbol: string) {
  const r = rng(seedFrom(symbol));
  return { price: Math.round((20 + r() * 380) * 100) / 100, vol: 0.2 + r() * 0.45 };
}

export class SimulatedProvider implements MarketDataProvider {
  readonly id = "simulated";

  async search(q: string) {
    const s = q.toUpperCase().replace(/[^A-Z.]/g, "").slice(0, 6) || "DEMO";
    return { data: [{ symbol: s, name: `${s} (simulated)`, exchange: "SIM", type: "EQUITY" }], meta: meta() };
  }

  async getQuote(symbol: string) {
    const s = symbol.toUpperCase();
    const hist = (await this.getHistory(s)).data;
    const closes = hist.map((h) => h.close!);
    const price = closes[closes.length - 1];
    const prev = closes[closes.length - 2];
    const q: Quote = {
      symbol: s,
      name: `${s} Simulated Corp.`,
      exchange: "SIMULATED",
      currency: "USD",
      price,
      previousClose: prev,
      change: price - prev,
      changePercent: ((price - prev) / prev) * 100,
      marketCap: price * 1e9,
      averageVolume: 12_000_000,
      volume: 9_500_000,
      fiftyTwoWeekHigh: Math.max(...closes),
      fiftyTwoWeekLow: Math.min(...closes),
      dividendYield: 0.005,
      marketState: "SIMULATED",
      regularMarketTime: new Date().toISOString(),
    };
    return { data: q, meta: meta() };
  }

  async getQuotes(symbols: string[]) {
    return { data: await Promise.all(symbols.map(async (s) => (await this.getQuote(s)).data)), meta: meta() };
  }

  async getHistory(symbol: string): Promise<{ data: HistoryBar[]; meta: ReturnType<typeof meta> }> {
    const { price, vol } = profile(symbol.toUpperCase());
    const r = rng(seedFrom(symbol.toUpperCase() + "h"));
    const days = 252;
    const bars: HistoryBar[] = [];
    let p = price * 0.8;
    const d = new Date();
    const dates: Date[] = [];
    while (dates.length < days) {
      if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) dates.unshift(new Date(d));
      d.setUTCDate(d.getUTCDate() - 1);
    }
    for (const dt of dates) {
      const z = Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
      const open = p;
      p = p * Math.exp(0.0006 + (vol / Math.sqrt(252)) * z);
      bars.push({ date: dt.toISOString().slice(0, 10), open, high: Math.max(open, p) * 1.005, low: Math.min(open, p) * 0.995, close: Math.round(p * 100) / 100, volume: 1e7 });
    }
    return { data: bars, meta: meta() };
  }

  async getExpirations() {
    const out: string[] = [];
    const d = new Date();
    for (let i = 0; i < 400 && out.length < 18; i++) {
      d.setUTCDate(d.getUTCDate() + 1);
      if (d.getUTCDay() !== 5) continue;
      const days = i + 1;
      const monthly = d.getUTCDate() >= 15 && d.getUTCDate() <= 21;
      if (days <= 35 || monthly) out.push(d.toISOString().slice(0, 10));
    }
    return { data: out, meta: meta() };
  }

  async getChain(symbol: string, expiration: string) {
    const { data: q } = await this.getQuote(symbol);
    const { vol } = profile(symbol.toUpperCase());
    const S = q.price;
    const T = Math.max((expirationMs(expiration) - Date.now()) / (365 * 86_400_000), 1 / 365);
    const step = S < 50 ? 1 : S < 150 ? 2.5 : S < 400 ? 5 : 10;
    const strikes: number[] = [];
    for (let k = Math.max(step, Math.floor((S * 0.5) / step) * step); k <= S * 1.6; k += step) strikes.push(k);
    const r = rng(seedFrom(symbol + expiration));
    const mk = (K: number, type: "call" | "put"): RawOption => {
      const m = Math.log(K / S);
      const sigma = vol * (1 - 0.35 * m + 0.8 * m * m); // simple skew/smile
      const fair = bsPrice({ S, K, T, r: 0.04, q: 0.005, sigma, type });
      const half = Math.max(0.01, fair * 0.02 + 0.02);
      const oi = Math.round(5000 * Math.exp(-8 * m * m) * (0.5 + r()));
      return {
        contractSymbol: `${symbol}${expiration.replace(/-/g, "").slice(2)}${type === "call" ? "C" : "P"}${String(K * 1000).padStart(8, "0")}`,
        strike: K,
        bid: Math.max(0, Math.round((fair - half) * 100) / 100),
        ask: Math.round((fair + half) * 100) / 100,
        last: Math.round(fair * 100) / 100,
        volume: Math.round(oi * 0.1 * r()),
        openInterest: oi,
        impliedVolatility: sigma,
        inTheMoney: type === "call" ? S > K : S < K,
        lastTradeDate: new Date().toISOString(),
      };
    };
    const chain: RawChain = { expiration, calls: strikes.map((k) => mk(k, "call")), puts: strikes.map((k) => mk(k, "put")) };
    return { data: chain, meta: meta() };
  }

  async getRiskFreeRate() {
    return { rate: 0.04, source: "simulated 4.0%" };
  }
}
