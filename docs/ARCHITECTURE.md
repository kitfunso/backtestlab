# Backtest Lab — Architecture

## System Overview

```
┌──────────────────────────────────────────────────────────────┐
│                    Browser (client-side)                     │
│                                                              │
│   Next.js app (static export)                                │
│   ├── Strategy builder UI  (block drag-and-drop)             │
│   ├── Backtest engine       (TypeScript, runs in browser)    │
│   ├── Portfolio builder     (optimizer, metrics, DCA sim)    │
│   └── localStorage          (saved portfolios, v1)           │
│                                                              │
└───────────────────┬────────────────────┬─────────────────────┘
                    │                    │
              ┌─────▼─────┐        ┌─────▼─────────┐
              │ CF Pages  │        │  Worker (cron)│
              │ (static)  │        │  news + MCX   │
              └─────┬─────┘        └─────┬─────────┘
                    │                    │
        ┌───────────▼────────┐  ┌────────▼──────────────┐
        │ /public/india/     │  │  External sources     │
        │ ├── registry.json  │  │  ├── MCX bhavcopy CSV │
        │ ├── prices/        │  │  ├── Yahoo Finance    │
        │ │   ├── nse/       │  │  ├── ET / ToI RSS     │
        │ │   └── mcx/       │  │  └── Google News RSS  │
        │ └── news/           │  │                       │
        └────────────────────┘  └───────────────────────┘
```

All compute is client-side. All data is static JSON served from Cloudflare Pages. A GitHub Actions cron refreshes prices and news into the repo on schedule.

## Tech Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| UI framework | Next.js 14 (App Router), React 18 | Matches Quantamental; static export supported; familiar |
| Language | TypeScript (strict) | Strong typing for the backtest engine; catches math bugs |
| Styling | Tailwind CSS | No custom design system needed; utility-first ships fast |
| Charts | Recharts | Already in use; good enough; SSR-safe |
| Drag-and-drop | @hello-pangea/dnd | Maintained fork of react-beautiful-dnd |
| Hosting | Cloudflare Pages (static export) | Free tier; global CDN; git-push deploy |
| Data ingestion | Python 3.12 in `scripts/` + GitHub Actions | Same pattern as Quantamental; simple cron; commits static JSON to repo |
| Persistence (v1) | Browser localStorage | No auth needed; ships fastest; fine for single-device use |
| Persistence (v2+) | Supabase (Postgres + Auth) | Introduced when alerts require accounts (Sprint 3+) |
| Email (v2+) | Resend | Free tier covers 3K/mo; required for rebalance alerts |

## Repository Structure

```
backtestlab/
├── src/
│   ├── app/                       # Next.js App Router (layout + pages)
│   │   ├── layout.tsx              # root HTML shell
│   │   ├── page.tsx                # single-page app entry
│   │   └── globals.css             # Tailwind base styles
│   ├── components/
│   │   ├── india/                  # equity-market components (legacy Nifty name)
│   │   ├── mcx/                    # commodity-market components (new, Sprint 1)
│   │   └── portfolio/              # portfolio UI: metrics, DCA, save/load (Sprint 1+)
│   └── lib/
│       ├── india/                  # NSE strategy engine (existing)
│       │   ├── backtest-engine.ts  # core backtest loop
│       │   ├── indicators.ts       # SMA, RSI, MACD, etc.
│       │   ├── optimizer.ts        # portfolio optimizer
│       │   ├── registry.ts         # stock registry loader
│       │   └── types.ts            # shared type defs
│       ├── mcx/                    # MCX commodity module (new, Sprint 1)
│       │   ├── registry.ts         # commodity metadata (lot, tick, BBG ticker)
│       │   └── types.ts            # MCXCommodity type
│       ├── portfolio/              # portfolio-level logic (new, Sprint 1)
│       │   ├── metrics.ts          # rolling Sharpe/vol, drawdowns, distribution
│       │   ├── diversification.ts  # diversification ratio
│       │   └── dca.ts              # lump-sum vs DCA entry simulation
│       └── utils.ts                # cn, downloadCSV
├── public/
│   └── india/                     # all static market data (historical naming)
│       ├── registry.json           # NSE stock registry
│       ├── mcx-registry.json       # MCX commodity registry (Sprint 1)
│       ├── prices/
│       │   ├── {TICKER}.json       # NSE per-ticker OHLCV
│       │   └── mcx/
│       │       └── {SYMBOL}.json   # MCX per-commodity OHLCV (Sprint 1)
│       └── news/
│           └── feed.json           # aggregated RSS items, tagged (Sprint 2)
├── scripts/                        # Python data-ingestion scripts (Sprint 1+)
│   ├── ingest_mcx.py               # pulls MCX bhavcopy → commits JSON
│   ├── refresh_nse_prices.py       # pulls Yahoo Finance → commits JSON
│   └── aggregate_news.py           # pulls RSS feeds → commits news/feed.json
├── .github/
│   └── workflows/
│       ├── deploy.yml              # Cloudflare Pages build on master push
│       ├── ingest-mcx.yml          # daily MCX bhavcopy refresh (Sprint 1)
│       ├── refresh-nse.yml         # weekly NSE price refresh (Sprint 1)
│       └── news.yml                # 15-min RSS refresh (Sprint 2)
├── docs/
│   ├── PRD.md                      # product requirements (scope guard)
│   ├── ARCHITECTURE.md             # this file
│   └── plans/
│       └── YYYY-MM-DD-{name}.md    # phase-by-phase execution plans
├── CLAUDE.md                       # AI session rules (non-negotiables)
├── README.md                       # user-facing readme
├── package.json
├── tsconfig.json
├── next.config.js                  # Next.js config (static export)
├── tailwind.config.ts
├── postcss.config.js
└── .gitignore
```

## Data Model

**No relational database in v1.** All runtime state is either static JSON served from CDN, or browser localStorage.

### Static JSON files

**`public/india/registry.json`** — NSE stock registry (existing)
```typescript
{
  stocks: Array<{
    ticker: string;     // "RELIANCE"
    yf: string;         // "RELIANCE.NS" (Yahoo Finance ticker)
    name: string;       // "Reliance Industries Ltd."
    lot_size: number;   // F&O lot size
    sector: GICSSector;
  }>;
}
```

**`public/india/mcx-registry.json`** — MCX commodity registry (Sprint 1, new)
```typescript
{
  commodities: Array<{
    symbol: string;         // "GOLD"
    mcx_ticker: string;     // "MCXGOLD"
    bbg_ticker: string;     // "MCXGOLD Comdty"
    name: string;           // "MCX Gold"
    kind: 'single' | 'index';
    contract_size: string;  // "1 kg"
    tick_size: number;      // INR per tick
    lot_size: number;       // contracts per lot
  }>;
}
```

**`public/india/prices/{ticker}.json`** — per-instrument OHLCV (existing shape, extended for MCX)
```typescript
{
  ticker: string;
  dates: string[];        // "YYYY-MM-DD"
  open: number[];
  high: number[];
  low: number[];
  close: number[];
  volume: number[];
}
```

**`public/india/news/feed.json`** — aggregated news (Sprint 2, new)
```typescript
{
  generated_at: string;   // ISO timestamp
  items: Array<{
    id: string;           // hash of (source, url, title)
    source: string;       // "ET" | "ToI" | "BT-SG" | "google-news"
    title: string;
    url: string;
    published_at: string;
    tags: string[];       // tickers / sectors matched in title
  }>;
}
```

### localStorage schema (v1)

```typescript
type SavedPortfolio = {
  id: string;              // uuid
  name: string;            // user-supplied, e.g. "Balanced Growth"
  created_at: string;
  tickers: string[];       // ["RELIANCE", "TCS", "MCXGOLD"]
  strategy_blocks: PipelineBlock[];  // serialized block pipeline
  entry_mode: 'lump_sum' | 'dca';
  entry_amount: number;    // INR
  dca_frequency?: 'weekly' | 'monthly';
  alert_thresholds?: {
    max_drawdown_pct: number;    // e.g. 15
    equity_variance_pct: number; // e.g. 20
  };
};

// Stored at key: `backtestlab:portfolios:v1`
// Schema versioning via the `:v1` suffix; migrate on read if schema evolves.
```

## API Design

**v1 has no custom APIs.** All data access is via `fetch()` against static JSON paths served by Cloudflare Pages:

| Path | Purpose | Consumer |
|------|---------|----------|
| `GET /india/registry.json` | NSE stock registry | Strategy builder |
| `GET /india/mcx-registry.json` | MCX commodity registry | Strategy builder (Sprint 1) |
| `GET /india/prices/{ticker}.json` | OHLCV for one ticker | Backtest engine |
| `GET /india/news/feed.json` | Aggregated news items | News sidebar (Sprint 2) |

**Auth model:** none in v1. Everything is public, anonymous, static.

**v2 (Sprint 3+) adds Supabase:** REST + Realtime endpoints under the Supabase-managed domain; row-level security scopes each user to their own rows. Design deferred to the Sprint 3 plan doc.

## Service Boundaries

- **`src/lib/india/*`** — NSE equity strategy engine. Owns: indicators, backtest loop, optimizer. Must NOT import from `mcx/` or `portfolio/` (it's the foundation).
- **`src/lib/mcx/*`** — MCX commodity metadata + type defs. Reuses backtest engine from `india/` by passing in commodity-specific configs. Does NOT duplicate the engine.
- **`src/lib/portfolio/*`** — portfolio-level aggregation (metrics, DCA, diversification). Consumes per-instrument backtest results; produces portfolio-level metrics. Does not re-implement strategy logic.
- **`src/components/*`** — UI only. Reads from `src/lib/*`. Never contains backtest math.
- **`scripts/*`** — Python data ingestion. Runs in GitHub Actions. Writes to `public/india/*`. Never runs in the browser. Never imports from `src/`.

**Dependency direction:** `components` → `lib` → `public` data. `scripts` → `public` data (write). No cycles, no skipping layers.

## Data Flow — primary use case

User journey: "Pick a stock, run a strategy, save it as a portfolio"

```
1. User lands on /
   → Next.js serves /index.html from CF Pages (static)
   → Browser fetches /india/registry.json → populates sector tree

2. User clicks RELIANCE
   → Browser fetches /india/prices/RELIANCE.json → cached in memory

3. User drops SMA(20) + RSI(14) + CROSSES_ABOVE blocks
   → blocksToStrategyConfig() compiles blocks → StrategyConfig object

4. User clicks "Backtest"
   → runBacktest(priceData, strategyConfig) runs in browser
   → Returns BacktestResult { equityCurve, trades, metrics }
   → UI renders chart + stats (< 500ms)

5. User adds to portfolio, selects DCA ₹25K/month
   → computePortfolioMetrics(perStockResults, { mode: 'dca', amount: 25000 })
   → Renders rolling Sharpe, drawdown table, distribution

6. User saves as "Growth 3Y"
   → localStorage['backtestlab:portfolios:v1'].push(portfolio)
   → Toast confirms; portfolio is re-loadable on next visit
```

No network calls after initial data fetches. Full interactivity offline after first load.
