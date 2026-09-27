import Link from "next/link";
import { ArrowRight, BarChart3, Layers, LineChart, ShieldCheck, Target, Wand2 } from "lucide-react";
import { StockSearch } from "@/components/StockSearch";

const EXAMPLES = ["NVDA", "AAPL", "TSLA", "MSFT", "AMZN", "SPY"];

const STEPS = [
  { icon: Target, title: "State your view", text: "Target price, time horizon, direction, and how much capital or loss you can accept." },
  { icon: Layers, title: "The model searches", text: "Thousands of strike and expiration combinations are scored against your objective under your view, net of trading costs." },
  { icon: BarChart3, title: "Get a recommendation", text: "See the top-ranked position, why it was chosen, how robust it is — and every alternative, side by side." },
];

const FEATURES = [
  { icon: LineChart, title: "Interactive payoff diagrams", text: "Drag the stock price, move the valuation date, or re-price on another expiration." },
  { icon: Wand2, title: "Plain-English explanations", text: "Every structure explains why it may fit your scenario — and what you give up." },
  { icon: ShieldCheck, title: "Risk, spelled out", text: "Assignment, early exercise, time decay, volatility and liquidity for every position." },
];

export default function Home() {
  return (
    <div className="relative overflow-hidden">
      {/* subtle grid backdrop */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-[0.5] [mask-image:radial-gradient(ellipse_at_top,black_30%,transparent_70%)]"
        style={{
          backgroundImage: "linear-gradient(rgb(var(--line)) 1px, transparent 1px), linear-gradient(90deg, rgb(var(--line)) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
        }}
      />
      <section className="mx-auto max-w-4xl px-4 pb-16 pt-20 text-center sm:px-6 sm:pt-28">
        <span className="chip mb-6">Stock target → options strategy · decision support</span>
        <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-6xl">
          Turn Your Stock Target Into an <span className="text-accent">Options Strategy.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-balance text-base leading-relaxed text-ink-2 sm:text-lg">
          Enter a stock, your target price and timeframe. OptionLens analyzes available options structures and shows potential strategies, risk/reward and breakeven scenarios.
        </p>
        <div id="analyze" className="mx-auto mt-10 max-w-2xl scroll-mt-24">
          <StockSearch autoFocus />
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-sm text-muted">
            <span>Try</span>
            {EXAMPLES.map((s) => (
              <Link key={s} href={`/analyze/${s}`} className="rounded-lg border border-line bg-surface px-2.5 py-1 font-medium text-ink-2 transition hover:border-accent hover:text-accent">
                {s}
              </Link>
            ))}
          </div>
        </div>
        <div className="mt-8">
          <Link href="/analyze/NVDA" className="btn-primary px-6 py-3 text-base">
            Analyze a Stock <ArrowRight size={18} />
          </Link>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="grid gap-4 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <div key={s.title} className="card p-6">
              <div className="flex items-center gap-3">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent/10 text-accent">
                  <s.icon size={18} />
                </span>
                <span className="text-xs font-medium text-muted">Step {i + 1}</span>
              </div>
              <h3 className="mt-4 font-semibold">{s.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-2">{s.text}</p>
            </div>
          ))}
        </div>
        <div className="mt-12 grid gap-8 border-t border-line pt-12 md:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title}>
              <f.icon size={20} className="text-ink-2" />
              <h3 className="mt-3 font-semibold">{f.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-2">{f.text}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
