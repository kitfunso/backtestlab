"""Build price-derived factor scores for the NSE universe.

Reads every price JSON under ``public/india/prices/*.json`` (ignoring the
``mcx/`` subfolder), re-implements the six factors from
``src/lib/factors/definitions.ts`` in pure Python, then writes a single
``public/india/factors.json`` with:

    {
      "computed_at": "2026-04-21",
      "universe_size": N,
      "factors": {
        "RELIANCE": {
          "mom12_1": 0.12,
          "mom6_1": 0.07,
          "low_vol": 0.28,
          "short_rev": -0.015,
          "low_beta": 1.05,
          "low_disp": 0.018
        },
        ...
      }
    }

Market proxy for ``low_beta``: if neither ``^NSEI.json`` nor ``NIFTY.json``
exists under the prices directory, build an equal-weight average of all
loaded close series aligned on their common date index.

Stdlib only (json + math + statistics + pathlib + datetime + logging).
Runs against all 204 NSE tickers in well under a second.
"""

from __future__ import annotations

import json
import logging
import math
import statistics
from datetime import date
from pathlib import Path
from typing import Iterable

logger = logging.getLogger("build_factors")

# ---------------------------------------------------------------------------
# Constants — keep in sync with src/lib/factors/definitions.ts
# ---------------------------------------------------------------------------

DAYS_YEAR = 252
SKIP_DAYS = 21
REVERSAL_DAYS = 5
DISPERSION_DAYS = 21
MOM6_DAYS = 126

REPO_ROOT = Path(__file__).resolve().parents[1]
PRICES_DIR = REPO_ROOT / "public" / "india" / "prices"
OUTPUT_PATH = REPO_ROOT / "public" / "india" / "factors.json"

# Candidate market-proxy filenames (checked in order).
MARKET_PROXY_FILES = ("^NSEI.json", "NIFTY.json")


# ---------------------------------------------------------------------------
# Factor implementations — TS-parity
# ---------------------------------------------------------------------------


def _simple_returns(closes: list[float]) -> list[float]:
    """Daily simple returns. Length = len(closes) - 1."""
    out: list[float] = []
    for i in range(1, len(closes)):
        prev = closes[i - 1]
        out.append(0.0 if prev == 0 else closes[i] / prev - 1.0)
    return out


def momentum_12_1(closes: list[float]) -> float | None:
    if len(closes) < DAYS_YEAR + 1:
        return None
    start = closes[-1 - DAYS_YEAR]
    end = closes[-1 - SKIP_DAYS]
    if start <= 0:
        return None
    return end / start - 1.0


def momentum_6_1(closes: list[float]) -> float | None:
    if len(closes) < MOM6_DAYS + 1:
        return None
    start = closes[-1 - MOM6_DAYS]
    end = closes[-1 - SKIP_DAYS]
    if start <= 0:
        return None
    return end / start - 1.0


def short_reversal(closes: list[float]) -> float | None:
    if len(closes) < REVERSAL_DAYS + 1:
        return None
    start = closes[-1 - REVERSAL_DAYS]
    end = closes[-1]
    if start <= 0:
        return None
    return -(end / start - 1.0)


def volatility(closes: list[float]) -> float | None:
    if len(closes) < DAYS_YEAR + 1:
        return None
    returns = _simple_returns(closes[-(DAYS_YEAR + 1):])
    if len(returns) < 2:
        return None
    std = statistics.stdev(returns)  # sample std (n-1), matches TS
    return std * math.sqrt(DAYS_YEAR)


def downside_beta(
    closes: list[float],
    market_closes: list[float],
) -> float | None:
    if len(closes) != len(market_closes):
        return None
    if len(closes) < DAYS_YEAR + 1:
        return None
    stock_ret = _simple_returns(closes[-(DAYS_YEAR + 1):])
    mkt_ret = _simple_returns(market_closes[-(DAYS_YEAR + 1):])

    down_stock: list[float] = []
    down_mkt: list[float] = []
    for s, m in zip(stock_ret, mkt_ret):
        if m < 0:
            down_stock.append(s)
            down_mkt.append(m)
    if len(down_mkt) < 2:
        return None

    mu_stock = statistics.fmean(down_stock)
    mu_mkt = statistics.fmean(down_mkt)
    cov = 0.0
    var_mkt = 0.0
    for s, m in zip(down_stock, down_mkt):
        dm = m - mu_mkt
        cov += (s - mu_stock) * dm
        var_mkt += dm * dm
    if var_mkt == 0:
        return None
    return cov / var_mkt


def dispersion(
    closes: list[float],
    highs: list[float],
    lows: list[float],
) -> float | None:
    n = len(closes)
    if n != len(highs) or n != len(lows):
        return None
    if n < DISPERSION_DAYS:
        return None
    total = 0.0
    count = 0
    for i in range(n - DISPERSION_DAYS, n):
        c = closes[i]
        if c <= 0:
            continue
        total += (highs[i] - lows[i]) / c
        count += 1
    if count == 0:
        return None
    return total / count


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------


def _load_one(path: Path) -> dict:
    """Load a single price JSON. Caller handles errors."""
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def _iter_price_files(prices_dir: Path) -> Iterable[Path]:
    """Yield top-level NSE price JSONs (skip the MCX subfolder)."""
    for path in sorted(prices_dir.glob("*.json")):
        if path.is_file():
            yield path


def _load_universe(prices_dir: Path) -> dict[str, dict]:
    """Load every NSE price JSON into a `ticker -> payload` dict."""
    universe: dict[str, dict] = {}
    for path in _iter_price_files(prices_dir):
        try:
            payload = _load_one(path)
        except (OSError, json.JSONDecodeError) as exc:
            logger.warning("skipping %s (%s)", path.name, exc)
            continue
        ticker = payload.get("ticker") or path.stem
        universe[ticker] = payload
    return universe


# ---------------------------------------------------------------------------
# Market proxy
# ---------------------------------------------------------------------------


def _find_market_proxy(prices_dir: Path) -> list[float] | None:
    """Return the market proxy close series, or None if no index file exists."""
    for name in MARKET_PROXY_FILES:
        path = prices_dir / name
        if path.exists():
            try:
                payload = _load_one(path)
                closes = [float(c) for c in payload["close"]]
                logger.info("using %s as market proxy (%d closes)", name, len(closes))
                return closes
            except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
                logger.warning("cannot read market proxy %s: %s", name, exc)
    return None


def _build_equal_weight_proxy(universe: dict[str, dict]) -> tuple[list[str], list[float]]:
    """Equal-weight return-based market proxy spanning the full universe history.

    We avoid intersecting on all-ticker-present dates (which collapses to the
    newest IPO and yields far less than 252 observations for beta). Instead:

      1. Union all dates across the universe.
      2. For each ticker build its daily return series.
      3. For each date, equal-weight the returns from every ticker with data
         that day.
      4. Cumulate those returns into a synthetic close series starting at 100.

    This gives a proxy with the FULL span of the earliest-listed ticker, even
    when many tickers IPO'd later.

    Returns ``(dates, proxy_closes)`` aligned oldest-first.
    """
    # Step 1: union of dates.
    all_dates: set[str] = set()
    for payload in universe.values():
        all_dates.update(str(d) for d in payload["dates"])
    if not all_dates:
        return [], []
    ordered_dates = sorted(all_dates)
    date_to_idx = {d: i for i, d in enumerate(ordered_dates)}
    n = len(ordered_dates)

    # Step 2/3: accumulate per-date return sum and count.
    sum_r = [0.0] * n
    count = [0] * n

    for payload in universe.values():
        dates_t = [str(d) for d in payload["dates"]]
        closes_t = payload["close"]
        if len(dates_t) != len(closes_t) or len(dates_t) < 2:
            continue
        for i in range(1, len(dates_t)):
            prev = closes_t[i - 1]
            curr = closes_t[i]
            if prev is None or curr is None or prev <= 0:
                continue
            try:
                r = float(curr) / float(prev) - 1.0
            except (TypeError, ValueError):
                continue
            idx = date_to_idx.get(dates_t[i])
            if idx is None:
                continue
            sum_r[idx] += r
            count[idx] += 1

    # Step 4: cumulate into synthetic close series starting at 100.
    proxy = [0.0] * n
    level = 100.0
    proxy[0] = level
    for i in range(1, n):
        if count[i] > 0:
            level *= 1.0 + sum_r[i] / count[i]
        proxy[i] = level

    logger.info(
        "equal-weight proxy built from %d tickers, %d union dates (first=%s last=%s)",
        len(universe),
        n,
        ordered_dates[0],
        ordered_dates[-1],
    )
    return ordered_dates, proxy


# ---------------------------------------------------------------------------
# Per-ticker factor assembly
# ---------------------------------------------------------------------------


def _align_market_to_stock(
    stock_dates: list[str],
    proxy_dates: list[str],
    proxy_closes: list[float],
) -> list[float] | None:
    """Return a proxy close vector aligned 1:1 with stock_dates.

    For every date in ``stock_dates`` that exists in ``proxy_dates`` we return
    the matching proxy close; missing dates are forward-filled from the prior
    known proxy value. If no proxy value has been seen yet (stock predates the
    proxy), we return None (no beta computable).
    """
    if not proxy_dates:
        return None
    index = {d: i for i, d in enumerate(proxy_dates)}
    aligned: list[float] = []
    last: float | None = None
    for d in stock_dates:
        idx = index.get(d)
        if idx is not None:
            last = proxy_closes[idx]
        if last is None:
            return None
        aligned.append(last)
    return aligned


def _compute_ticker_factors(
    closes: list[float],
    highs: list[float],
    lows: list[float],
    market_closes: list[float] | None,
) -> dict[str, float | None]:
    return {
        "mom12_1": momentum_12_1(closes),
        "mom6_1": momentum_6_1(closes),
        "low_vol": volatility(closes),
        "short_rev": short_reversal(closes),
        "low_beta": (
            downside_beta(closes, market_closes) if market_closes is not None else None
        ),
        "low_disp": dispersion(closes, highs, lows),
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def build_factors(
    prices_dir: Path = PRICES_DIR,
    output_path: Path = OUTPUT_PATH,
) -> dict:
    """Load universe, compute factors, write ``factors.json``. Return the dict."""
    universe = _load_universe(prices_dir)
    if not universe:
        raise RuntimeError(f"no price files found under {prices_dir}")

    # Resolve market proxy. Prefer an index file; fall back to equal-weight avg.
    proxy_closes = _find_market_proxy(prices_dir)
    if proxy_closes is not None:
        # Index files carry their own date vector; read it now.
        for name in MARKET_PROXY_FILES:
            p = prices_dir / name
            if p.exists():
                proxy_dates = [str(d) for d in _load_one(p)["dates"]]
                break
    else:
        proxy_dates, proxy_closes = _build_equal_weight_proxy(universe)

    factors: dict[str, dict[str, float | None]] = {}
    for ticker, payload in universe.items():
        try:
            closes = [float(c) for c in payload["close"]]
            highs = [float(h) for h in payload["high"]]
            lows = [float(l) for l in payload["low"]]
            dates_t = [str(d) for d in payload["dates"]]
        except (KeyError, TypeError, ValueError) as exc:
            logger.warning("skipping %s (bad payload: %s)", ticker, exc)
            continue

        aligned_market = (
            _align_market_to_stock(dates_t, proxy_dates, proxy_closes)
            if proxy_closes
            else None
        )
        factors[ticker] = _compute_ticker_factors(closes, highs, lows, aligned_market)

    # Sort output by ticker for stable diffs.
    factors_sorted = {t: factors[t] for t in sorted(factors)}

    result = {
        "computed_at": date.today().isoformat(),
        "universe_size": len(factors_sorted),
        "factors": factors_sorted,
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as fh:
        json.dump(result, fh, indent=2)
        fh.write("\n")
    logger.info("wrote %d tickers to %s", len(factors_sorted), output_path)
    return result


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    build_factors()


if __name__ == "__main__":
    main()
