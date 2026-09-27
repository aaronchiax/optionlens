// Turns a raw provider chain into an analysis-ready chain: a single premium per contract,
// a model-consistent implied vol, and Black-Scholes Greeks.

import type { RawChain, RawOption } from "../market-data/types";
import { bsGreeks, bsPrice, impliedVol, type OptionType, YEAR_MS } from "./math";

export type PremiumSource = "mid" | "last" | "model";
export type IvSource = "solved" | "provider" | "fallback";

export interface OptionContract extends RawOption {
  type: OptionType;
  expiration: string;
  mid: number | null;
  /** price per share the engine uses for this contract */
  premium: number;
  premiumSource: PremiumSource;
  spread: number | null;
  spreadPct: number | null;
  iv: number;
  ivSource: IvSource;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
}

export interface EnrichedChain {
  symbol: string;
  expiration: string;
  dte: number;
  /** years to expiry at enrichment time */
  T: number;
  spot: number;
  r: number;
  q: number;
  atmIv: number;
  atmIvSource: "chain" | "fallback";
  calls: OptionContract[];
  puts: OptionContract[];
  /** true when bid/ask were unavailable (e.g. market closed) and last trades were used */
  usesLastPrices: boolean;
}

export interface PricingContext {
  spot: number;
  r: number;
  q: number;
  /** epoch ms of "now" */
  now: number;
}

/** Options expire at the 4pm ET close; 20:00 UTC is used as an approximation. */
export function expirationMs(expiration: string): number {
  const [y, m, d] = expiration.split("-").map(Number);
  return Date.UTC(y, m - 1, d, 20, 0, 0);
}

export function yearsUntil(expiration: string, fromMs: number): number {
  return Math.max((expirationMs(expiration) - fromMs) / YEAR_MS, 0);
}

export function daysUntil(expiration: string, fromMs: number): number {
  return Math.max(Math.ceil((expirationMs(expiration) - fromMs) / 86_400_000), 0);
}

const IV_MIN = 0.03;
const IV_MAX = 4;
const validIv = (v: number | null | undefined): v is number => typeof v === "number" && v >= IV_MIN && v <= IV_MAX;

function pickPremium(o: RawOption): { mid: number | null; premium: number; source: PremiumSource } {
  const mid = o.bid > 0 && o.ask > 0 && o.ask >= o.bid ? (o.bid + o.ask) / 2 : null;
  if (mid !== null) return { mid, premium: mid, source: "mid" };
  if (o.last > 0) return { mid: null, premium: o.last, source: "last" };
  return { mid: null, premium: 0, source: "model" };
}

export function enrichChain(symbol: string, raw: RawChain, ctx: PricingContext): EnrichedChain {
  const T = Math.max(yearsUntil(raw.expiration, ctx.now), 1 / (365 * 24));
  const { spot: S, r, q } = ctx;

  type Stage = { o: RawOption; type: OptionType; p: ReturnType<typeof pickPremium>; iv: number | null; ivSource: IvSource };
  const stage = (o: RawOption, type: OptionType): Stage => {
    const p = pickPremium(o);
    const solved = p.premium > 0 ? impliedVol(p.premium, { S, K: o.strike, T, r, q, type }) : null;
    if (validIv(solved)) return { o, type, p, iv: solved, ivSource: "solved" };
    if (validIv(o.impliedVolatility) && o.impliedVolatility > 0.05) return { o, type, p, iv: o.impliedVolatility, ivSource: "provider" };
    return { o, type, p, iv: null, ivSource: "fallback" };
  };

  const calls = raw.calls.filter((o) => o.strike > 0).map((o) => stage(o, "call"));
  const puts = raw.puts.filter((o) => o.strike > 0).map((o) => stage(o, "put"));

  // ATM IV: average of the valid IVs on the ~4 strikes closest to spot (OTM side preferred).
  const near = [...calls.filter((c) => c.o.strike >= S), ...puts.filter((p) => p.o.strike <= S)]
    .filter((s) => s.iv !== null)
    .sort((a, b) => Math.abs(a.o.strike - S) - Math.abs(b.o.strike - S))
    .slice(0, 4);
  let atmIv: number;
  let atmIvSource: EnrichedChain["atmIvSource"] = "chain";
  if (near.length) atmIv = near.reduce((a, s) => a + (s.iv as number), 0) / near.length;
  else {
    const all = [...calls, ...puts].map((s) => s.iv).filter(validIv).sort((a, b) => a - b);
    if (all.length) atmIv = all[Math.floor(all.length / 2)];
    else {
      atmIv = 0.4;
      atmIvSource = "fallback";
    }
  }

  const finish = (s: Stage): OptionContract => {
    const iv = s.iv ?? atmIv;
    const premium = s.p.premium > 0 ? s.p.premium : bsPrice({ S, K: s.o.strike, T, r, q, sigma: iv, type: s.type });
    const g = bsGreeks({ S, K: s.o.strike, T, r, q, sigma: iv, type: s.type });
    const spread = s.o.bid > 0 && s.o.ask > 0 ? s.o.ask - s.o.bid : null;
    return {
      ...s.o,
      type: s.type,
      expiration: raw.expiration,
      mid: s.p.mid,
      premium,
      premiumSource: s.p.source,
      spread,
      spreadPct: spread !== null && s.p.mid ? spread / s.p.mid : null,
      iv,
      ivSource: s.iv === null ? "fallback" : s.ivSource,
      ...g,
    };
  };

  const enrichedCalls = calls.map(finish).sort((a, b) => a.strike - b.strike);
  const enrichedPuts = puts.map(finish).sort((a, b) => a.strike - b.strike);
  const all = [...enrichedCalls, ...enrichedPuts];
  return {
    symbol,
    expiration: raw.expiration,
    dte: daysUntil(raw.expiration, ctx.now),
    T,
    spot: S,
    r,
    q,
    atmIv,
    atmIvSource,
    calls: enrichedCalls,
    puts: enrichedPuts,
    usesLastPrices: all.length > 0 && all.filter((c) => c.premiumSource === "mid").length < all.length * 0.2,
  };
}

/** Expirations more than ~1 day out (same-day/0DTE contracts are excluded from analysis). */
export function selectableExpirations(expirations: string[], now: number): string[] {
  return expirations.filter((e) => expirationMs(e) - now > 86_400_000);
}

/** Pick the listed expiration that best matches a horizon: first expiry on/after the target date. */
export function pickExpiration(expirations: string[], horizonDays: number, now: number): string | null {
  const future = expirations.filter((e) => expirationMs(e) - now > 86_400_000 * 1.5);
  if (!future.length) return expirations[expirations.length - 1] ?? null;
  const targetMs = now + horizonDays * 86_400_000;
  const onOrAfter = future.find((e) => expirationMs(e) >= targetMs - 2 * 86_400_000);
  return onOrAfter ?? future[future.length - 1];
}

/** A contract is "tradable" for strategy selection when it has a market-derived premium. */
export function isTradable(c: OptionContract): boolean {
  return c.premiumSource !== "model" && c.premium >= 0.05 && (c.openInterest > 0 || c.volume > 0);
}
