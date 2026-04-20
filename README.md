# Backtest Lab

Block-based strategy tester and portfolio builder for Indian equities (NSE) and MCX commodities. Live at **[backtestlab.pages.dev](https://backtestlab.pages.dev)**.

Visual lego-style builder: chain indicators → triggers → actions into a strategy, backtest across 204 NSE F&O stocks plus 6 liquid MCX commodities, compose a portfolio with extended metrics (rolling Sharpe, top drawdowns, Sortino/Calmar, diversification ratio). Rupee-denominated, F&O lot-aware.

## Stack

- Next.js 14 (App Router) + React 18 + TypeScript — static export on Cloudflare Pages
- Tailwind CSS + Recharts
- Python 3.12 for offline data ingestion (`scripts/`)
- Jest + ts-jest for the metrics test suite

## Getting started

```bash
npm install
npm run dev      # http://localhost:3000
npm test         # run unit tests (30 tests in src/lib/portfolio/)
npm run build    # static export → out/
```

## What you can do

- **Strategy tester** — pick an NSE stock or MCX commodity, compose an indicator/trigger/action pipeline, backtest over ~1 year of history.
- **Portfolio builder** — pick up to 12 instruments, run an optimizer (equal-weight, risk-parity, min-variance, max-Sharpe, max-diversification), see portfolio-level metrics: rolling Sharpe/vol, top-5 drawdowns, return distribution, Sortino, Calmar, diversification ratio.
- **Goal-based wizard** — pick a goal (growth / balanced / defensive / contrarian / value), horizon, size. Wizard ranks all 204 NSE names on 11 factors (6 price: momentum 12-1 / 6-1, short reversal, volatility, downside beta, dispersion; 5 fundamental: P/E, P/B, ROE, revenue growth, debt/equity from yfinance) and picks the top-N with a 3-per-sector cap. Each pick tile shows its top-2 factor drivers.
- **DCA vs lump-sum** — side-by-side simulation of lump-sum entry against weekly/monthly dollar-cost averaging on the portfolio's historical equity curve.
- **Saved portfolios** — name a portfolio, reopen it later. Stored in browser localStorage (20-slot cap); cross-device sync arrives with accounts in Sprint 3.
- **News feed** — stock-tagged headlines from ET Markets, Moneycontrol, and Google News. 10-minute GitHub Actions refresh during IST market hours; client re-polls every 10 min.
- **MCX commodities** — Gold, Silver, Copper, Crude, MCX iCOMDEX Bullion, MCX iCOMDEX Base Metal. Real rupee-denominated OHLCV from MCX bhavcopy via [mcxpy](https://pypi.org/project/mcxpy/): singles back to 2017-09 (~2,200 days), indices back to their 2020 launch. Daily refresh via GitHub Actions.
- **Transaction costs** — exchange-published fee schedule (brokerage, exchange turnover, STT/CTT, stamp duty, GST) plus a size-dependent slippage curve. Costs are charged only when position changes (entry, exit, direction flip, resize) — not on passive holds.

## Structure

```
src/
├── app/                       # Next.js app router (layout, root page)
├── components/
│   ├── india/                 # NSE UI (NiftyTab, StrategyBuilder, NewsPanel)
│   ├── mcx/                   # MCX commodity selector + grid
│   └── portfolio/             # PortfolioMetricsPanel, GoalWizard, SavedPortfoliosPanel
└── lib/
    ├── india/                 # NSE strategy engine: indicators, backtest, optimizer, registry
    ├── mcx/                   # MCX commodity registry + types
    ├── factors/               # Factor definitions, z-score, presets, composite score
    ├── portfolio/             # Rolling metrics, drawdowns, diversification, storage, TC (tested)
    └── utils.ts               # cn + CSV helpers

public/india/
├── registry.json              # NSE stock metadata
├── mcx-registry.json          # MCX commodity metadata
├── factors.json               # Weekly cross-sectional factor scores (204 tickers x 6 factors)
├── news.json                  # 10-min refreshed stock-tagged RSS aggregation
└── prices/
    ├── {TICKER}.json          # NSE per-ticker OHLCV
    └── mcx/{SYMBOL}.json      # MCX per-commodity OHLCV

scripts/
├── ingest_mcx.py                # daily MCX bhavcopy refresh (runs in GitHub Actions)
├── backfill_mcx_bhavcopy.py     # historical backfill via mcxpy (real INR OHLCV)
├── backfill_mcx.py              # yfinance surrogate fallback (deprecated)
├── build_factors.py             # weekly cross-sectional factor score build
├── fetch_news.py                # RSS aggregation (ET, Moneycontrol, Google News)
└── requirements.txt

docs/
├── PRD.md                     # scope guard ("IS NOT" list)
├── ARCHITECTURE.md            # tech stack, folder layout, data model
└── plans/                     # per-sprint execution plans
```

## Docs

- **[PRD](docs/PRD.md)** — what the product is and explicitly is not
- **[Architecture](docs/ARCHITECTURE.md)** — folder layout, data flow, service boundaries
- **[CLAUDE.md](CLAUDE.md)** — non-negotiable rules for AI sessions working on this repo
- **[Sprint 1 plan](docs/plans/2026-04-20-sprint-1.md)** — what shipped in v0.2.x (MCX commodities + portfolio metrics + real bhavcopy data + transaction-cost model)
- **[Sprint 2 plan](docs/plans/2026-04-21-sprint-2.md)** — what shipped in v0.3.0 (multi-factor library + goal wizard + news feed + saved portfolios)
- **[Sprint 3a plan](docs/plans/2026-04-21-sprint-3a.md)** — what shipped in v0.3.1 (fundamental factors + value preset + DCA simulator + disclaimer audit)

## Compliance

For educational purposes only — not investment advice. Past performance does not predict future results. Backtest Lab is a research tool; it does not place trades, manage funds, or provide SEBI-registered advisory services.

## Provenance

Extracted from the [Quantamental](https://github.com/kitfunso/quantamental) monorepo on 2026-04-20 via `git filter-repo` (preserved history). Built as a standalone product for Indian retail/prosumer quants.
