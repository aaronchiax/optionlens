"""
Build a static market-data snapshot for the GitHub Pages edition of OptionLens.

Writes provider-shaped JSON (the same shapes the FastAPI service returns) for a fixed list
of tickers, so the static site can run all analysis in the browser:

  <out>/index.json                     tickers covered, risk-free rate, generation time
  <out>/<SYM>/stock.json               quote, 1y daily history, expirations, meta
  <out>/<SYM>/chains/<YYYY-MM-DD>.json option chain per expiration

Usage:  python snapshot.py <out_dir> [tickers_file]
Exits non-zero if fewer than half of the tickers succeed, so a Yahoo outage never
replaces a good deployment with an empty one.
"""

from __future__ import annotations

import json
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import yfinance as yf

from main import _quote, _rows, clean

MAX_DAYS = 400  # covers the 12-month horizon plus the next expiration
PAUSE = 0.25  # seconds between Yahoo requests


def write(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")


def retry(fn, tries=3):
    for i in range(tries):
        try:
            return fn()
        except Exception:  # noqa: BLE001
            if i == tries - 1:
                raise
            time.sleep(2 * (i + 1))


def history_rows(t: yf.Ticker) -> list[dict]:
    df = t.history(period="1y", interval="1d", auto_adjust=False)
    return [
        {
            "date": idx.strftime("%Y-%m-%d"),
            "open": clean(r.get("Open")),
            "high": clean(r.get("High")),
            "low": clean(r.get("Low")),
            "close": clean(r.get("Close")),
            "volume": clean(r.get("Volume")),
        }
        for idx, r in df.iterrows()
    ]


def snapshot_ticker(sym: str, out: Path, now: datetime) -> dict:
    t = yf.Ticker(sym)
    quote = retry(lambda: _quote(sym))
    hist = retry(lambda: history_rows(t))
    exps_all = list(retry(lambda: t.options) or [])
    cutoff = (now + timedelta(days=MAX_DAYS)).date().isoformat()
    exps = [e for e in exps_all if e <= cutoff]
    spot = quote["price"]
    kept = []
    for e in exps:
        time.sleep(PAUSE)
        try:
            oc = retry(lambda: t.option_chain(e))
        except Exception:  # noqa: BLE001
            continue
        # trim far wings to keep the site small
        keep = lambda rows: [r for r in rows if r["strike"] and 0.4 * spot <= r["strike"] <= 2.2 * spot]  # noqa: E731
        write(out / sym / "chains" / f"{e}.json", {"expiration": e, "calls": keep(_rows(oc.calls)), "puts": keep(_rows(oc.puts))})
        kept.append(e)
    meta = {
        "provider": "yfinance-snapshot",
        "dataType": "delayed",
        "asOf": quote.get("regularMarketTime") or now.isoformat(),
        "retrievedAt": now.isoformat(),
    }
    write(out / sym / "stock.json", {"quote": quote, "history": hist, "expirations": kept, "meta": meta})
    return {
        "symbol": sym,
        "name": quote["name"],
        "exchange": quote.get("exchange"),
        "price": quote["price"],
        "change": quote.get("change"),
        "changePercent": quote.get("changePercent"),
        "expirations": len(kept),
    }


def risk_free() -> dict:
    try:
        df = yf.Ticker("^IRX").history(period="5d")
        return {"rate": float(df["Close"].dropna().iloc[-1]) / 100.0, "source": "^IRX (13-week T-bill)"}
    except Exception:  # noqa: BLE001
        return {"rate": 0.04, "source": "fallback 4.0%"}


def main() -> int:
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "public/data")
    tickers_file = Path(sys.argv[2] if len(sys.argv) > 2 else Path(__file__).with_name("tickers.txt"))
    tickers = [ln.strip().upper() for ln in tickers_file.read_text().splitlines() if ln.strip() and not ln.startswith("#")]
    now = datetime.now(timezone.utc)
    ok, failed = [], []
    for sym in tickers:
        try:
            ok.append(snapshot_ticker(sym, out, now))
            print(f"ok   {sym} ({ok[-1]['expirations']} expirations)", flush=True)
        except Exception as e:  # noqa: BLE001
            failed.append(sym)
            print(f"FAIL {sym}: {e}", flush=True)
    write(out / "index.json", {"generatedAt": now.isoformat(), "riskFree": risk_free(), "tickers": ok, "failed": failed})
    print(f"\n{len(ok)}/{len(tickers)} tickers written to {out}")
    return 0 if len(ok) >= max(1, len(tickers) // 2) else 1


if __name__ == "__main__":
    sys.exit(main())
