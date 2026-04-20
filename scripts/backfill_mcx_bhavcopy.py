"""MCX bhavcopy historical backfill using mcxpy.

Iterates business days from --start to --end, calls mcx_bhavcopy for each,
extracts front-month OHLCV for our 6 registry symbols, writes to
``public/india/prices/mcx/{SYMBOL}.json``.

- Front-month = earliest expiry date with a positive Close (liquidity proxy).
- FUTCOM for singles (GOLD / SILVER / COPPER / CRUDEOIL).
- FUTIDX for indices (MCXBULLDEX / MCXMETLDEX).
- Skips weekends silently; non-trading holidays land as None and are skipped.

Usage
-----
    # Full backfill (default: 2018-01-01 to today)
    python scripts/backfill_mcx_bhavcopy.py

    # Custom range
    python scripts/backfill_mcx_bhavcopy.py --start 2020-01-01 --end 2024-12-31

Overwrites any existing JSON under public/india/prices/mcx/ for the 6 symbols.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path

import pandas as pd
from mcxpy import mcx_bhavcopy

LOGGER = logging.getLogger("backfill_mcx_bhavcopy")

REPO_ROOT = Path(__file__).resolve().parent.parent
REGISTRY_PATH = REPO_ROOT / "public" / "india" / "mcx-registry.json"
OUT_DIR = REPO_ROOT / "public" / "india" / "prices" / "mcx"

# Registry symbol -> mcxpy bhavcopy Symbol column value (stripped).
MCXPY_SYMBOL_MAP: dict[str, str] = {
    "GOLD": "GOLD",
    "SILVER": "SILVER",
    "COPPER": "COPPER",
    "CRUDE": "CRUDEOIL",
    "MCXBULLDEX": "MCXBULLDEX",
    "MCXMETLDEX": "MCXMETLDEX",
}

# Registry symbol -> expected mcxpy Instrument Name (stripped).
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
        "--start",
        type=str,
        default="2018-01-01",
        help="Start date (YYYY-MM-DD). Default: 2018-01-01.",
    )
    parser.add_argument(
        "--end",
        type=str,
        default=None,
        help="End date (YYYY-MM-DD). Default: today (IST).",
    )
    parser.add_argument(
        "--symbols",
        type=str,
        default=",".join(MCXPY_SYMBOL_MAP),
        help="Comma-separated registry symbols to backfill.",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=2,
        help="Parallel worker threads. Default: 2. MCX rate-limits aggressively; >3 risks blocks.",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=1.0,
        help="Seconds each worker sleeps between calls. Default: 1.0.",
    )
    parser.add_argument(
        "--retries",
        type=int,
        default=2,
        help="Retry attempts per date on error, with 10s backoff. Default: 2.",
    )
    parser.add_argument(
        "--save-every",
        type=int,
        default=100,
        help="Flush in-progress JSONs to disk every N days (survives crashes). Default: 100.",
    )
    parser.add_argument(
        "--reverse",
        action="store_true",
        help="Iterate from end to start (newest first) \u2014 useful when expecting rate-limit to hit.",
    )
    parser.add_argument(
        "--seed-existing",
        action="store_true",
        help="Preserve existing JSON rows (yfinance surrogate etc). Default: start fresh with mcxpy data only to avoid USD/INR discontinuity.",
    )
    return parser.parse_args(argv)


def _daterange(start: date, end: date):
    cur = start
    one_day = timedelta(days=1)
    while cur <= end:
        # Skip Sat (5), Sun (6)
        if cur.weekday() < 5:
            yield cur
        cur += one_day


def _extract_front_month(
    df: pd.DataFrame, symbol_mcxpy: str, instrument_kind: str
) -> OhlcvRow | None:
    """Return the OHLCV of the earliest-expiry contract with positive close."""
    df = df.copy()
    df["Symbol"] = df["Symbol"].astype(str).str.strip()
    df["Instrument Name"] = df["Instrument Name"].astype(str).str.strip()
    rows = df[(df["Symbol"] == symbol_mcxpy) & (df["Instrument Name"] == instrument_kind)]
    if rows.empty:
        return None

    # Earliest expiry first
    rows = rows.copy()
    rows["Expiry Date"] = pd.to_datetime(rows["Expiry Date"], errors="coerce")
    rows = rows.sort_values("Expiry Date")

    # Prefer row with positive close (traded today), else first row
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


def _write_series(symbol: str, dates: list[str], rows: list[OhlcvRow]) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    payload = {
        "ticker": symbol,
        "dates": dates,
        "open": [r.open for r in rows],
        "high": [r.high for r in rows],
        "low": [r.low for r in rows],
        "close": [r.close for r in rows],
        "volume": [r.volume for r in rows],
    }
    path = OUT_DIR / f"{symbol}.json"
    path.write_text(json.dumps(payload, indent=None, separators=(",", ":")))
    LOGGER.info(
        "%s: wrote %d days (%s -> %s)",
        symbol,
        len(dates),
        dates[0] if dates else "-",
        dates[-1] if dates else "-",
    )


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    args = _parse_args(argv or sys.argv[1:])

    start = datetime.strptime(args.start, "%Y-%m-%d").date()
    end = (
        datetime.strptime(args.end, "%Y-%m-%d").date()
        if args.end
        else date.today()
    )
    requested = [s.strip() for s in args.symbols.split(",") if s.strip()]
    for s in requested:
        if s not in MCXPY_SYMBOL_MAP:
            LOGGER.error("Unknown registry symbol: %s", s)
            return 1

    # Only seed from existing JSON if explicitly requested. Default is to
    # start fresh, because the existing files may contain yfinance surrogate
    # data in USD (COMEX gold GC=F etc), which would create a currency-level
    # discontinuity when merged with real MCX rupee data.
    accum: dict[str, dict[str, OhlcvRow]] = {s: {} for s in requested}
    if args.seed_existing:
        for s in requested:
            path = OUT_DIR / f"{s}.json"
            if path.exists():
                try:
                    existing = json.loads(path.read_text())
                    for i, iso in enumerate(existing.get("dates", [])):
                        accum[s][iso] = OhlcvRow(
                            open=float(existing["open"][i]),
                            high=float(existing["high"][i]),
                            low=float(existing["low"][i]),
                            close=float(existing["close"][i]),
                            volume=float(existing.get("volume", [0] * len(existing["dates"]))[i]),
                        )
                except (json.JSONDecodeError, OSError, KeyError, IndexError, ValueError):
                    pass
            LOGGER.info("%s: seeded with %d existing rows", s, len(accum[s]))
    else:
        LOGGER.info("Starting fresh \u2014 no seed from existing JSON")

    accum_lock = threading.Lock()
    counter = {"total": 0, "with_data": 0, "new": 0, "rate_limited_streak": 0}
    counter_lock = threading.Lock()

    days = list(_daterange(start, end))
    if args.reverse:
        days.reverse()
    LOGGER.info(
        "Backfill range: %s -> %s (%d biz days, %s, workers=%d, delay=%.1fs, reverse=%s)",
        start,
        end,
        len(days),
        ",".join(requested),
        args.workers,
        args.delay,
        args.reverse,
    )

    def fetch_with_retry(d: date) -> pd.DataFrame | None:
        for attempt in range(args.retries + 1):
            try:
                df = mcx_bhavcopy(d.strftime("%d-%m-%Y"))
            except Exception as exc:
                LOGGER.debug("%s attempt %d: mcxpy raised %s", d, attempt, exc)
                df = None
            if df is not None and hasattr(df, "__len__") and len(df) > 0:
                return df
            if attempt < args.retries:
                time.sleep(10)
        return None

    def flush_to_disk() -> None:
        with accum_lock:
            for reg_sym, by_date in accum.items():
                if not by_date:
                    continue
                dates_sorted = sorted(by_date.keys())
                rows = [by_date[d] for d in dates_sorted]
                _write_series(reg_sym, dates_sorted, rows)

    def fetch_one(d: date) -> None:
        df = fetch_with_retry(d)
        time.sleep(args.delay)

        with counter_lock:
            counter["total"] += 1
            if df is not None and hasattr(df, "__len__") and len(df) > 0:
                counter["with_data"] += 1
                counter["rate_limited_streak"] = 0
            else:
                counter["rate_limited_streak"] += 1

            if counter["total"] % args.save_every == 0:
                LOGGER.info(
                    "Progress: %d/%d scanned, %d with data, %d new",
                    counter["total"],
                    len(days),
                    counter["with_data"],
                    counter["new"],
                )

        if df is None or not hasattr(df, "__len__") or len(df) == 0:
            return

        iso = d.strftime("%Y-%m-%d")
        local_rows: dict[str, OhlcvRow] = {}
        for reg_sym in requested:
            mcxpy_sym = MCXPY_SYMBOL_MAP[reg_sym]
            kind = INSTRUMENT_KIND[reg_sym]
            row = _extract_front_month(df, mcxpy_sym, kind)
            if row is not None:
                local_rows[reg_sym] = row

        if local_rows:
            with accum_lock:
                for reg_sym, row in local_rows.items():
                    if iso not in accum[reg_sym]:
                        counter["new"] += 1
                    accum[reg_sym][iso] = row

        # Flush to disk periodically to survive crashes.
        with counter_lock:
            should_flush = counter["total"] % args.save_every == 0
        if should_flush:
            flush_to_disk()

    if args.workers <= 1:
        for d in days:
            fetch_one(d)
    else:
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            futures = [pool.submit(fetch_one, d) for d in days]
            for _ in as_completed(futures):
                pass

    LOGGER.info(
        "Scan complete: %d business days, %d with data, %d new rows.",
        counter["total"],
        counter["with_data"],
        counter["new"],
    )

    flush_to_disk()

    # Summary per symbol
    for reg_sym, by_date in accum.items():
        if by_date:
            dates_sorted = sorted(by_date.keys())
            LOGGER.info(
                "%s: total %d days (%s -> %s)",
                reg_sym,
                len(dates_sorted),
                dates_sorted[0],
                dates_sorted[-1],
            )
        else:
            LOGGER.warning("%s: no data in range", reg_sym)

    return 0


if __name__ == "__main__":
    sys.exit(main())
