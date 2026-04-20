# CLAUDE.md — Backtest Lab

## Project Overview

Block-based strategy tester + goal-driven portfolio builder for Indian equities (NSE) and MCX commodities. Static Next.js app on Cloudflare Pages; all compute client-side; no server runtime in v1. Spun out from Quantamental on 2026-04-20.

## Architecture

See `docs/ARCHITECTURE.md` for full detail. Short version: `src/app/` is the shell, `src/components/` is UI, `src/lib/india|mcx|portfolio/` is math, `public/india/` is static data, `scripts/` is Python ingestion run from GitHub Actions.

## Non-Negotiable Rules

1. **Static export stays static.** `next.config.js` has `output: 'export'`. Never add API routes (`app/api/*`), `getServerSideProps`, or middleware. Why: Cloudflare Pages free tier + zero-ops deploy. Breaking this breaks the business model.

2. **No paid data feeds in the critical path.** MCX bhavcopy, Yahoo Finance, RSS are the only sources. No Bloomberg, Refinitiv, Alpha Vantage paid tier, etc. Why: $0/month infra is core PRD constraint. A single paid dep forces us to charge users before we're ready.

3. **No trade execution. No advisory.** Never integrate with a broker API to place orders. Never generate per-user "buy this now" recommendations. Why: SEBI broker license + SEBI investment advisor license. Either would take >6 months and lawyers.

4. **Rupee-native, lot-aware.** All monetary values in INR. All position sizing respects F&O lot sizes (NSE) and MCX contract sizes. Why: this is India-market product; showing $ or fractional lots immediately outs us as not-for-India.

5. **No ML models, no LLM outputs treated as signals.** Strategies are rule-based blocks. Indicators are math formulas. Why: PRD explicitly excludes AI prediction; complicates the "not advisory" stance; Quantamental is where ML lives.

6. **localStorage is the v1 persistence layer.** Schema-versioned under key `backtestlab:portfolios:v1`. No Supabase, no accounts, no cross-device sync until Sprint 3+. Why: ships faster, no auth complexity, no GDPR/DPDP headaches on day 1.

7. **Static-first data contract.** All data the UI reads lives in `public/india/*.json`. Scripts write it; UI reads it. Never fetch from a third party at runtime from the browser (CORS + rate limits + fragility). Why: predictable, offline-capable after first load, trivial to cache.

8. **Per-commit budget: type-check + build passes.** `npx tsc --noEmit` and `npm run build` must succeed on every commit to master. Why: CI is slow; broken master blocks deploys; static export fails loudly when a path breaks.

9. **Disclaimer on every user-facing output.** Any page that shows backtest results, portfolio metrics, or strategy output must include "Educational purposes only, not investment advice." Why: legal cover for the "not advisory" stance. Omitting this is a compliance risk.

## Coding Conventions

- **TypeScript strict mode.** `any` is a last resort and always commented with a reason.
- **Functional React.** Hooks only. No class components. `useMemo` for anything that runs on every render and isn't O(1).
- **File naming.** Components PascalCase (`NiftyTab.tsx`), modules kebab-case (`backtest-engine.ts`), tests colocated (`.test.ts`).
- **Path imports:** `@/lib/...`, `@/components/...` via tsconfig path alias. Relative imports only within the same directory.
- **No console.log in committed code.** Use `// DEBUG:` comments during dev; remove before commit.
- **Python scripts:** PEP 8, type hints on function signatures, `pathlib.Path` for paths, `logging` not `print()`.

## Critical Files

Read these before modifying their area:

- `src/lib/india/backtest-engine.ts` — backtest core. Changes here affect every single result.
- `src/lib/india/types.ts` — shared type defs. Adding a field here ripples everywhere.
- `src/lib/india/registry.ts` — stock registry loader. MCX registry follows the same pattern.
- `next.config.js` — static export config. Do not remove `output: 'export'`.
- `docs/PRD.md` — scope guard. Before adding a feature, check the "IS NOT" list.

## Safety Rules

- **Never commit secrets.** No `.env.local` in git. The app has no backend secrets in v1; if that changes, use GitHub Actions secrets, not committed files.
- **Never rewrite master history.** No force push, no `git reset --hard` against origin. The auto-deploy watches master; a history rewrite breaks Pages' deployment cache.
- **Price-data commits are fine.** `public/india/prices/*.json` regeneration commits from GitHub Actions are expected traffic. They are large but diffable; don't squash them.
- **Before removing a commodity/stock from the registry:** grep for the ticker across `public/india/prices/`, `scripts/`, and test files. Orphaned price files waste 200KB each and confuse users.

## Common Mistakes to Avoid

- **Forgetting to regenerate `out/` before deploy.** The CF Pages build runs `npm run build` on its side, but if you're deploying via `wrangler pages deploy out`, you must build locally first. Missing this ships the last commit's build, not your current code.
- **Hard-coded `/india/prices/` paths in components.** Data paths are constants in `src/lib/india/data.ts`. Adding a new data URL inline breaks when the directory structure shifts.
- **Inlining portfolio math into a component.** Portfolio metrics live in `src/lib/portfolio/metrics.ts`. Components render them, never compute them. Mixing them means the math isn't re-usable and isn't testable.
- **Using `lot_size` without a unit.** `lot_size` on NSE stocks = shares per F&O lot. On MCX it's contracts per lot. Contract notional is `lot_size × contract_size × price`. Confusing these produces 10x-wrong PnL.
- **Assuming MCX and NSE share the same calendar.** MCX trades on Saturdays some months; NSE doesn't. Aligning calendars wrongly creates spurious NaN gaps in portfolio metrics.
