// User data (watchlist, saved scenarios & strategies) behind a repository interface.
// MVP: LocalStorageRepository (per-device, no account). A SupabaseRepository implementing the
// same interface can be dropped in once auth is added — see supabase/schema.sql.

import type { Scenario } from "../engine/types";

export interface SavedAnalysis {
  id: string;
  symbol: string;
  scenario: Scenario;
  spotAtSave: number;
  createdAt: string;
  expiration: string | null;
  /** compact snapshot of strategy results at save time */
  strategies: { name: string; label: string; capital: number; maxProfit: number | null; maxLoss: number | null; pop: number | null }[];
  note?: string;
}

export interface UserDataRepository {
  getWatchlist(): Promise<string[]>;
  setWatchlist(symbols: string[]): Promise<void>;
  listAnalyses(): Promise<SavedAnalysis[]>;
  saveAnalysis(a: SavedAnalysis): Promise<void>;
  deleteAnalysis(id: string): Promise<void>;
}

const WL = "optionlens.watchlist.v1";
const AN = "optionlens.analyses.v1";
const DEFAULT_WATCHLIST = ["AAPL", "NVDA", "TSLA", "MSFT", "AMZN"];

function read<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
    window.dispatchEvent(new CustomEvent("optionlens:userdata"));
  } catch {}
}

export class LocalStorageRepository implements UserDataRepository {
  async getWatchlist() {
    return read<string[]>(WL, DEFAULT_WATCHLIST);
  }
  async setWatchlist(symbols: string[]) {
    write(WL, [...new Set(symbols.map((s) => s.toUpperCase()))]);
  }
  async listAnalyses() {
    return read<SavedAnalysis[]>(AN, []).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async saveAnalysis(a: SavedAnalysis) {
    const all = read<SavedAnalysis[]>(AN, []).filter((x) => x.id !== a.id);
    write(AN, [a, ...all].slice(0, 200));
  }
  async deleteAnalysis(id: string) {
    write(AN, read<SavedAnalysis[]>(AN, []).filter((x) => x.id !== id));
  }
}

export const userData: UserDataRepository = new LocalStorageRepository();

// Serialize Infinity safely for storage
export const finiteOrNull = (v: number | null) => (v === null || !Number.isFinite(v) ? null : v);

export function scenarioToQuery(s: Scenario): string {
  const p = new URLSearchParams({ target: String(s.targetPrice), horizon: s.horizon, outlook: s.outlook, pref: s.preference });
  if (s.maxCapital) p.set("cap", String(s.maxCapital));
  if (s.maxLoss) p.set("loss", String(s.maxLoss));
  if (s.volView && s.volView !== 1) p.set("vol", String(s.volView));
  return p.toString();
}
