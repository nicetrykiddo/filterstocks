# Scorebook

A daily, eleven-condition checklist scan of liquid NSE stocks. Every session,
each name in the universe is scored 0-11 against documented trend, momentum
and contraction checks. The dashboard shows breadth history, what moved,
per-condition pass rates, sector rankings, and a fully filterable table with
CSV and TradingView exports.

This is an independent, open implementation of the "daily 11-point scan"
dashboard pattern. The condition definitions live in `src/lib/conditions.ts`
and are shown in full inside the app ("How to read").

## How data updates

There is no serverless fetching and no API key. The dataset is built from
NSE's public end-of-day bhavcopy archive and committed to the repo:

- `scripts/update.ts` downloads missing sessions, appends them to
  `data/bars.json` (adjusting history for splits and bonuses using the
  exchange's own previous-close field), then regenerates `public/scan.json`.
- A GitHub Action (`.github/workflows/update.yml`) runs this every weekday
  at 17:50 IST after the bhavcopy is published, and commits the result.
- Vercel redeploys on the push. Users always load a static `scan.json`
  from the CDN, so the site is fast and never breaks on a flaky upstream.

First run (initial backfill, ~15 minutes, polite pacing):

```bash
npm install
npx tsx scripts/update.ts --days 550
```

Later runs download only the missing sessions.

## Deploy to Vercel

1. Push this repo to GitHub (keep the workflow enabled).
2. Import the repo in Vercel. Framework preset: Next.js. No environment
   variables needed.
3. Deploy. The Action keeps `scan.json` current from the next session.

## Local development

```bash
npm run dev
```

## Layout

- `src/lib/conditions.ts` - the eleven conditions, documented
- `src/lib/engine.ts` - scoring, history, held, movers, breadth, sectors
- `src/lib/nse.ts` - bhavcopy download and parsing (curl-backed)
- `src/lib/universe.ts` - the scanned universe with sector and F&O tags
- `scripts/update.ts` - the daily pipeline
- `src/components/` - the dashboard

## Maintenance notes

- F&O membership and sector tags in `universe.ts` drift as NSE revises
  lists; edit entries there when needed.
- Symbols renamed on the exchange accumulate history from the rename date;
  the engine skips names with fewer than ~210 sessions automatically.
- The scan is for research and education. It is not investment advice and
  this project is not a SEBI-registered adviser or research analyst.
