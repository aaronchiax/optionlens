"use client";

import { ArrowDownRight, ArrowUpRight, Loader2, Minus, Sparkles, TrendingDown, TrendingUp } from "lucide-react";
import clsx from "clsx";
import { HORIZONS, OUTLOOKS, VOL_VIEWS, type Outlook, type Scenario } from "@/lib/engine/types";
import { inferOutlook, OBJECTIVES } from "@/lib/engine/recommend";
import { pct } from "@/lib/format";

const OUTLOOK_ICON: Record<Outlook, typeof TrendingUp> = {
  bullish: TrendingUp,
  moderately_bullish: ArrowUpRight,
  neutral: Minus,
  moderately_bearish: ArrowDownRight,
  bearish: TrendingDown,
};

export interface ScenarioDraft {
  targetPrice: string;
  horizon: Scenario["horizon"];
  maxCapital: string;
  maxLoss: string;
  preference: Scenario["preference"];
  volView: string;
}

const num = (s: string) => parseFloat(s.replace(/[$,]/g, ""));

export function draftToScenario(d: ScenarioDraft, spot: number, sigma: number): Scenario | null {
  const t = num(d.targetPrice);
  if (!(t > 0)) return null;
  const cap = num(d.maxCapital);
  const loss = num(d.maxLoss);
  const days = HORIZONS.find((h) => h.key === d.horizon)?.days ?? 30;
  return {
    targetPrice: t,
    horizon: d.horizon,
    outlook: inferOutlook(spot, t, sigma, days),
    preference: d.preference === "all" ? "balanced" : d.preference,
    maxCapital: cap > 0 ? cap : undefined,
    maxLoss: loss > 0 ? loss : undefined,
    volView: parseFloat(d.volView) || 1,
  };
}

export function ScenarioInput({
  draft,
  onChange,
  spot,
  sigma,
  onGenerate,
  loading,
}: {
  draft: ScenarioDraft;
  onChange: (d: ScenarioDraft) => void;
  spot: number;
  sigma: number;
  onGenerate: () => void;
  loading: boolean;
}) {
  const set = <K extends keyof ScenarioDraft>(k: K, v: ScenarioDraft[K]) => onChange({ ...draft, [k]: v });
  const t = num(draft.targetPrice);
  const move = t > 0 ? (t - spot) / spot : null;
  const days = HORIZONS.find((h) => h.key === draft.horizon)!.days;
  const outlook = t > 0 ? inferOutlook(spot, t, sigma, days) : null;
  const OIcon = outlook ? OUTLOOK_ICON[outlook] : Minus;
  const oneSigma = spot * sigma * Math.sqrt(days / 365);
  const objective = OBJECTIVES.find((o) => o.pref === (draft.preference === "all" ? "balanced" : draft.preference))!;

  return (
    <section className="card relative overflow-hidden p-5 sm:p-6">
      <div aria-hidden className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-accent via-model to-accent opacity-80" />
      <h2 className="text-lg font-semibold">Your Market View</h2>
      <p className="mt-0.5 text-sm text-muted">State your view — the model searches for the position that best fits it.</p>

      <form
        className="mt-5 space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          onGenerate();
        }}
      >
        <div>
          <label className="label" htmlFor="target">Target price</label>
          <div className="relative mt-1.5">
            <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted">$</span>
            <input id="target" inputMode="decimal" className="input pl-7 text-base font-semibold tnum" value={draft.targetPrice} onChange={(e) => set("targetPrice", e.target.value)} placeholder="200" />
            {move !== null && (
              <span className={clsx("absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium tnum", move >= 0 ? "text-gain" : "text-loss")}>
                {pct(move, { sign: true })} vs spot
              </span>
            )}
          </div>
        </div>

        <div>
          <span className="label">Time horizon</span>
          <div className="mt-1.5 grid grid-cols-4 gap-1.5 sm:grid-cols-7 lg:grid-cols-4">
            {HORIZONS.map((h) => (
              <button
                type="button"
                key={h.key}
                onClick={() => set("horizon", h.key)}
                className={clsx("rounded-lg border px-2 py-1.5 text-xs font-medium transition", draft.horizon === h.key ? "border-accent bg-accent/10 text-accent" : "border-line text-ink-2 hover:border-ink-2/40")}
              >
                {h.label}
              </button>
            ))}
          </div>
        </div>

        {outlook && (
          <div className="flex items-start gap-3 rounded-xl border border-line bg-surface-2 p-3">
            <OIcon size={16} className={clsx("mt-0.5 shrink-0", outlook.includes("bull") ? "text-gain" : outlook.includes("bear") ? "text-loss" : "text-ink-2")} />
            <p className="text-xs leading-relaxed text-ink-2">
              <span className="font-semibold text-ink">Implied outlook: {OUTLOOKS.find((o) => o.key === outlook)!.label}.</span> Your target is {pct(Math.abs(move!))} {move! >= 0 ? "above" : "below"} spot; the options market prices a one-standard-deviation move of about ±${oneSigma.toFixed(2)} over this horizon.
            </p>
          </div>
        )}

        <div>
          <label className="label" htmlFor="vol">Volatility view</label>
          <select id="vol" className="input mt-1.5" value={draft.volView} onChange={(e) => set("volView", e.target.value)}>
            {VOL_VIEWS.map((v) => (
              <option key={v.value} value={String(v.value)}>{v.label}</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="cap">Max capital <span className="normal-case tracking-normal">(optional)</span></label>
            <input id="cap" inputMode="decimal" className="input mt-1.5 tnum" value={draft.maxCapital} onChange={(e) => set("maxCapital", e.target.value)} placeholder="$5,000" />
          </div>
          <div>
            <label className="label" htmlFor="loss">Max loss <span className="normal-case tracking-normal">(optional)</span></label>
            <input id="loss" inputMode="decimal" className="input mt-1.5 tnum" value={draft.maxLoss} onChange={(e) => set("maxLoss", e.target.value)} placeholder="$1,000" />
          </div>
        </div>

        <div>
          <label className="label" htmlFor="pref">Optimization objective</label>
          <select id="pref" className="input mt-1.5" value={objective.pref} onChange={(e) => set("preference", e.target.value as Scenario["preference"])}>
            {OBJECTIVES.map((o) => (
              <option key={o.key} value={o.pref}>{o.label}</option>
            ))}
          </select>
          <p className="mt-1.5 text-xs leading-relaxed text-muted">{objective.description}</p>
        </div>

        <button type="submit" className="btn-primary w-full py-3 text-base" disabled={loading || !(t > 0)}>
          {loading ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
          {loading ? "Searching positions…" : "Recommend a Strategy"}
        </button>
      </form>
    </section>
  );
}
