export function money(v: number | null | undefined, opts: { decimals?: number; sign?: boolean; compact?: boolean } = {}): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  if (v === Infinity) return "Unlimited";
  if (v === -Infinity) return "−Unlimited";
  const { sign = false, compact = false } = opts;
  if (Math.abs(v) < 0.005) v = 0;
  const abs = Math.abs(v);
  // whole-dollar amounts ≥ $100 drop the cents so position totals read consistently ($330, $1,670)
  const decimals = opts.decimals ?? (abs >= 1000 || (abs >= 100 && Math.abs(abs - Math.round(abs)) < 0.005) ? 0 : 2);
  let body: string;
  if (compact && abs >= 1e12) body = `${(abs / 1e12).toFixed(2)}T`;
  else if (compact && abs >= 1e9) body = `${(abs / 1e9).toFixed(2)}B`;
  else if (compact && abs >= 1e6) body = `${(abs / 1e6).toFixed(2)}M`;
  else body = abs.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const s = v < 0 ? "−" : sign && v > 0 ? "+" : "";
  return `${s}$${body}`;
}

export function pct(v: number | null | undefined, opts: { decimals?: number; sign?: boolean } = {}): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  if (v === Infinity) return "Unlimited";
  const { decimals = 1, sign = false } = opts;
  const s = v < 0 ? "−" : sign && v > 0 ? "+" : "";
  return `${s}${Math.abs(v * 100).toFixed(decimals)}%`;
}

export function num(v: number | null | undefined, decimals = 0): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function compactNum(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toFixed(0);
}

export function strike(k: number | undefined): string {
  if (k === undefined) return "";
  return `$${Number.isInteger(k) ? k : k.toFixed(2)}`;
}

export function fmtDate(iso: string | null | undefined, withTime = false): string {
  if (!iso) return "—";
  const d = iso.length === 10 ? new Date(`${iso}T12:00:00Z`) : new Date(iso);
  return d.toLocaleString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit", timeZoneName: "short" } : {}),
    ...(iso.length === 10 ? { timeZone: "UTC" } : {}),
  });
}

export function riskRewardText(rr: number | null, maxProfit: number): string {
  if (maxProfit === Infinity) return "1 : Unlimited";
  if (rr === null) return "—";
  if (rr === 0) return "Undefined risk";
  return `1 : ${rr.toFixed(2)}`;
}
