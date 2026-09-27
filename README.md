# OptionLens

**Turn your stock target into an options strategy.** Enter a ticker, your target price, horizon and outlook; OptionLens evaluates listed option structures on the live (delayed) chain and shows capital, max profit/loss, breakevens, model probability of profit, payoff diagrams, what-if tables and plain-English risk explanations.

> Educational and analytical only — not financial advice. All probabilities and Greeks are model estimates.

## Run it

Prereqs: Node 20+ and Python 3.10+.

```bash
# one-time
npm install
python -m venv market-data-service/.venv
market-data-service/.venv/Scripts/python -m pip install -r market-data-service/requirements.txt   # macOS/Linux: .venv/bin/python

# start both the yfinance service (:8765) and Next.js (:3000)
npm run dev
```

Open http://localhost:3000.

On Windows you can also double-click **`run-optionlens.cmd`**. It finds Node.js by its install path, so it works even in a terminal that was opened before Node was installed. Other scripts: `npm run typecheck`, `npm test` (engine invariants + a live run against the service), `npm run build`.

If the Python service is down, the analysis page offers a clearly-labelled **simulated data** mode (`?source=simulated`). Set `MARKET_DATA_PROVIDER=simulated` to make it the default (see `.env.example`).

## Architecture

```
market-data-service/main.py      FastAPI + yfinance: quotes, history, expirations, chains, ^IRX rate (raw data only, TTL cache)
src/lib/market-data/             Provider abstraction
  types.ts                       MarketDataProvider interface + DataMeta (provider, delayed/simulated, asOf)
  yfinance-provider.ts           HTTP client for the Python service
  simulated-provider.ts          Deterministic demo data, always labelled "simulated"
  index.ts                       getProvider() factory — add Polygon/Tradier/etc. here
  service.ts                     Composes snapshot (HV, ATM IV, support/resistance) + enriched chains
src/app/api/                     Server routes: /api/search, /api/stock/[symbol], /api/options/[symbol], /api/quotes
src/lib/engine/                  Pure TypeScript analytics (runs client-side for instant interaction)
  math.ts                        Black-Scholes, Greeks, IV solver, lognormal probabilities
  chain.ts                       Premium selection (mid → last → model), IV solving, Greeks, expiration picking
  position.ts                    Any-leg position: payoff, max P/L, breakevens, POP, capital, Greeks, liquidity
  strategies.ts                  13 strategy templates, outlook/preference/constraint filtering (no "best" score)
  explain.ts                     Rule-based explanations behind an ExplanationProvider interface (LLM-ready)
  risk.ts                        Plain-language risk items (assignment, early exercise, theta, vega, liquidity)
src/lib/user-data/repository.ts  Watchlist & saved analyses (localStorage now; Supabase-ready interface)
supabase/schema.sql              Tables + RLS for accounts, watchlists, scenarios, analyses, strategies
src/components/                  StockSearch, StockOverview, PriceChart, ScenarioInput, StrategyCard, StrategyComparison,
                                 StrategyDetail, PayoffChart, ScenarioSimulator, RiskAnalysis, OptionsChain, CustomStrategyBuilder
```

### Recommendation engine (`src/lib/engine/recommend.ts`)
Adapted from the principles of Cong, Tang & Wang, *AlphaPortfolio: Goal-Oriented Investment Management Through Deep Reinforcement Learning* (SSRN 3554486):

| Paper principle | OptionLens implementation |
|---|---|
| Direct, end-to-end optimisation of the investor's objective (not predict-then-optimise) | Every candidate is scored on its full P/L distribution under your view; the pick is the argmax of your objective |
| Enlarged policy space | ~5,000–6,500 candidates: all verticals, butterflies, condors, single options, CSPs, covered calls (and strangles if no loss limit) across the expiration matching your horizon and its neighbours. The paper needs RL because exhaustive search is infeasible for portfolios; one options position is small enough to search exhaustively |
| Flexible objectives | Sharpe ratio (balanced, the paper's baseline), expected P/L ÷ expected shortfall with a defined-risk + ≥55% win-probability floor (conservative), expected return on capital (aggressive) |
| Costs and constraints inside the objective | Half bid/ask spread deducted from every leg; max capital / max loss are hard constraints |
| Robustness and economic distillation | Five stress tests (target half-way / overshoot, ±25% dispersion, doubled costs) re-run the full search and report score sensitivity and whether the pick survives |

Your view is modelled as a lognormal whose **expected price** follows a path to your target over your horizon, with dispersion from implied vol (optionally ±25% via the volatility view). Each leg's expectation uses that leg's own implied vol, so if your view equals the market's, every position's expected P/L is ≈ −costs (`npm test` asserts this). Positive expected value therefore comes only from your view. If no position clears a minimum edge (Sharpe 0.1 / tail ratio 0.1 / 3% expected return), the model says **no trade**.

### Modelling notes
- **Premiums** use the bid/ask mid when available; outside market hours Yahoo returns 0 bid/ask, so the last trade is used and the UI says so.
- **IV** is re-solved from the premium used (Yahoo's IV field is unreliable off-hours); Greeks are Black-Scholes with dividend yield and the 13-week T-bill rate.
- **Probability of profit** = risk-neutral lognormal probability of finishing in the profit zones at expiration, using ATM IV.
- **Capital** = net debit, or max loss for defined-risk credit structures, or a Reg-T-style margin *estimate* for undefined risk.
- European pricing approximates American options; early-exercise risk is described qualitatively.

## Roadmap hooks
- **Accounts:** implement `UserDataRepository` with Supabase using `supabase/schema.sql`.
- **AI explanations:** implement `ExplanationProvider` (e.g. a server route calling an LLM) and pass engine output as context.
- **Data providers:** implement `MarketDataProvider` for a licensed real-time feed.
