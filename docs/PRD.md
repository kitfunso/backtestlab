# Backtest Lab — Product Requirements Document

## One-Line Description

A block-based strategy tester and goal-driven portfolio builder for Indian equity and commodity traders — backtest in minutes, build a portfolio in a wizard, track it for life.

## Problem Statement

Indian retail and prosumer traders have no credible, visually intuitive, systematic-first strategy tester built *for* the Indian market. Existing tools are either institutional (Amibroker, Metastock — expensive, steep learning curve), broker-locked (Zerodha Streak — limited backtest depth), or foreign-market-focused (TradingView, QuantConnect — no MCX, no rupee-native sizing, no F&O lot awareness). Traders cobble together Python notebooks and Excel sheets; accumulators with goals just guess what stocks to buy. The gap: a DIY tool that respects Indian market mechanics (lots, ticks, MCX, GICS sectors) and compresses the research→portfolio→monitor loop to minutes, not weeks.

## Target Users

**Primary — Prosumer traders ("the backbencher persona")**
Active equity/F&O traders with ₹5L–₹1Cr capital, mostly self-taught, already trade with opinions but want a systematic second opinion. Comfortable reading a drawdown chart, skeptical of black-box signals, value transparency. Use the tool to validate and refine their own strategies.

**Secondary — Goal-based accumulators**
DIY investors (₹2L–₹20L capital) with stated goals (growth, income, balance) and horizons (1–10 years). Less technical. Want a wizard to pick stocks *for* them, then track the portfolio over time. Pay more for guidance than for raw tools.

**Tertiary — Indian brokerages and PMS firms (channel partners, not direct users)**
May white-label or embed as a premium feature for their own clients. Sales-led, long cycle. Out of scope for v1.

## Core Features (MVP)

1. **Block-based strategy builder** — drag-and-drop Indicator → Trigger → Action pipeline. Already built; extended across new universes.
2. **NSE equities universe** (204 F&O stocks, GICS-sectored) — already shipped.
3. **MCX commodities universe** — 6 liquid instruments (Gold, Silver, Copper, Crude, MCX iCOMDEX Bullion, MCX iCOMDEX Base Metal). F&O lot-aware.
4. **Backtest engine** — per-stock equity curves, trades, metrics. Rupee-denominated, lot-aware, configurable costs.
5. **Portfolio builder (manual — "Approach 2")** — user picks up to 12 stocks/commodities + a strategy, sees portfolio-level metrics: rolling Sharpe (6m), rolling vol (6m), top-5 drawdowns, return distribution, Sortino, Calmar, diversification ratio.
6. **Portfolio builder (goal-based wizard — "Approach 1")** — user inputs goal + horizon + risk tolerance + target return; wizard picks 12 stocks optimizing chosen metric under constraints; output flows into Approach 2 canvas for user toggling.
7. **Lump-sum vs DCA simulation** — toggle entry method, input amount, see both PnL paths.
8. **Saved portfolios** — localStorage in v1; name a portfolio, reopen it later, see live metrics.
9. **News feed** — RSS aggregation (ET, ToI, BusinessTimes SG, Google News keyword alerts), tagged per stock/commodity, 10-min refresh.
10. **Rebalance alerts** — user-defined drawdown / equity-variance thresholds trigger an email via Resend when a saved portfolio crosses them. Requires Supabase accounts (added Sprint 3+).

## What This Product IS NOT

1. **NOT a broker.** We do not place trades. We do not connect to Zerodha, Upstox, Kotak, ICICI Direct. Users copy signals into their own brokerage manually. This keeps us out of SEBI broker regulation entirely.
2. **NOT a PMS or investment advisory.** We do not manage money, recommend individual stocks, or publish "buy/sell" calls under user-specific risk profiles. All content is educational tooling. The goal-based wizard is an optimizer output, not investment advice.
3. **NOT real-time tick data.** Prices update end-of-day from MCX bhavcopy and Yahoo Finance. "Real-time" news means 10-minute RSS refresh, not sub-second push. Users who need real-time go to TradingView.
4. **NOT a signals newsletter.** Quantamental handles commodity signals; Backtest Lab is DIY. No weekly email with "today's trades".
5. **NOT a machine-learning / AI predictor.** Strategies are rule-based (blocks). No neural nets, no LLM recommendations, no "AI picks." If users want ML, that's Quantamental's domain.
6. **NOT for international markets in v1.** India only — NSE equities and MCX commodities. No US stocks, no forex, no crypto. Other Asian markets (Vietnam, Indonesia) possible in v2+ if the positioning holds.
7. **NOT dependent on paid data feeds.** No Bloomberg, no Refinitiv, no paid APIs in the critical path. MCX bhavcopy + Yahoo RSS + Google News RSS must suffice. If a feature requires paid data, it's cut.
8. **NOT a social/community platform in v1.** No user-to-user chat, shared strategies marketplace, leaderboards. Those create moderation burden and legal exposure around investment advice. Re-evaluate in v2.
9. **NOT cross-device synchronized in v1.** Portfolios live in browser localStorage. Users on multiple devices must export/import. Cross-device sync arrives with Supabase accounts (Sprint 3+).

## Success Metrics

**Product-market fit (first 6 months):**
- **Usage:** ≥ 500 unique weekly active users by month 3; ≥ 2000 by month 6
- **Engagement:** ≥ 40% of users who build a strategy return within 7 days to refine it
- **Portfolio adoption:** ≥ 25% of returning users save at least one named portfolio
- **Monetization signal:** ≥ 100 email signups to a paid newsletter / early-access waitlist by month 3

**Engineering health:**
- Cloudflare Pages p95 TTFB < 400ms globally
- Backtest of 1 stock × 5 years runs in < 2s client-side
- Portfolio of 12 stocks renders all metrics in < 5s
- Build + deploy cycle < 3 min from `git push`

**Non-goals (metrics we explicitly don't chase in v1):**
- Revenue (pre-monetization; track signups as proxy)
- User-generated content or social reach
- Paid conversion rate (no paid tier yet)

## Constraints

**Team:** Kit solo + Claude Code. No engineers to hire in the 6-month window.

**Budget:** $0/month infrastructure target. Cloudflare Pages (free), GitHub (free), GitHub Actions (free tier), Supabase (free tier) — total $0. Domain (`backtest-lab.com`) ~$12/year. Email (Resend) free tier covers < 3K/mo sends. If we cross a paid threshold, that's a real user signal.

**Timeline:** MVP of both portfolio approaches shippable in 5 weeks. Public launch targeting end of sprint 4.

**Technical:**
- Static-export architecture (no server-side runtime in v1) — required by Cloudflare Pages free tier
- Client-side backtest engine must stay under ~500ms per stock × 5y to maintain interactivity
- All data (prices, registry, news) must be servable as static JSON or cheap cron-refreshed static files
- No paid API dependencies in the critical path

**Regulatory:**
- We are a research/education tool. No SEBI registration required *as long as* we don't: give user-specific advice, execute trades, or claim to represent investment performance we didn't actually run.
- All content includes an "educational purposes only, not investment advice" disclaimer.
- No collection of PII beyond email address for newsletter signup. No KYC data, no financial records.

**Data:**
- NSE prices from Yahoo Finance (free, daily refresh sufficient)
- MCX prices from MCX bhavcopy (free CSV, daily)
- News from free RSS endpoints (ET, ToI, BusinessTimes SG, Google News RSS)
- No Bloomberg, no Refinitiv, no paid data
