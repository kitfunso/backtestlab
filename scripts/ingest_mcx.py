"""Daily MCX bhavcopy ingestion for Backtest Lab.

Fetches the given day's MCX bhavcopy via ``mcxpy``, extracts front-month
OHLCV for the 6 registry symbols, and appends a row to
``public/india/prices/mcx/{SYMBOL}.json`` if not already present.

Design notes
------------
- **Why mcxpy, not direct HTTP.** mcxpy wraps MCX's backend endpoints and
  works around the Akamai Cloudflare-style scrape block on the public
  dashboard URLs (which return 403 to plain requests). The same package
  also exposes iCOMDEX snapshots.
- **Idempotent.** Re-running on the same date is a no-op: if the target
  date already appears as the last entry in a symbol's JSON, we skip.
- **Rupee-native.** All values are in INR as published by MCX (no FX
  conversion). Downstream code multiplies by registry ``lot_size`` for
  contract notional.
- **Front-month selection.** Earliest-expiry row with positive close is
  preferred. If no contract has traded today (rare, pre-expiry only),
  we fall back to the earliest expiry settle.

Usage
-----
    python scripts/ingest_mcx.py                 # today, IST
    python scripts/ingest_mcx.py --dry-run       # log, do not write
    python scripts/ingest_mcx.py --date 2026-04-17
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from dataclasses import dataclass
from datetime import date, datetime, timezone, timedelta
from pathlib import Path

import pandas as pd
from mcxpy import mcx_bhavcopy

LOGGER = logging.getLogger("ingest_mcx")

REPO_ROOT = Path(__file__).resolve().parent.parent
REGISTRY_PATH = REPO_ROOT / "public" / "india" / "mcx-registry.json"
OUT_DIR = REPO_ROOT / "public" / "india" / "prices" / "mcx"

MCXPY_SYMBOL_MAP: dict[str, str] = {
    "GOLD": "GOLD",
    "SILVER": "SILVER",
    "COPPER": "COPPER",
    "CRUDE": "CRUDEOIL",
    "MCXBULLDEX": "MCXBULLDEX",
    "MCXMETLDEX": "MCXMETLDEX",
}

INSTRUMENT_KIND: dict[str, str] = {
    "GOLD": "FUTCOM",
    "SILVER": "FUTCOM",
    "COPPER": "FUTCOM",
    "CRUDE": "FUTCOM",
    "MCXBULLDEX": "FUTIDX",
    "MCXMETLDEX": "FUTIDX",
}


@dataclass
class OhlcvRow:
    open: float
    high: float
    low: float
    close: float
    volume: float


def _parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Fetch and parse, but do not write any files.",
    )
    parser.add_argument(
        "--date",
        type=str,
        default=None,
        help="Override target date (YYYY-MM-DD). Default: today (IST).",
    )
    return parser.parse_args(argv)


def _resolve_target_date(override: str | None) -> date:
    if override:
        return datetime.strptime(override, "%Y-%m-%d").date()
    ist = timezone(timedelta(hours=5, minutes=30))
    return datetime.now(ist).date()


def _load_registry_symbols() -> list[str]:
    data = json.loads(REGISTRY_PATH.read_text())
    return [c["symbol"] for c in data["commodities"]]


def _extract_front_month(
    df: pd.DataFrame, symbol_mcxpy: str, instrument_kind: str
) -> OhlcvRow | None:
    df = df.copy()
    df["Symbol"] = df["Symbol"].astype(str).str.strip()
    df["Instrument Name"] = df["Instrument Name"].astype(str).str.strip()
    rows = df[(df["Symbol"] == symbol_mcxpy) & (df["Instrument Name"] == instrument_kind)]
    if rows.empty:
        return None

    rows = rows.copy()
    rows["Expiry Date"] = pd.to_datetime(rows["Expiry Date"], errors="coerce")
    rows = rows.sort_values("Expiry Date")

    traded = rows[rows["Close"].astype(float) > 0]
    pick = traded.iloc[0] if not traded.empty else rows.iloc[0]

    try:
        return OhlcvRow(
            open=float(pick["Open"]),
            high=float(pick["High"]),
            low=float(pick["Low"]),
            close=float(pick["Close"]),
            volume=float(pick.get("Volume(Lots)", 0)),
        )
    except (TypeError, ValueError):
        return None


def _load_series(path: Path, ticker: str) -> dict:
    if path.exists():
        try:
            return json.loads(path.read_text())
        except (json.JSONDecodeError, OSError):
            pass
    return {
        "ticker": ticker,
        "dates": [],
        "open": [],
        "high": [],
        "low": [],
        "close": [],
        "volume": [],
    }


def _append_row(series: dict, iso_date: str, row: OhlcvRow) -> bool:
    if series["dates"] and series["dates"][-1] == iso_date:
        return False
    series["dates"].append(iso_date)
    series["open"].append(row.open)
    series["high"].append(row.high)
    series["low"].append(row.low)
    series["close"].append(row.close)
    series["volume"].append(row.volume)
    return True


def _write_series(path: Path, series: dict) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(series, indent=None, separators=(",", ":")))


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    args = _parse_args(argv or sys.argv[1:])
    target = _resolve_target_date(args.date)
    iso = target.strftime("%Y-%m-%d")

    if target.weekday() >= 5:
        LOGGER.info("%s is a weekend — MCX closed. Nothing to do.", iso)
        return 0

    symbols = _load_registry_symbols()
    LOGGER.info("Ingest target: %s (registry: %s)", iso, symbols)

    try:
        df = mcx_bhavcopy(target.strftime("%d-%m-%Y"))
    except Exception as exc:
        LOGGER.error("mcx_bhavcopy(%s) raised: %s", iso, exc)
        return 1

    if df is None or not hasattr(df, "__len__") or len(df) == 0:
        LOGGER.warning(
            "mcx_bhavcopy returned empty for %s (holiday or not-yet-published)",
            iso,
        )
        return 0

    updated = 0
    for sym in symbols:
        mcxpy_sym = MCXPY_SYMBOL_MAP.get(sym)
        kind = INSTRUMENT_KIND.get(sym)
        if mcxpy_sym is None or kind is None:
            LOGGER.warning("%s: no mcxpy mapping, skipping", sym)
            continue

        row = _extract_front_month(df, mcxpy_sym, kind)
        if row is None:
            LOGGER.info("%s: no row in bhavcopy for %s", sym, iso)
            continue

        path = OUT_DIR / f"{sym}.json"
        series = _load_series(path, sym)
        appended = _append_row(series, iso, row)
        if not appended:
            LOGGER.info("%s: already has %s, skipping", sym, iso)
            continue

        if args.dry_run:
            LOGGER.info(
                "%s [dry-run]: would append %s close=%.2f vol=%.0f",
                sym,
                iso,
                row.close,
                row.volume,
            )
            continue

        _write_series(path, series)
        updated += 1
        LOGGER.info("%s: appended %s close=%.2f vol=%.0f", sym, iso, row.close, row.volume)

    LOGGER.info("Done. Updated %d/%d symbols for %s.", updated, len(symbols), iso)
    return 0


if __name__ == "__main__":
    sys.exit(main())
