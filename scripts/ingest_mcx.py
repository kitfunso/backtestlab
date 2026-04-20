"""Daily MCX bhavcopy ingestion for Backtest Lab.

Fetches today's (or --date) MCX bhavcopy, filters to the 6 registry symbols,
and appends an OHLCV row to ``public/india/prices/mcx/{SYMBOL}.json``.

Design notes
------------
- **No browser automation.** MCX's public dashboard is a Cloudflare-protected
  SPA. This script targets the public CSV archive at
  ``https://www.mcxindia.com/docs/default-source/market-data/bhav-copy/``
  which serves a daily CSV without JS rendering. If that endpoint is blocked
  (anti-scrape + session cookies), we fall back to the internal JSON endpoint
  ``/backpage.aspx/GetBhavCopy``. If both fail, the script logs a clear
  warning and exits non-zero so a cron failure surfaces the blocker without
  corrupting data.
- **Idempotent.** Re-running on the same date is a no-op: the script checks
  whether the last date in each per-symbol JSON already matches the target
  before writing.
- **Rupee-native.** MCX bhavcopy prices are already in INR; no conversion.
  Gold quoted INR / 10g, Silver INR / kg, Copper INR / kg, Crude INR / bbl,
  indices in absolute index points. Downstream code multiplies by
  ``lot_size`` (from mcx-registry.json) to convert to contract notional.

Usage
-----
    python scripts/ingest_mcx.py                 # today, IST
    python scripts/ingest_mcx.py --dry-run       # log, do not write
    python scripts/ingest_mcx.py --date 2026-04-18
"""

from __future__ import annotations

import argparse
import io
import json
import logging
import sys
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

import pandas as pd
import requests
from dateutil import tz

LOGGER = logging.getLogger("ingest_mcx")

REPO_ROOT = Path(__file__).resolve().parent.parent
REGISTRY_PATH = REPO_ROOT / "public" / "india" / "mcx-registry.json"
PRICES_DIR = REPO_ROOT / "public" / "india" / "prices" / "mcx"

# Symbol -> bhavcopy column match (MCX uses upper-case symbol codes).
# The bhavcopy lists many contract expiries per symbol; we aggregate to the
# front-month (highest volume) row per symbol per day.
SYMBOL_ALIASES: dict[str, tuple[str, ...]] = {
    "GOLD": ("GOLD",),
    "SILVER": ("SILVER", "SILVERM"),  # SILVERM is the mini, fall back if SILVER absent
    "COPPER": ("COPPER",),
    "CRUDE": ("CRUDEOIL", "CRUDE"),
    "MCXBULLDEX": ("BULLDEX", "MCXBULLDEX"),
    "MCXMETLDEX": ("METLDEX", "MCXMETLDEX"),
}

BHAVCOPY_CSV_URL = (
    "https://www.mcxindia.com/docs/default-source/market-data/bhav-copy/"
    "{yyyy}/{mm}/{ddmmyyyy}.csv"
)
BHAVCOPY_JSON_URL = "https://www.mcxindia.com/backpage.aspx/GetBhavCopy"

REQUEST_TIMEOUT = 20
USER_AGENT = (
    "Mozilla/5.0 (compatible; BacktestLab/0.1; +https://backtestlab.pages.dev)"
)

IST = tz.gettz("Asia/Kolkata")


@dataclass(frozen=True)
class BhavRow:
    symbol: str
    open_: float
    high: float
    low: float
    close: float
    volume: float


def _parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Log the parsed rows but do not write any files.",
    )
    parser.add_argument(
        "--date",
        type=str,
        default=None,
        help="Target date YYYY-MM-DD. Defaults to today (IST).",
    )
    return parser.parse_args(argv)


def _resolve_target_date(override: Optional[str]) -> date:
    if override:
        return datetime.strptime(override, "%Y-%m-%d").date()
    # MCX operates on IST; pick today in IST.
    return datetime.now(tz=IST).date()


def _load_registry_symbols() -> list[str]:
    with REGISTRY_PATH.open("r", encoding="utf-8") as fh:
        registry = json.load(fh)
    return [c["symbol"] for c in registry["commodities"]]


def _fetch_csv_bhavcopy(target: date) -> Optional[pd.DataFrame]:
    url = BHAVCOPY_CSV_URL.format(
        yyyy=f"{target.year:04d}",
        mm=f"{target.month:02d}",
        ddmmyyyy=target.strftime("%d%m%Y"),
    )
    LOGGER.info("Attempting CSV bhavcopy fetch: %s", url)
    try:
        response = requests.get(
            url,
            headers={"User-Agent": USER_AGENT, "Accept": "text/csv,*/*"},
            timeout=REQUEST_TIMEOUT,
        )
    except requests.RequestException as exc:
        LOGGER.warning("CSV bhavcopy request failed: %s", exc)
        return None
    if response.status_code != 200 or not response.content:
        LOGGER.warning(
            "CSV bhavcopy returned HTTP %s (len=%d)",
            response.status_code,
            len(response.content),
        )
        return None
    try:
        return pd.read_csv(io.BytesIO(response.content))
    except Exception as exc:  # noqa: BLE001 - we log and fall back
        LOGGER.warning("CSV bhavcopy parse failed: %s", exc)
        return None


def _fetch_json_bhavcopy(target: date) -> Optional[pd.DataFrame]:
    LOGGER.info("Attempting JSON bhavcopy fetch: %s", BHAVCOPY_JSON_URL)
    payload = {"Date": target.strftime("%d/%m/%Y")}
    try:
        response = requests.post(
            BHAVCOPY_JSON_URL,
            json=payload,
            headers={
                "User-Agent": USER_AGENT,
                "Content-Type": "application/json; charset=utf-8",
                "Accept": "application/json, text/plain, */*",
                "Referer": "https://www.mcxindia.com/market-data/bhavcopy",
            },
            timeout=REQUEST_TIMEOUT,
        )
    except requests.RequestException as exc:
        LOGGER.warning("JSON bhavcopy request failed: %s", exc)
        return None
    if response.status_code != 200:
        LOGGER.warning("JSON bhavcopy returned HTTP %s", response.status_code)
        return None
    try:
        body = response.json()
    except ValueError as exc:
        LOGGER.warning("JSON bhavcopy parse failed: %s", exc)
        return None
    rows = body.get("d") if isinstance(body, dict) else body
    if not rows:
        LOGGER.warning("JSON bhavcopy returned empty payload")
        return None
    try:
        return pd.DataFrame(rows)
    except Exception as exc:  # noqa: BLE001
        LOGGER.warning("JSON bhavcopy dataframe build failed: %s", exc)
        return None


def _extract_row(df: pd.DataFrame, aliases: tuple[str, ...]) -> Optional[BhavRow]:
    """Pick the highest-volume contract row for the first alias that matches."""
    cols = {c.lower().strip(): c for c in df.columns}
    sym_col = cols.get("symbol") or cols.get("instrument") or cols.get("commodity")
    if sym_col is None:
        LOGGER.warning("Bhavcopy missing symbol column; columns=%s", list(df.columns))
        return None
    open_col = cols.get("open") or cols.get("openprice")
    high_col = cols.get("high") or cols.get("highprice")
    low_col = cols.get("low") or cols.get("lowprice")
    close_col = cols.get("close") or cols.get("closeprice") or cols.get("settlement")
    vol_col = cols.get("volume") or cols.get("contracts") or cols.get("totaltradedqty")
    if not all([open_col, high_col, low_col, close_col]):
        LOGGER.warning("Bhavcopy missing OHLC columns; have %s", list(df.columns))
        return None

    symbols_upper = df[sym_col].astype(str).str.upper().str.strip()
    for alias in aliases:
        mask = symbols_upper == alias.upper()
        if not mask.any():
            continue
        subset = df.loc[mask].copy()
        if vol_col is not None and vol_col in subset:
            subset = subset.sort_values(vol_col, ascending=False)
        row = subset.iloc[0]
        try:
            return BhavRow(
                symbol=alias,
                open_=float(row[open_col]),
                high=float(row[high_col]),
                low=float(row[low_col]),
                close=float(row[close_col]),
                volume=float(row[vol_col]) if vol_col else 0.0,
            )
        except (TypeError, ValueError) as exc:
            LOGGER.warning("Row parse failed for %s: %s", alias, exc)
            return None
    return None


def _load_series(path: Path, ticker: str) -> dict:
    if path.exists():
        with path.open("r", encoding="utf-8") as fh:
            return json.load(fh)
    return {
        "ticker": ticker,
        "dates": [],
        "open": [],
        "high": [],
        "low": [],
        "close": [],
        "volume": [],
    }


def _append_row(series: dict, target: date, row: BhavRow) -> bool:
    iso = target.isoformat()
    if series["dates"] and series["dates"][-1] == iso:
        LOGGER.info("%s already has %s; skipping", series["ticker"], iso)
        return False
    if series["dates"] and series["dates"][-1] > iso:
        LOGGER.warning(
            "%s last date %s is after target %s; skipping to preserve order",
            series["ticker"],
            series["dates"][-1],
            iso,
        )
        return False
    series["dates"].append(iso)
    series["open"].append(row.open_)
    series["high"].append(row.high)
    series["low"].append(row.low)
    series["close"].append(row.close)
    series["volume"].append(row.volume)
    return True


def _write_series(path: Path, series: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        json.dump(series, fh, separators=(",", ":"))
        fh.write("\n")


def _fetch_bhavcopy(target: date) -> Optional[pd.DataFrame]:
    df = _fetch_csv_bhavcopy(target)
    if df is not None and not df.empty:
        return df
    return _fetch_json_bhavcopy(target)


def main(argv: Optional[list[str]] = None) -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    args = _parse_args(argv if argv is not None else sys.argv[1:])
    target = _resolve_target_date(args.date)
    LOGGER.info("Target date: %s (IST)", target.isoformat())

    symbols = _load_registry_symbols()
    LOGGER.info("Registry symbols: %s", symbols)

    df = _fetch_bhavcopy(target)
    if df is None or df.empty:
        LOGGER.error(
            "Failed to fetch MCX bhavcopy for %s via both CSV and JSON endpoints. "
            "MCX likely blocks scripted scrapers (Cloudflare + session cookies). "
            "Next steps: check endpoint by hand, consider a proxy, or implement a "
            "different free source. Exiting non-zero so CI surfaces the blocker.",
            target.isoformat(),
        )
        return 1

    wrote_any = False
    for symbol in symbols:
        aliases = SYMBOL_ALIASES.get(symbol, (symbol,))
        row = _extract_row(df, aliases)
        if row is None:
            LOGGER.warning("No bhavcopy row for %s (aliases=%s)", symbol, aliases)
            continue
        LOGGER.info(
            "%s: O=%.2f H=%.2f L=%.2f C=%.2f V=%.0f (alias=%s)",
            symbol,
            row.open_,
            row.high,
            row.low,
            row.close,
            row.volume,
            row.symbol,
        )
        if args.dry_run:
            continue
        path = PRICES_DIR / f"{symbol}.json"
        series = _load_series(path, symbol)
        if _append_row(series, target, row):
            _write_series(path, series)
            wrote_any = True

    if args.dry_run:
        LOGGER.info("Dry run complete; no files written.")
        return 0

    LOGGER.info("Ingest complete. Wrote updates: %s", wrote_any)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
