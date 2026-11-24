from __future__ import annotations

import json
import logging
import math
import statistics
import time
from datetime import date
from pathlib import Path
from typing import Iterable

logger = logging.getLogger("build_factors")

DAYS_YEAR = 252
SKIP_DAYS = 21
REVERSAL_DAYS = 5
DISPERSION_DAYS = 21
MOM6_DAYS = 126

REPO_ROOT = Path(__file__).resolve().parents[1]
PRICES_DIR = REPO_ROOT / "public" / "india" / "prices"
OUTPUT_PATH = REPO_ROOT / "public" / "india" / "factors.json"
REGISTRY_PATH = REPO_ROOT / "public" / "india" / "registry.json"

MARKET_PROXY_FILES = ("^NSEI.json", "NIFTY.json")

FUNDAMENTAL_KEYS = {
    "trailingPE": "pe",
    "priceToBook": "pb",
    "returnOnEquity": "roe",
    "revenueGrowth": "rev_growth",
    "debtToEquity": "de",
}
FUNDAMENTAL_SLEEP_SECONDS = 0.2


def _simple_returns(closes: list[float]) -> list[float]:
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
    std = statistics.stdev(returns)
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


def _load_one(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def _iter_price_files(prices_dir: Path) -> Iterable[Path]:
    for path in sorted(prices_dir.glob("*.json")):
        if path.is_file():
            yield path


def _load_universe(prices_dir: Path) -> dict[str, dict]:
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


def _find_market_proxy(prices_dir: Path) -> list[float] | None:
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
    all_dates: set[str] = set()
    for payload in universe.values():
        all_dates.update(str(d) for d in payload["dates"])
    if not all_dates:
        return [], []
    ordered_dates = sorted(all_dates)
    date_to_idx = {d: i for i, d in enumerate(ordered_dates)}
    n = len(ordered_dates)

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


def _align_market_to_stock(
    stock_dates: list[str],
    proxy_dates: list[str],
    proxy_closes: list[float],
) -> list[float] | None:
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


def build_factors(
    prices_dir: Path = PRICES_DIR,
    output_path: Path = OUTPUT_PATH,
) -> dict:
    universe = _load_universe(prices_dir)
    if not universe:
        raise RuntimeError(f"no price files found under {prices_dir}")

    proxy_closes = _find_market_proxy(prices_dir)
    if proxy_closes is not None:
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

    _merge_fundamentals(factors, REGISTRY_PATH)

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


def _load_yf_map(registry_path: Path) -> dict[str, str]:
    data = json.loads(registry_path.read_text(encoding="utf-8"))
    return {s["ticker"]: s.get("yf", f"{s['ticker']}.NS") for s in data["stocks"]}


def _fetch_fundamentals(yf_ticker: str) -> dict[str, float | None]:
    try:
        import yfinance as yf

        info = yf.Ticker(yf_ticker).info
    except Exception as exc:
        logger.warning("yfinance fetch failed for %s: %s", yf_ticker, exc)
        return {k: None for k in FUNDAMENTAL_KEYS.values()}

    out: dict[str, float | None] = {}
    for yf_key, factor_key in FUNDAMENTAL_KEYS.items():
        raw = info.get(yf_key) if isinstance(info, dict) else None
        if raw is None:
            out[factor_key] = None
            continue
        try:
            v = float(raw)
        except (TypeError, ValueError):
            out[factor_key] = None
            continue
        out[factor_key] = v if math.isfinite(v) else None
    return out


def _merge_fundamentals(
    factors: dict[str, dict[str, float | None]],
    registry_path: Path,
) -> None:
    if not registry_path.exists():
        logger.warning("registry missing at %s — skipping fundamentals", registry_path)
        for row in factors.values():
            for k in FUNDAMENTAL_KEYS.values():
                row[k] = None
        return

    yf_map = _load_yf_map(registry_path)
    total = len(factors)
    filled = 0
    for idx, ticker in enumerate(sorted(factors)):
        yf_ticker = yf_map.get(ticker, f"{ticker}.NS")
        funds = _fetch_fundamentals(yf_ticker)
        factors[ticker].update(funds)
        if any(v is not None for v in funds.values()):
            filled += 1
        if (idx + 1) % 20 == 0:
            logger.info("fundamentals: %d/%d tickers fetched", idx + 1, total)
        time.sleep(FUNDAMENTAL_SLEEP_SECONDS)
    logger.info("fundamentals: %d/%d tickers have at least one value", filled, total)


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    build_factors()


if __name__ == "__main__":
    main()
