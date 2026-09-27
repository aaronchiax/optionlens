"""
OptionLens market-data service.

A thin FastAPI wrapper around yfinance. It returns *raw* market data only
(quotes, history, option chains). All analytics (Greeks, IV solving,
strategy construction) live in the TypeScript engine so the provider can be
swapped for Polygon / Tradier / etc. without touching the analysis code.

Yahoo Finance data is delayed and is provided for personal / educational use.
"""

from __future__ import annotations

import math
import time
from datetime import datetime, timezone
from typing import Any, Callable

import yfinance as yf
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="OptionLens Market Data Service", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET"], allow_headers=["*"])

PROVIDER = "yfinance"

# ---------------------------------------------------------------------------
# Small TTL cache so repeated UI interactions don't hammer Yahoo.
# ---------------------------------------------------------------------------
_cache: dict[str, tuple[float, Any]] = {}


def cached(key: str, ttl: float, fn: Callable[[], Any]) -> Any:
    now = time.time()
    hit = _cache.get(key)
    if hit and now - hit[0] < ttl:
        return hit[1]
    value = fn()
    _cache[key] = (now, value)
    return value


def clean(v: Any) -> Any:
    """Convert NaN / numpy scalars to JSON-safe Python values."""
    if v is None:
        return None
    try:
        if hasattr(v, "item"):
            v = v.item()
    except Exception:
        pass
    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
        return None
    return v


def iso(ts: Any) -> str | None:
    if ts is None:
        return None
    try:
        if isinstance(ts, (int, float)):
            return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
        if hasattr(ts, "to_pydatetime"):
            ts = ts.to_pydatetime()
        if isinstance(ts, datetime):
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
            return ts.astimezone(timezone.utc).isoformat()
    except Exception:
        return None
    return None


def meta(as_of: str | None = None) -> dict:
    return {
        "provider": PROVIDER,
        "dataType": "delayed",
        "asOf": as_of or datetime.now(timezone.utc).isoformat(),
        "retrievedAt": datetime.now(timezone.utc).isoformat(),
    }


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@app.get("/health")
def health():
    return {"ok": True, "provider": PROVIDER, "yfinance": yf.__version__}


@app.get("/search")
def search(q: str = Query(..., min_length=1)):
    def run():
        try:
            res = yf.Search(q, max_results=10, news_count=0)
            quotes = res.quotes or []
        except Exception as e:  # noqa: BLE001
            raise HTTPException(502, f"Search failed: {e}")
        out = []
        for item in quotes:
            qt = item.get("quoteType")
            if qt not in ("EQUITY", "ETF"):
                continue
            out.append(
                {
                    "symbol": item.get("symbol"),
                    "name": item.get("longname") or item.get("shortname") or item.get("symbol"),
                    "exchange": item.get("exchDisp") or item.get("exchange"),
                    "type": qt,
                }
            )
        return out

    return {"results": cached(f"search:{q.lower()}", 300, run), "meta": meta()}


def _quote(symbol: str) -> dict:
    t = yf.Ticker(symbol)
    try:
        info = t.info or {}
    except Exception:  # noqa: BLE001
        info = {}
    fi = None
    try:
        fi = t.fast_info
    except Exception:  # noqa: BLE001
        pass

    def fi_get(attr: str):
        try:
            return clean(getattr(fi, attr)) if fi is not None else None
        except Exception:  # noqa: BLE001
            return None

    price = clean(info.get("regularMarketPrice")) or clean(info.get("currentPrice")) or fi_get("last_price")
    if price is None:
        raise HTTPException(404, f"No price data found for '{symbol}'. Check the ticker symbol.")

    prev_close = clean(info.get("regularMarketPreviousClose")) or clean(info.get("previousClose")) or fi_get("previous_close")
    change = clean(info.get("regularMarketChange"))
    change_pct = clean(info.get("regularMarketChangePercent"))
    if change is None and prev_close:
        change = price - prev_close
    if change_pct is None and prev_close:
        change_pct = (price - prev_close) / prev_close * 100

    dividend_rate = clean(info.get("dividendRate")) or clean(info.get("trailingAnnualDividendRate"))
    dividend_yield = (dividend_rate / price) if (dividend_rate and price) else 0.0

    return {
        "symbol": symbol.upper(),
        "name": info.get("longName") or info.get("shortName") or symbol.upper(),
        "exchange": info.get("fullExchangeName") or info.get("exchange"),
        "currency": info.get("currency") or fi_get("currency") or "USD",
        "quoteType": info.get("quoteType"),
        "price": price,
        "previousClose": prev_close,
        "change": change,
        "changePercent": change_pct,
        "marketCap": clean(info.get("marketCap")) or fi_get("market_cap"),
        "averageVolume": clean(info.get("averageVolume")) or fi_get("three_month_average_volume"),
        "volume": clean(info.get("regularMarketVolume")) or fi_get("last_volume"),
        "fiftyTwoWeekHigh": clean(info.get("fiftyTwoWeekHigh")) or fi_get("year_high"),
        "fiftyTwoWeekLow": clean(info.get("fiftyTwoWeekLow")) or fi_get("year_low"),
        "dividendYield": dividend_yield,
        "exDividendDate": iso(info.get("exDividendDate")),
        "marketState": info.get("marketState"),
        "regularMarketTime": iso(info.get("regularMarketTime")),
    }


@app.get("/quote/{symbol}")
def quote(symbol: str):
    symbol = symbol.upper().strip()
    data = cached(f"quote:{symbol}", 30, lambda: _quote(symbol))
    return {"quote": data, "meta": meta(data.get("regularMarketTime"))}


@app.get("/quotes")
def quotes(symbols: str):
    out = []
    for s in [x.strip().upper() for x in symbols.split(",") if x.strip()][:25]:
        try:
            out.append(cached(f"quote:{s}", 30, lambda s=s: _quote(s)))
        except HTTPException:
            out.append({"symbol": s, "error": "not found"})
        except Exception as e:  # noqa: BLE001
            out.append({"symbol": s, "error": str(e)})
    return {"quotes": out, "meta": meta()}


@app.get("/history/{symbol}")
def history(symbol: str, period: str = "1y", interval: str = "1d"):
    symbol = symbol.upper().strip()

    def run():
        df = yf.Ticker(symbol).history(period=period, interval=interval, auto_adjust=False)
        if df is None or df.empty:
            raise HTTPException(404, f"No history for '{symbol}'")
        rows = []
        for idx, r in df.iterrows():
            rows.append(
                {
                    "date": idx.strftime("%Y-%m-%d"),
                    "open": clean(r.get("Open")),
                    "high": clean(r.get("High")),
                    "low": clean(r.get("Low")),
                    "close": clean(r.get("Close")),
                    "volume": clean(r.get("Volume")),
                }
            )
        return rows

    rows = cached(f"hist:{symbol}:{period}:{interval}", 600, run)
    return {"history": rows, "meta": meta()}


@app.get("/options/{symbol}/expirations")
def expirations(symbol: str):
    symbol = symbol.upper().strip()

    def run():
        try:
            return list(yf.Ticker(symbol).options or [])
        except Exception as e:  # noqa: BLE001
            raise HTTPException(502, f"Could not load expirations: {e}")

    return {"expirations": cached(f"exp:{symbol}", 600, run), "meta": meta()}


def _rows(df) -> list[dict]:
    out = []
    if df is None or df.empty:
        return out
    for _, r in df.iterrows():
        out.append(
            {
                "contractSymbol": r.get("contractSymbol"),
                "strike": clean(r.get("strike")),
                "bid": clean(r.get("bid")) or 0.0,
                "ask": clean(r.get("ask")) or 0.0,
                "last": clean(r.get("lastPrice")) or 0.0,
                "volume": clean(r.get("volume")) or 0,
                "openInterest": clean(r.get("openInterest")) or 0,
                "impliedVolatility": clean(r.get("impliedVolatility")),
                "inTheMoney": bool(clean(r.get("inTheMoney"))),
                "lastTradeDate": iso(r.get("lastTradeDate")),
            }
        )
    return out


@app.get("/options/{symbol}/chain")
def chain(symbol: str, expiration: str):
    symbol = symbol.upper().strip()

    def run():
        try:
            oc = yf.Ticker(symbol).option_chain(expiration)
        except Exception as e:  # noqa: BLE001
            raise HTTPException(404, f"No option chain for {symbol} {expiration}: {e}")
        return {"expiration": expiration, "calls": _rows(oc.calls), "puts": _rows(oc.puts)}

    return {"chain": cached(f"chain:{symbol}:{expiration}", 60, run), "meta": meta()}


@app.get("/rates/risk-free")
def risk_free():
    """13-week T-bill yield (^IRX) as a proxy for the risk-free rate."""

    def run():
        try:
            df = yf.Ticker("^IRX").history(period="5d")
            v = float(df["Close"].dropna().iloc[-1]) / 100.0
            return {"rate": v, "source": "^IRX (13-week T-bill)"}
        except Exception:  # noqa: BLE001
            return {"rate": 0.04, "source": "fallback 4.0%"}

    return {**cached("rfr", 3600, run), "meta": meta()}
