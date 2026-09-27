"use client";

import { AlertTriangle, BookmarkPlus, Check, ChevronDown, Layers, Loader2, Wrench } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { pickExpiration, selectableExpirations, type EnrichedChain, type PricingContext } from "@/lib/engine/chain";
import { legFromContract, type Leg } from "@/lib/engine/position";
import { expirationsToSearch, recommend } from "@/lib/engine/recommend";
import { HORIZONS, PREFERENCES, VOL_VIEWS, type GenerationResult, type HorizonKey, type Preference, type Scenario, type StrategyResult } from "@/lib/engine/types";
import { RecommendationPanel } from "./RecommendationPanel";
import { useSearchParams } from "next/navigation";
import type { StockSnapshot } from "@/lib/market-data/compose";
import { loadChain as fetchChain, loadSnapshot, STATIC_MODE } from "@/lib/market-data/client";
import { MarketDataError } from "@/lib/market-data/types";
import { fmtDate, money } from "@/lib/format";
import { finiteOrNull, userData, type SavedAnalysis } from "@/lib/user-data/repository";
import { useDisclaimer } from "./Disclaimer";
import { SimulatedBanner } from "./DataBadge";
import { StockOverview } from "./StockOverview";
import { PriceChart } from "./PriceChart";
import { ScenarioInput, draftToScenario, type ScenarioDraft } from "./ScenarioInput";
import { StrategyCard } from "./StrategyCard";
import { SortBar, StrategyComparison, sortStrategies, type SortKey } from "./StrategyComparison";
import { StrategyDetail } from "./StrategyDetail";
import { OptionsChain } from "./OptionsChain";
import { CustomStrategyBuilder } from "./CustomStrategyBuilder";
import { StockSearch } from "./StockSearch";

interface Initial {
  target?: string;
  horizon?: string;
  outlook?: string;
  pref?: string;
  cap?: string;
  loss?: string;
  vol?: string;
}

export function AnalyzeView({ symbol }: { symbol: string }) {
  // Read query params in the browser so the page also works as a static export (GitHub Pages)
  const params = useSearchParams();
  const simulated = params.get("source") === "simulated";
  const initial: Initial = useMemo(() => {
    const g = (k: string) => params.get(k) ?? undefined;
    return { target: g("target"), horizon: g("horizon"), outlook: g("outlook"), pref: g("pref"), cap: g("cap"), loss: g("loss"), vol: g("vol") };
  }, [params]);
  const { requireAck } = useDisclaimer();

  const [snap, setSnap] = useState<StockSnapshot | null>(null);
  const [loadErr, setLoadErr] = useState<{ msg: string; status: number } | null>(null);
  const [draft, setDraft] = useState<ScenarioDraft | null>(null);
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [gen, setGen] = useState<{ result: GenerationResult; chain: EnrichedChain; now: number } | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genErr, setGenErr] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>("model");
  const [definedOnly, setDefinedOnly] = useState(false);
  const [selected, setSelected] = useState<StrategyResult | null>(null);
  const [legs, setLegsState] = useState<Leg[]>([]);
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [showExcluded, setShowExcluded] = useState(false);
  const [loadNow, setLoadNow] = useState(() => Date.now());
  const builderRef = useRef<HTMLDivElement>(null);
  const chainCache = useRef(new Map<string, Promise<EnrichedChain>>());
  const autoRan = useRef(false);

  const setLegs = useCallback((fn: (l: Leg[]) => Leg[]) => setLegsState(fn), []);
  const closeDetail = useCallback(() => setSelected(null), []);

  // ---- load snapshot
  useEffect(() => {
    let alive = true;
    loadSnapshot(symbol, simulated)
      .then((j) => {
        if (!alive) return;
        {
          setSnap(j);
          setLoadNow(Date.now());
          const spot = j.quote.price as number;
          const valid = <T extends string>(v: string | undefined, list: { key: T }[], d: T) => (list.some((x) => x.key === v) ? (v as T) : d);
          setDraft({
            targetPrice: initial.target ?? (Math.round(spot * 1.1 * 100) / 100).toFixed(2),
            horizon: valid<HorizonKey>(initial.horizon, HORIZONS, "3m"),
            preference: valid<Preference>(initial.pref === "all" ? "balanced" : initial.pref, PREFERENCES, "balanced"),
            maxCapital: initial.cap ?? "",
            maxLoss: initial.loss ?? "",
            volView: VOL_VIEWS.some((v) => String(v.value) === initial.vol) ? initial.vol! : "1",
          });
        }
      })
      .catch((e: unknown) => alive && setLoadErr({ msg: (e as Error).message || "Failed to load", status: e instanceof MarketDataError ? e.status : 0 }));
    userData.getWatchlist().then(setWatchlist);
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, simulated]);

  const loadChain = useCallback(
    (exp: string) => {
      const c = chainCache.current;
      if (!c.has(exp)) {
        const p = fetchChain(symbol, exp, simulated);
        p.catch(() => c.delete(exp));
        c.set(exp, p);
      }
      return c.get(exp)!;
    },
    [symbol, simulated],
  );

  const expirations = useMemo(() => (snap ? selectableExpirations(snap.expirations, loadNow) : []), [snap, loadNow]);
  const horizonDays = HORIZONS.find((h) => h.key === (draft?.horizon ?? "3m"))!.days;
  const defaultExp = useMemo(() => (snap ? pickExpiration(snap.expirations, horizonDays, loadNow) : null), [snap, horizonDays, loadNow]);

  const sigma = snap ? (snap.stats.atmIv ?? snap.stats.hv1y ?? 0.35) : 0.35;

  const generate = useCallback(async () => {
    if (!draft || !snap) return;
    const sc = draftToScenario(draft, snap.quote.price, sigma);
    if (!sc) return;
    if (!(await requireAck())) return;
    const days = HORIZONS.find((h) => h.key === sc.horizon)!.days;
    const exps = expirationsToSearch(snap.expirations, days, Date.now());
    if (!exps.length) {
      setGenErr("No listed options were found for this symbol.");
      return;
    }
    setGenerating(true);
    setGenErr(null);
    try {
      const chains = await Promise.all(exps.map(loadChain));
      await new Promise((r) => setTimeout(r, 30)); // let the loading state paint before the search
      const now = Date.now();
      const result = recommend({ symbol, chains, scenario: sc, horizonDays: days, now });
      setScenario(sc);
      setGen({ result, chain: chains[0], now });
      setTimeout(() => document.getElementById("results")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    } catch (e) {
      setGenErr((e as Error).message);
    }
    setGenerating(false);
  }, [draft, snap, sigma, loadChain, requireAck, symbol]);

  // Auto-run when arriving with a saved scenario (e.g. "rerun" from dashboard)
  useEffect(() => {
    if (!autoRan.current && snap && draft && initial.target) {
      autoRan.current = true;
      generate();
    }
  }, [snap, draft, initial.target, generate]);

  const ctx: PricingContext | null = useMemo(() => {
    if (gen) return { spot: gen.chain.spot, r: gen.chain.r, q: gen.chain.q, now: gen.now };
    if (snap) return { spot: snap.quote.price, r: snap.riskFree.rate, q: snap.quote.dividendYield ?? 0, now: loadNow };
    return null;
  }, [gen, snap, loadNow]);

  const builderScenario: Scenario | null = scenario ?? (draft && snap ? draftToScenario(draft, snap.quote.price, sigma) : null);
  const sorted = useMemo(() => (gen ? sortStrategies(gen.result.strategies, sort, definedOnly) : []), [gen, sort, definedOnly]);

  const toggleWatch = async () => {
    const next = watchlist.includes(symbol) ? watchlist.filter((s) => s !== symbol) : [...watchlist, symbol];
    setWatchlist(next);
    await userData.setWatchlist(next);
  };

  const save = async (only?: StrategyResult) => {
    if (!gen || !scenario || !snap) return;
    const list = only ? [only] : gen.result.recommendation?.pick ? [gen.result.recommendation.pick, ...gen.result.strategies.filter((s) => s !== gen.result.recommendation!.pick)] : gen.result.strategies;
    const a: SavedAnalysis = {
      id: `${symbol}-${Date.now()}`,
      symbol,
      scenario,
      spotAtSave: gen.chain.spot,
      createdAt: new Date().toISOString(),
      expiration: gen.result.expiration,
      strategies: list.map((s) => ({ name: s.name, label: s.label, capital: s.metrics.capital, maxProfit: finiteOrNull(s.metrics.maxProfit), maxLoss: finiteOrNull(s.metrics.maxLoss), pop: s.metrics.pop })),
    };
    await userData.saveAnalysis(a);
    setSavedMsg(only ? `Saved “${only.name}” to your dashboard` : "Analysis saved to your dashboard");
    setTimeout(() => setSavedMsg(null), 2500);
  };

  const customize = (s: StrategyResult) => {
    setLegsState(s.legs.map((l) => ({ ...l })));
    setSelected(null);
    setTimeout(() => builderRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  };

  // ---------------------------------------------------------------- render
  if (loadErr) {
    const unreachable = loadErr.status === 503;
    return (
      <div className="mx-auto max-w-xl px-4 py-20 text-center sm:px-6">
        <AlertTriangle className="mx-auto text-warn" size={32} />
        <h1 className="mt-4 text-xl font-semibold">{loadErr.status === 404 ? `We couldn't find “${symbol}”` : "Market data unavailable"}</h1>
        <p className="mt-2 text-sm text-ink-2">{loadErr.msg}</p>
        {unreachable && (
          <div className="mt-6 space-y-3">
            <p className="text-sm text-muted">You can explore the interface with clearly-labelled simulated data instead.</p>
            <Link className="btn-ghost" href={`/analyze/${symbol}?source=simulated`}>Use simulated demo data</Link>
          </div>
        )}
        <div className="mt-8">
          <StockSearch size="md" />
        </div>
      </div>
    );
  }

  if (!snap || !draft || !ctx) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <div className="card h-40 animate-pulse" />
        <div className="mt-6 grid gap-6 lg:grid-cols-[360px_1fr]">
          <div className="card h-[560px] animate-pulse" />
          <div className="card h-[380px] animate-pulse" />
        </div>
        <p className="mt-6 flex items-center justify-center gap-2 text-sm text-muted"><Loader2 size={16} className="animate-spin" /> Loading {symbol} market data…</p>
      </div>
    );
  }

  const target = parseFloat(draft.targetPrice) || null;

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
      {snap.meta.dataType === "simulated" && <SimulatedBanner />}
      <StockOverview snap={snap} watched={watchlist.includes(symbol)} onToggleWatch={toggleWatch} />

      <div className="grid items-start gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        <div className="lg:sticky lg:top-20">
          <ScenarioInput draft={draft} onChange={setDraft} spot={snap.quote.price} sigma={sigma} onGenerate={generate} loading={generating} />
          {genErr && <p className="mt-3 rounded-lg bg-loss/10 px-3 py-2 text-sm text-loss">{genErr}</p>}
        </div>

        <div className="min-w-0 space-y-6">
          <PriceChart snap={snap} target={target} horizonDays={horizonDays} />

          {!gen && (
            <div className="card flex flex-col items-center justify-center gap-3 p-10 text-center">
              <Layers className="text-muted" />
              <h2 className="font-semibold">Set your market view to get a recommendation</h2>
              <p className="max-w-md text-sm text-ink-2">
                OptionLens will search thousands of positions across the expirations around your horizon ({defaultExp ? fmtDate(defaultExp) : "—"}), score each one against your objective under your view, and recommend the top-ranked position within your capital and loss limits.
              </p>
            </div>
          )}

          {gen && scenario && (
            <section id="results" className="scroll-mt-20 space-y-4">
              {gen.result.recommendation && (
                <RecommendationPanel
                  rec={gen.result.recommendation}
                  ctx={ctx}
                  scenario={scenario}
                  onOpen={() => gen.result.recommendation?.pick && setSelected(gen.result.recommendation.pick)}
                />
              )}

              <div className="flex flex-wrap items-end justify-between gap-3 pt-2">
                <div>
                  <h2 className="text-xl font-semibold tracking-tight">Ranked alternatives</h2>
                  <p className="text-sm text-muted">
                    Best version of each structure type found by the search · Target {money(scenario.targetPrice)} · Searched {gen.result.recommendation?.expirationsSearched.map((e) => fmtDate(e)).join(", ")}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {savedMsg && <span className="flex items-center gap-1 text-sm text-gain"><Check size={14} /> {savedMsg}</span>}
                  <button className="btn-ghost py-2" onClick={() => save()}><BookmarkPlus size={15} /> Save analysis</button>
                </div>
              </div>

              {gen.result.warnings.length > 0 && (
                <ul className="space-y-1.5 rounded-xl border border-warn/30 bg-warn/5 p-3.5">
                  {gen.result.warnings.map((w) => (
                    <li key={w} className="flex gap-2 text-sm text-ink-2"><AlertTriangle size={15} className="mt-0.5 shrink-0 text-warn" />{w}</li>
                  ))}
                </ul>
              )}

              <SortBar sort={sort} setSort={setSort} definedOnly={definedOnly} setDefinedOnly={setDefinedOnly} />

              {sorted.length === 0 ? (
                <div className="card p-8 text-center text-sm text-ink-2">
                  No positions satisfy your constraints for these expirations. Try relaxing the capital / loss limits, another objective, or a different horizon.
                </div>
              ) : (
                <div className="grid gap-4 xl:grid-cols-2">
                  {sorted.map((s) => (
                    <StrategyCard key={s.key} s={s} ctx={ctx} target={scenario.targetPrice} onOpen={() => setSelected(s)} onSave={() => save(s)} />
                  ))}
                </div>
              )}

              {gen.result.excluded.length > 0 && (
                <div className="rounded-xl border border-line">
                  <button className="flex w-full items-center justify-between px-4 py-3 text-left text-sm" onClick={() => setShowExcluded((v) => !v)}>
                    <span className="text-ink-2">{gen.result.excluded.length} structure{gen.result.excluded.length === 1 ? " was" : "s were"} filtered out — see why</span>
                    <ChevronDown size={16} className={clsx("text-muted transition", showExcluded && "rotate-180")} />
                  </button>
                  {showExcluded && (
                    <ul className="space-y-1.5 border-t border-line px-4 py-3">
                      {gen.result.excluded.map((e) => (
                        <li key={e.templateId} className="text-sm"><span className="font-medium">{e.name}:</span> <span className="text-ink-2">{e.reason}</span></li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {sorted.length > 0 && (
                <section className="card p-5 sm:p-6">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <h2 className="font-semibold">Compare Strategies</h2>
                    <button className="btn-ghost py-2" onClick={() => builderRef.current?.scrollIntoView({ behavior: "smooth" })}>
                      <Wrench size={15} /> Build Your Own Strategy
                    </button>
                  </div>
                  <StrategyComparison list={sorted} onOpen={setSelected} sort={sort} />
                </section>
              )}
            </section>
          )}

          <OptionsChain
            expirations={expirations}
            initialExpiration={gen?.result.expiration ?? defaultExp}
            loadChain={loadChain}
            onAdd={(c, a) => setLegsState((ls) => [...ls, legFromContract(c, a)])}
          />

          <div ref={builderRef} className="scroll-mt-20">
            {builderScenario && (
              <CustomStrategyBuilder
                symbol={symbol}
                ctx={ctx}
                scenario={builderScenario}
                expirations={expirations}
                defaultExpiration={gen?.result.expiration ?? defaultExp}
                loadChain={loadChain}
                legs={legs}
                setLegs={setLegs}
              />
            )}
          </div>
        </div>
      </div>

      {selected && gen && scenario && (
        <StrategyDetail
          strategy={selected}
          symbol={symbol}
          ctx={ctx}
          scenario={scenario}
          expirations={expirations}
          loadChain={loadChain}
          onClose={closeDetail}
          onCustomize={customize}
        />
      )}
    </div>
  );
}
