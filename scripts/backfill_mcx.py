"""12-month historical backfill for MCX commodities.

We populate ``public/india/prices/mcx/{SYMBOL}.json`` with ~1 year of daily
OHLCV data. The 4 single commodities (GOLD, SILVER, COPPER, CRUDE) use
Yahoo Finance surrogates; the 2 MCX iCOMDEX indices are left empty because
no public historical source mirrors them - the live ingest script will
forward-fill them from MCX bhavcopy going forward.

Surrogate mapping (all Yahoo Finance futures continuous front-month):

    GOLD    <- GC=F  (COMEX gold, USD / troy ounce)
    SILVER  <- SI=F  (COMEX silver, USD / troy ounce)
    COPPER  <- HG=F  (COMEX copper, USD / lb)
    CRUDE   <- CL=F  (NYMEX WTI, USD / barrel)

Important caveat
----------------
These surrogates are **not rupee-native** and not denominated in MCX's
contract units (INR / 10g, INR / kg, INR / bbl, etc.). They are intended
as shape surrogates only - the realized correlation between MCX spot and
its global benchmark is >0.95 for gold/silver/copper/crude, so the
returns, volatility, and trend structure are faithful even though the
absolute price level is off. Once the MCX live ingest runs, its INR prints
land at the head of the series and any downstream backtest should use the
tail segment. A future improvement is to convert USD prints to INR via a
historical USD/INR series and align units (INR / 10g = USD / oz *
USDINR / 3.11035).

Usage
-----
    python scripts/backfill_mcx.py
    python scripts/backfill_mcx.py --period 2y
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path
from typing import Optional

import pandas as pd

try:
    import yfinance as yf
except ImportError as exc:  # pragma: no cover
    raise SystemExit(
        "yfinance is required. Install with: pip install -r scripts/requirements.txt"
    ) from exc

LOGGER = logging.getLogger("backfill_mcx")

REPO_ROOT = Path(__file__).resolve().parent.parent
REGISTRY_PATH = REPO_ROOT / "public" / "india" / "mcx-registry.json"
PRICES_DIR = REPO_ROOT / "public" / "india" / "prices" / "mcx"

SURROGATES: dict[str, str] = {
    "GOLD": "GC=F",
    "SILVER": "SI=F",
    "COPPER": "HG=F",
    "CRUDE": "CL=F",
}


def _parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--period",
        type=str,
        default="max",
        help="yfinance period string (e.g. 1y, 5y, max). Default: max",
    )
    return parser.parse_args(argv)


def _load_registry_symbols() -> list[str]:
    with REGISTRY_PATH.open("r", encoding="utf-8") as fh:
        registry = json.load(fh)
    return [c["symbol"] for c in registry["commodities"]]


def _fetch_yfinance(ticker: str, period: str) -> Optional[pd.DataFrame]:
    LOGGER.info("Downloading %s (period=%s) from Yahoo Finance", ticker, period)
    try:
        df = yf.download(
            ticker,
            period=period,
            interval="1d",
            auto_adjust=False,
            progress=False,
            threads=False,
        )
    except Exception as exc:  # noqa: BLE001 - network / parse failures
        LOGGER.warning("yfinance download for %s failed: %s", ticker, exc)
        return None
    if df is None or df.empty:
        LOGGER.warning("yfinance returned empty frame for %s", ticker)
        return None
    if isinstance(df.columns, pd.MultiIndex):
        # yfinance returns a single-ticker multiindex with ticker at level 1
        df.columns = df.columns.get_level_values(0)
    return df


def _frame_to_series(symbol: str, df: pd.DataFrame) -> dict:
    df = df.dropna(subset=["Open", "High", "Low", "Close"]).copy()
    dates = [idx.strftime("%Y-%m-%d") for idx in df.index]
    return {
        "ticker": symbol,
        "dates": dates,
        "open": [float(v) for v in df["Open"].tolist()],
        "high": [float(v) for v in df["High"].tolist()],
        "low": [float(v) for v in df["Low"].tolist()],
        "close": [float(v) for v in df["Close"].tolist()],
        "volume": [
            float(v) if pd.notna(v) else 0.0 for v in df.get("Volume", pd.Series(dtype=float)).tolist()
        ]
        if "Volume" in df.columns
        else [0.0] * len(dates),
    }


def _empty_series(symbol: str) -> dict:
    return {
        "ticker": symbol,
        "dates": [],
        "open": [],
        "high": [],
        "low": [],
        "close": [],
        "volume": [],
    }


def _write_series(path: Path, series: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        json.dump(series, fh, separators=(",", ":"))
        fh.write("\n")


def main(argv: Optional[list[str]] = None) -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    args = _parse_args(argv if argv is not None else sys.argv[1:])
    symbols = _load_registry_symbols()
    PRICES_DIR.mkdir(parents=True, exist_ok=True)

    successes: list[str] = []
    skipped: list[str] = []
    failed: list[str] = []

    for symbol in symbols:
        path = PRICES_DIR / f"{symbol}.json"
        surrogate = SURROGATES.get(symbol)
        if surrogate is None:
            LOGGER.info(
                "%s has no surrogate (index-only, forward-filled by live ingest)",
                symbol,
            )
            _write_series(path, _empty_series(symbol))
            skipped.append(symbol)
            continue
        df = _fetch_yfinance(surrogate, args.period)
        if df is None:
            LOGGER.warning("Backfill failed for %s; leaving file untouched", symbol)
            failed.append(symbol)
            continue
        series = _frame_to_series(symbol, df)
        _write_series(path, series)
        LOGGER.info(
            "%s: wrote %d days (%s -> %s)",
            symbol,
            len(series["dates"]),
            series["dates"][0] if series["dates"] else "-",
            series["dates"][-1] if series["dates"] else "-",
        )
        successes.append(symbol)

    LOGGER.info(
        "Backfill summary: success=%s skipped=%s failed=%s",
        successes,
        skipped,
        failed,
    )
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())
