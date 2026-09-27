import { DISCLAIMER_TEXT } from "./Disclaimer";

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-line/70">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <p className="max-w-4xl text-xs leading-relaxed text-muted">
          <span className="font-medium text-ink-2">Important: </span>
          {DISCLAIMER_TEXT}
        </p>
        <p className="mt-3 text-xs text-muted">
          Market data from Yahoo Finance via yfinance is delayed and provided for personal, educational use. Greeks and probabilities are model-calculated (Black-Scholes, lognormal) and are estimates.
        </p>
      </div>
    </footer>
  );
}
