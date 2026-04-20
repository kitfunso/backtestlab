"""RSS news aggregator for Backtest Lab (India).

Pulls free RSS feeds from ET Markets, Moneycontrol Markets, and Google News
(per-ticker fan-out), tags each item with the NSE tickers it mentions, and
writes the merged output to ``public/india/news.json``.

Design notes
------------
- **Free RSS only.** No paid APIs, no keys. Every source is public RSS.
- **Per-source dedupe & cap.** Items are deduped by URL within a source and
  the most recent 200 per source are kept; this bounds the output size.
- **Ticker tagging.** Each item is tagged with a ticker if its ticker symbol
  (exact word-boundary, case-insensitive) OR any meaningful token of the
  company name appears in the item title/summary. Generic filler words
  ("limited", "ltd", "india", ...) are stripped from the name first.
- **Graceful degradation.** If ET or Moneycontrol is down, we log a warning
  and continue — the feed panel is still useful with Google News alone.
- **Rate limiting.** Google News fan-out across ~204 tickers gets a 0.3s
  sleep between requests to stay well under any reasonable RSS rate limit.

Usage
-----
    python scripts/fetch_news.py                 # full run
    python scripts/fetch_news.py --dry-run       # fetch, skip write
    python scripts/fetch_news.py --limit 20      # limit Google News fan-out
"""

from __future__ import annotations

import argparse
import json
import logging
import re
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable
from urllib.parse import quote_plus

import feedparser
import requests

LOGGER = logging.getLogger("fetch_news")

REPO_ROOT = Path(__file__).resolve().parent.parent
REGISTRY_PATH = REPO_ROOT / "public" / "india" / "registry.json"
OUT_PATH = REPO_ROOT / "public" / "india" / "news.json"

ET_URL = "https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms"
MC_URL = "https://www.moneycontrol.com/rss/marketreports.xml"
GOOGLE_NEWS_TEMPLATE = (
    "https://news.google.com/rss/search?q={query}+NSE&hl=en-IN&gl=IN&ceid=IN:en"
)

HTTP_TIMEOUT = 10
GOOGLE_SLEEP_SEC = 0.3
MAX_ITEMS_PER_SOURCE = 200
REQUEST_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; BacktestLab/1.0; +https://backtestlab.pages.dev)"
    ),
}

# Words stripped from company names before building the tag-match vocabulary.
NAME_STOPWORDS = frozenset(
    {
        "limited",
        "ltd",
        "ltd.",
        "india",
        "indian",
        "company",
        "co",
        "corp",
        "corporation",
        "the",
        "and",
        "of",
        "for",
        "inc",
        "plc",
        "pvt",
        "private",
        "public",
        "group",
        "holdings",
        "enterprises",
        "industries",
        "services",
        "solutions",
        "technologies",
        "systems",
        "international",
        "global",
        "bank",
        "finance",
        "financial",
    }
)


@dataclass
class Stock:
    ticker: str
    name: str
    # Compiled regexes (ticker + selected name tokens) used for tagging.
    patterns: list[re.Pattern[str]] = field(default_factory=list)


@dataclass
class NewsItem:
    title: str
    url: str
    source: str
    published: str  # ISO8601
    tickers: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "title": self.title,
            "url": self.url,
            "source": self.source,
            "published": self.published,
            "tickers": sorted(set(self.tickers)),
        }


def _parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Do not write output.")
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Cap number of tickers fanned out to Google News (0 = all).",
    )
    return parser.parse_args(argv)


def _load_stocks() -> list[Stock]:
    data = json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))
    stocks: list[Stock] = []
    for entry in data.get("stocks", []):
        ticker = str(entry["ticker"]).strip()
        name = str(entry.get("name", "")).strip()
        patterns = _build_match_patterns(ticker, name)
        stocks.append(Stock(ticker=ticker, name=name, patterns=patterns))
    return stocks


def _build_match_patterns(ticker: str, name: str) -> list[re.Pattern[str]]:
    """Build the word-boundary regex set used to tag a news item with this stock.

    We always match on the exact ticker symbol. We also match on meaningful
    name tokens (length >= 4, not in NAME_STOPWORDS) so a headline about
    'Reliance Industries' tags RELIANCE even when the ticker is absent.
    """
    tokens: list[str] = [ticker]
    for raw in re.split(r"[^A-Za-z0-9]+", name):
        cleaned = raw.strip().lower()
        if len(cleaned) < 4:
            continue
        if cleaned in NAME_STOPWORDS:
            continue
        tokens.append(raw.strip())

    seen: set[str] = set()
    patterns: list[re.Pattern[str]] = []
    for token in tokens:
        key = token.lower()
        if key in seen:
            continue
        seen.add(key)
        patterns.append(re.compile(rf"\b{re.escape(token)}\b", re.IGNORECASE))
    return patterns


def _normalize_published(entry) -> str:
    """Best-effort conversion of an RSS entry's published date to ISO8601 UTC."""
    struct = getattr(entry, "published_parsed", None) or getattr(
        entry, "updated_parsed", None
    )
    if struct is not None:
        try:
            dt = datetime(*struct[:6], tzinfo=timezone.utc)
            return dt.strftime("%Y-%m-%dT%H:%M:%SZ")
        except (TypeError, ValueError):
            pass
    # Fall back to now — better a stale-looking timestamp than an empty one.
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _clean_title(raw: str) -> str:
    return re.sub(r"\s+", " ", raw or "").strip()


def _fetch_feed(url: str, source: str) -> list[NewsItem]:
    """Fetch an RSS feed and return parsed items. Returns [] on network error."""
    try:
        response = requests.get(url, headers=REQUEST_HEADERS, timeout=HTTP_TIMEOUT)
        response.raise_for_status()
    except requests.RequestException as exc:
        LOGGER.warning("%s: HTTP error, skipping (%s)", source, exc)
        return []

    parsed = feedparser.parse(response.content)
    if parsed.bozo and not parsed.entries:
        LOGGER.warning("%s: feed parse failed (%s)", source, parsed.bozo_exception)
        return []

    items: list[NewsItem] = []
    for entry in parsed.entries:
        title = _clean_title(getattr(entry, "title", ""))
        link = getattr(entry, "link", "").strip()
        if not title or not link:
            continue
        items.append(
            NewsItem(
                title=title,
                url=link,
                source=source,
                published=_normalize_published(entry),
            )
        )
    return items


def _dedupe_and_cap(items: Iterable[NewsItem], cap: int) -> list[NewsItem]:
    """Dedupe by URL, keep newest-first, cap to N. Stable for same-timestamp items."""
    by_url: dict[str, NewsItem] = {}
    for item in items:
        # Later occurrences of the same URL overwrite — but they're the same story.
        by_url.setdefault(item.url, item)
    sorted_items = sorted(by_url.values(), key=lambda i: i.published, reverse=True)
    return sorted_items[:cap]


def _tag_item(item: NewsItem, stocks: list[Stock], haystack_by_stock: str) -> None:
    """Attach ticker tags based on title text. (Summary not always present.)"""
    for stock in stocks:
        for pattern in stock.patterns:
            if pattern.search(haystack_by_stock):
                item.tickers.append(stock.ticker)
                break


def _tag_items(items: list[NewsItem], stocks: list[Stock]) -> None:
    for item in items:
        _tag_item(item, stocks, item.title)


def _fetch_google_news_per_stock(
    stocks: list[Stock], limit: int
) -> list[NewsItem]:
    """Fan out to Google News RSS, one query per stock, with rate limiting."""
    collected: list[NewsItem] = []
    targets = stocks if limit <= 0 else stocks[:limit]
    for i, stock in enumerate(targets):
        query = quote_plus(stock.ticker)
        url = GOOGLE_NEWS_TEMPLATE.format(query=query)
        items = _fetch_feed(url, "Google News")
        # Pre-tag: every Google News item for this stock's query is about that stock.
        for item in items:
            item.tickers.append(stock.ticker)
        collected.extend(items)
        if (i + 1) % 25 == 0:
            LOGGER.info(
                "Google News fan-out progress: %d/%d (items so far: %d)",
                i + 1,
                len(targets),
                len(collected),
            )
        time.sleep(GOOGLE_SLEEP_SEC)
    return collected


def _merge_all(
    et_items: list[NewsItem],
    mc_items: list[NewsItem],
    google_items: list[NewsItem],
) -> list[NewsItem]:
    """Dedupe within each source, then merge and dedupe across sources by URL."""
    et_capped = _dedupe_and_cap(et_items, MAX_ITEMS_PER_SOURCE)
    mc_capped = _dedupe_and_cap(mc_items, MAX_ITEMS_PER_SOURCE)
    google_capped = _dedupe_and_cap(google_items, MAX_ITEMS_PER_SOURCE)

    # Cross-source merge: same URL may appear twice (rare) — keep first.
    cross: dict[str, NewsItem] = {}
    for item in (*et_capped, *mc_capped, *google_capped):
        existing = cross.get(item.url)
        if existing is None:
            cross[item.url] = item
        else:
            # Merge tickers if duplicate URL across sources.
            existing.tickers = sorted(set(existing.tickers + item.tickers))
    merged = sorted(cross.values(), key=lambda i: i.published, reverse=True)
    LOGGER.info(
        "Merged counts — ET: %d, Moneycontrol: %d, Google: %d, unique: %d",
        len(et_capped),
        len(mc_capped),
        len(google_capped),
        len(merged),
    )
    return merged


def _write_output(items: list[NewsItem]) -> None:
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "items": [item.to_dict() for item in items],
    }
    OUT_PATH.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    args = _parse_args(argv or sys.argv[1:])

    stocks = _load_stocks()
    LOGGER.info("Loaded %d stocks from registry.", len(stocks))

    LOGGER.info("Fetching ET Markets...")
    et_items = _fetch_feed(ET_URL, "ET Markets")
    _tag_items(et_items, stocks)

    LOGGER.info("Fetching Moneycontrol Markets...")
    mc_items = _fetch_feed(MC_URL, "Moneycontrol")
    _tag_items(mc_items, stocks)

    LOGGER.info(
        "Fetching Google News (per-ticker fan-out, %d stocks, ~%.1fs expected)...",
        len(stocks),
        len(stocks) * GOOGLE_SLEEP_SEC,
    )
    google_items = _fetch_google_news_per_stock(stocks, args.limit)

    merged = _merge_all(et_items, mc_items, google_items)

    if len(merged) < 20:
        LOGGER.error(
            "Only %d items collected — refusing to overwrite news.json. "
            "Check network / source availability.",
            len(merged),
        )
        return 1

    tagged_stocks = {ticker for item in merged for ticker in item.tickers}
    LOGGER.info(
        "Stocks with >=1 tagged item: %d / %d", len(tagged_stocks), len(stocks)
    )

    if args.dry_run:
        LOGGER.info("[dry-run] Would write %d items to %s", len(merged), OUT_PATH)
        return 0

    _write_output(merged)
    LOGGER.info("Wrote %d items to %s", len(merged), OUT_PATH)
    return 0


if __name__ == "__main__":
    sys.exit(main())
