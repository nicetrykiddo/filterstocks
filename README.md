# Scorebook

A daily eleven-condition scan of 1000+ Indian equities, computed by this
repo's own engine from exchange end-of-day data. The parameters — the
condition set, the result vocabulary, the 0–11 scoring — follow the scan
published at [rpci.stratlab.in](https://rpci.stratlab.in/); the formulas are
ours, documented openly in `src/lib/conditions.ts` and in the dashboard's
reading guide. Every session, each scanned name carries a 0–11 score, its
eleven condition readings, and 120 sessions of score history. The dashboard
shows breadth history, what moved, per-condition pass rates, sector
rankings, and a fully filterable table with CSV and TradingView exports.

## The universe

The scanned set is frozen in `data/universe.json` /
`src/lib/universe.ts`: the reference dashboard's scanned names (its BSE 1000
core, captured from the last archived reference session) fused with the
standing NSE + BSE liquidity cut — 1384 symbols, so every name the reference
scans is covered and the scored universe clears 1000. Names are scored on
their primary tape (NSE where cross-listed); F&O membership and Nifty
Midcap/Smallcap tags ride the exchanges' published constituent files.

## How the conditions are computed

Eight of the eleven formulas were **recovered**: grid-searched against the
reference's published pass/fail readings until they reproduced them
(`scripts/recover.ts`), then validated across 120 sessions of published
score history (`scripts/validate.ts`). On the archived overlap session they
agree with the reference's published bits at:

| Condition | Formula (ours) | Agreement |
|---|---|---|
| Short-term Extension | NOT (RSI14 ≥ 87 OR close ≥ MA20 + 5.5×ATR14) | 100% |
| Long-term Extension | NOT (close ≥ 1.30×MA50) | 99% |
| Stage Analysis | close above a rising 40-week average | 92% |
| Institutional Candles | ≥1 up-close in the top ⅔ of range on ≥9× 50-day volume, last 20 sessions | 92% |
| Timeframe Alignment | Minervini trend template on 50/150/200-day MAs + 52-week bands | 85% |
| Momentum | 52-week-high proximity + 126-session return, cross-sectional ranks | 81% |
| Dow Theory (W) | close above the 40-week average | 81% |

The remaining three (Valuation, Earnings Power, Price Contraction) could not
be uniquely determined from published bits — their agreement caps near
65–75% because the reference computes on its own fundamentals and data
basis. They are implemented on first principles and their thresholds are
calibrated so per-condition pass rates track the reference's published
distribution (`scripts/calibrate.ts`).

End-to-end, through the production pipeline on our own price data,
`scripts/parity.ts` measures mean per-condition agreement of ~82% against
the reference's published readings, with a mean score gap of about 1.1 of 11
points. The ceiling is the data basis, not the logic: the reference computes
on its own vendor's adjusted prices and private fundamentals.

## How data updates

There is no serverless fetching and no API key:

- `scripts/update.ts` loads `data/bars.json` (adjusted daily bars for the
  frozen universe, one primary tape per symbol), downloads any missing
  sessions from both exchanges' public bhavcopy archives (corporate actions
  stitched with each exchange's own previous-close), refreshes the
  fundamentals cache weekly (Screener.in), and regenerates `public/scan.json`
  through `src/lib/engine.ts`.
- `scripts/verify.ts` asserts the payload's invariants (a row's score must
  equal its own count of passing conditions; transitions must sum to the
  universe; breadth stats must recompute exactly) — a malformed payload
  fails loudly instead of publishing.
- A GitHub Action (`.github/workflows/update.yml`) runs all of this every
  weekday at 20:00 IST and commits `public/scan.json`; Vercel redeploys on
  the push. `data/bars.json` is a build cache, not source: it rides the
  Actions cache and is rebuilt from the archives if cold.
- `scripts/fetch-rpci.ts` archives the reference's published payload under
  `data/reference/` and `scripts/parity.ts` re-measures agreement whenever a
  fresh payload lands on the scanned session.

## Deploy to Vercel

1. Push this repo to GitHub (keep the workflow enabled).
2. Import the repo in Vercel. Framework preset: Next.js. No environment
   variables needed.
3. Deploy. The Action keeps `scan.json` current from the next session.

## Local development

```bash
npm install
npx tsx scripts/update.ts          # refresh the dataset (first run: backfill)
npx tsx scripts/verify.ts          # payload invariants
npx tsx scripts/parity.ts          # agreement vs the archived reference
npm run dev                        # dashboard at localhost:3000
```

## Layout

- `src/lib/conditions.ts` - the eleven conditions and their formulas
- `src/lib/engine.ts` - the scan: cross-sectional sweeps, breadth, movers, sectors
- `src/lib/nse.ts` - NSE/BSE bhavcopy and index access
- `scripts/update.ts` - the daily pipeline
- `scripts/calibrate.ts`, `scripts/parity.ts` - accuracy harnesses
- `scripts/recover.ts`, `scripts/validate.ts` - the formula-recovery research
- `src/components/` - the dashboard

## Notes

- The scan is for research and education. It is not investment advice and
  this project is not a SEBI-registered adviser or research analyst.
- RPCI's indicator is invite-only; the dashboard it publishes is public.
  This project is independent of RPCI and computes its own readings; where
  the reference's formulas could not be recovered exactly, ours are
  documented in their place.
