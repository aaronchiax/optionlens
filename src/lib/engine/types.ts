import type { Leg, PositionMetrics } from "./position";

export type Outlook = "bullish" | "moderately_bullish" | "neutral" | "moderately_bearish" | "bearish";
export type Preference = "conservative" | "balanced" | "aggressive" | "all";
export type HorizonKey = "1w" | "2w" | "1m" | "2m" | "3m" | "6m" | "12m";

export const HORIZONS: { key: HorizonKey; label: string; days: number }[] = [
  { key: "1w", label: "1 week", days: 7 },
  { key: "2w", label: "2 weeks", days: 14 },
  { key: "1m", label: "1 month", days: 30 },
  { key: "2m", label: "2 months", days: 60 },
  { key: "3m", label: "3 months", days: 91 },
  { key: "6m", label: "6 months", days: 182 },
  { key: "12m", label: "12 months", days: 365 },
];

export const OUTLOOKS: { key: Outlook; label: string }[] = [
  { key: "bullish", label: "Bullish" },
  { key: "moderately_bullish", label: "Moderately Bullish" },
  { key: "neutral", label: "Neutral" },
  { key: "moderately_bearish", label: "Moderately Bearish" },
  { key: "bearish", label: "Bearish" },
];

export const PREFERENCES: { key: Preference; label: string }[] = [
  { key: "conservative", label: "Conservative" },
  { key: "balanced", label: "Balanced" },
  { key: "aggressive", label: "Aggressive" },
  { key: "all", label: "Show All" },
];

export interface Scenario {
  targetPrice: number;
  horizon: HorizonKey;
  outlook: Outlook;
  maxCapital?: number;
  maxLoss?: number;
  preference: Preference;
  /** user's view of future dispersion relative to implied vol (1 = market-implied) */
  volView?: number;
}

export const VOL_VIEWS: { value: number; label: string }[] = [
  { value: 1, label: "In line with the options market" },
  { value: 0.75, label: "Calmer than the market implies" },
  { value: 1.25, label: "More volatile than the market implies" },
];

export type StrategyId =
  | "long_call"
  | "bull_call_spread"
  | "otm_call_debit_spread"
  | "bull_put_spread"
  | "cash_secured_put"
  | "covered_call"
  | "long_put"
  | "bear_put_spread"
  | "bear_call_spread"
  | "iron_condor"
  | "call_butterfly"
  | "put_butterfly"
  | "short_strangle"
  | "custom";

export type Bias = "bullish" | "bearish" | "neutral";

export interface RiskItem {
  key: string;
  title: string;
  level: "low" | "medium" | "high" | "info";
  value?: string;
  text: string;
}

export interface Explanation {
  scenario: string;
  summary: string;
  whyItFits: string;
  tradeOffs: string[];
  structure: string;
  source: "rule-based" | "ai";
}

export interface StrategyResult {
  key: string;
  templateId: StrategyId;
  name: string;
  label: string;
  bias: Bias;
  definedRisk: boolean;
  profiles: Preference[];
  expiration: string;
  legs: Leg[];
  metrics: PositionMetrics;
  explanation: Explanation;
  risks: RiskItem[];
  /** how many 1-lot positions fit within the user's max capital */
  fitsWithinBudget: number | null;
  /** set by the recommendation engine */
  score?: ModelScore;
}

export type ObjectiveKey = "sharpe" | "tail" | "return";

/** Distribution-based evaluation of a candidate under the user's view, net of trading costs. */
export interface ModelScore {
  objective: ObjectiveKey;
  /** value of the objective being maximised */
  value: number;
  expectedPnl: number;
  stdPnl: number;
  /** expected shortfall: average P/L of the worst 5% of outcomes */
  cvar5: number;
  /** probability of profit under the user's view (vs. metrics.pop, which is market-implied) */
  popView: number;
  expectedReturn: number | null;
  /** estimated entry cost of crossing the bid/ask spread */
  costs: number;
  rank: number;
  candidatesInFamily: number;
}

export interface Driver {
  key: string;
  label: string;
  /** change in the recommendation's objective value */
  delta: number;
  /** what the model recommends under the perturbation */
  pickUnder: string;
  /** exact same position stays top-ranked */
  samePick: boolean;
  /** same structure type stays top-ranked (strikes/expiration may shift) */
  sameFamily: boolean;
}

export interface Recommendation {
  pick: StrategyResult | null;
  objective: ObjectiveKey;
  candidatesEvaluated: number;
  expirationsSearched: string[];
  drivers: Driver[];
  narrative: string[];
  /** set when no candidate has positive expected value under the user's view */
  noTradeReason?: string;
}

export interface ExcludedStrategy {
  templateId: StrategyId;
  name: string;
  reason: string;
}

export interface GenerationResult {
  strategies: StrategyResult[];
  excluded: ExcludedStrategy[];
  warnings: string[];
  expiration: string;
  recommendation?: Recommendation;
}
