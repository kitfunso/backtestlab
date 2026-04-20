# Backtest Lab

Block-based strategy tester and portfolio optimizer for NSE-listed Indian equities.

Visual lego-style builder: chain indicators → triggers → actions into a strategy, backtest across a GICS sector universe, optimize a portfolio. Rupee-denominated, F&O lot-aware.

## Stack

- Next.js 14 (App Router) + React 18 + TypeScript
- Tailwind CSS
- Recharts

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Structure

```
src/
├── app/                  # Next.js app router (layout, root page)
├── components/india/     # React UI (NiftyTab, StrategyBuilder, ResultsPanel)
└── lib/
    ├── india/            # Strategy engine: indicators, backtest, optimizer, registry
    └── utils.ts          # cn + CSV helpers

public/india/
├── registry.json         # Stock metadata (ticker, sector, lot size)
└── prices/               # Per-ticker OHLCV price history (JSON)
```

## Provenance

Extracted from the [Quantamental](https://github.com/kitfunso/quantamental) monorepo
on 2026-04-20. Full commit history preserved via `git filter-repo`.
