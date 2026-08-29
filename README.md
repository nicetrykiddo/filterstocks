# Scorebook

A daily mirror of RPCI's published eleven-condition scan
([rpci.stratlab.in](https://rpci.stratlab.in/)). Every session, each of the
~999 scanned names carries a 0-11 score, its eleven condition readings, and
120 sessions of score history. The dashboard shows breadth history, what
moved, per-condition pass rates, sector rankings, and a fully filterable
table with CSV and TradingView exports.

## What is mirrored, what is not

RPCI computes its conditions server-side in a private pipeline and publishes
only the resulting readings. This project mirrors those **published values
verbatim** — scores, condition results, breadth stats and movers are
identical to what rpci.stratlab.in shows for the same session.

The formulas are not published, so there is nothing to reimplement here.
The mirror fetches the public page once per day, asserts the payload's
invariants (a row's score must equal its own count of passing conditions),
and rewrites it into this app's schema.

## How data updates

There is no serverless fetching and no API key:

- `scripts/fetch-rpci.ts` fetches the public dashboard, extracts the session
  payload, joins company names from the screener-backed cache
  (`data/fundamentals.json`), and writes `public/scan.json`.
- A GitHub Action (`.github/workflows/update.yml`) runs this every weekday
  at 20:00 IST after RPCI's evening scan is published, and commits the
  result.
- Vercel redeploys on the push. Users always load a static `scan.json`
  from the CDN, so the site is fast and never breaks on a flaky upstream.

## Deploy to Vercel

1. Push this repo to GitHub (keep the workflow enabled).
2. Import the repo in Vercel. Framework preset: Next.js. No environment
   variables needed.
3. Deploy. The Action keeps `scan.json` current from the next session.

## Local development

```bash
npm install
npx tsx scripts/fetch-rpci.ts   # refresh the dataset
npm run dev                     # dashboard at localhost:3000
```

## Layout

- `scripts/fetch-rpci.ts` - the daily mirror pipeline
- `src/lib/engine.ts` - the former independent scan engine, retained for
  reference
- `src/lib/conditions.ts` - the former condition implementations, retained
  for reference
- `src/components/` - the dashboard

## Formula recovery (research)

RPCI's formulas are private, but the published bits are labels. With the
bhavcopy store and the screener-backed fundamentals cache,
`scripts/recover.ts` grid-searches hypothesis families against the
published PASS/FAIL bits and `scripts/validate.ts` simulates candidates
across 120 sessions of published score history. Findings:

- **STX** — pass = NOT (RSI14 ≥ 87 OR close ≥ MA20 + 5.5×ATR14): 100% match
- **LTX** — pass = NOT (close ≥ 1.30×MA50): 99%
- **INS** — ≥1 candle in last 10-20 sessions closing up, in the top ⅔ of
  its range, on ≥10× 50-day-average volume: 93%
- **STG** — close above a rising 30-week MA (Weinstein): 85%, half of
  mismatches within 2% of the boundary (data-basis noise)
- **DOW** — close above a rising 40-week MA: 77%
- **TFA** — Minervini Trend Template family (price > 50/150/200-day MAs,
  200-day rising, ≥1.3× 52-week low, ≥0.75× 52-week high): 84%
- **MOM** — 52-week-high proximity + 126-day return, cross-sectionally
  ranked: 87%
- **CON, OPF, VAL, ERN** — not pinned down: multi-criteria definitions and
  an unknown fundamentals source; agreement caps at 65-75%

The ceiling is the data basis: RPCI computes on TradingView data and its
own fundamentals, so published bits do not uniquely determine formulas.
The mirror remains the only exact path; these findings are the best
independent approximation available from public data.

## Notes

- The scan is for research and education. It is not investment advice and
  this project is not a SEBI-registered adviser or research analyst.
- RPCI's indicator is invite-only; the dashboard it publishes is public.
  If RPCI changes its page shape or restricts access, the mirror's payload
  assertions fail loudly in CI rather than publishing a broken table.
