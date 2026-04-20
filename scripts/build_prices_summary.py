"""Build a lightweight prices summary for the universe picker UI.

Reads every OHLCV JSON under ``public/india/prices/*.json`` (NSE) and
``public/india/prices/mcx/*.json`` (MCX) and emits a single
``public/india/prices-summary.json`` with the latest close + 1-year
return per ticker.

The card grids (StockGrid, CommodityGrid) show these values so users see
a live price alongside the ticker without fetching the full per-ticker
OHLCV series just to render a number.

Schema
------
    {
      "generated_at": "2026-04-20",
      "stocks": {
        "RELIANCE": {"close": 2851.4, "yr1_pct": 0.142, "date": "2026-04-17"},
        ...
      },
      "mcx": {
        "GOLD": {"close": 154609.0, "yr1_pct": 0.085, "date": "2026-04-17"},
        ...
      }
    }

Stdlib only.
"""

from __future__ import annotations

import json
import logging
from datetime import date
from pathlib import Path

logger = logging.getLogger("build_prices_summary")

REPO_ROOT = Path(__file__).resolve().parents[1]
PRICES_DIR = REPO_ROOT / "public" / "india" / "prices"
MCX_DIR = PRICES_DIR / "mcx"
OUTPUT_PATH = REPO_ROOT / "public" / "india" / "prices-summary.json"

DAYS_YEAR = 252


def _summarize_series(path: Path) -> dict | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        logger.warning("skip %s: %s", path.name, exc)
        return None

    closes = data.get("close") or []
    dates = data.get("dates") or []
    if not closes or not dates or len(closes) != len(dates):
        return None

    # Walk from the tail to find the last positive close.
    last_close = None
    last_date = None
    for i in range(len(closes) - 1, -1, -1):
        c = closes[i]
        try:
            cf = float(c)
        except (TypeError, ValueError):
            continue
        if cf > 0:
            last_close = cf
            last_date = dates[i]
            break

    if last_close is None:
        return None

    # 1-year return: close at t - 252 vs today. Use nearest non-null.
    yr1_pct = None
    target_idx = len(closes) - 1 - DAYS_YEAR
    if target_idx >= 0:
        for j in range(target_idx, -1, -1):
            try:
                cj = float(closes[j])
            except (TypeError, ValueError):
                continue
            if cj > 0:
                yr1_pct = last_close / cj - 1.0
                break

    return {
        "close": round(last_close, 4),
        "yr1_pct": round(yr1_pct, 4) if yr1_pct is not None else None,
        "date": str(last_date),
    }


def build_summary(
    prices_dir: Path = PRICES_DIR,
    mcx_dir: Path = MCX_DIR,
    output_path: Path = OUTPUT_PATH,
) -> dict:
    stocks: dict[str, dict] = {}
    for p in sorted(prices_dir.glob("*.json")):
        summary = _summarize_series(p)
        if summary is not None:
            stocks[p.stem] = summary

    mcx: dict[str, dict] = {}
    if mcx_dir.exists():
        for p in sorted(mcx_dir.glob("*.json")):
            summary = _summarize_series(p)
            if summary is not None:
                mcx[p.stem] = summary

    result = {
        "generated_at": date.today().isoformat(),
        "stocks": stocks,
        "mcx": mcx,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(result, separators=(",", ":")) + "\n", encoding="utf-8")
    logger.info(
        "wrote %d NSE + %d MCX tickers to %s",
        len(stocks),
        len(mcx),
        output_path,
    )
    return result


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    build_summary()


if __name__ == "__main__":
    main()
