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

## Notes

- The scan is for research and education. It is not investment advice and
  this project is not a SEBI-registered adviser or research analyst.
- RPCI's indicator is invite-only; the dashboard it publishes is public.
  If RPCI changes its page shape or restricts access, the mirror's payload
  assertions fail loudly in CI rather than publishing a broken table.
