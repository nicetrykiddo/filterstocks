/**
 * Daily data pipeline.
 *
 *   tsx scripts/update.ts [--days 550]
 *
 * 1. Loads data/bars.json (adjusted daily bars for the scan universe).
 * 2. Downloads any missing sessions from NSE's public bhavcopy archive,
 *    appending one day at a time. Corporate actions are stitched using the
 *    exchange's own PrvsClsgPric: when the stated previous close diverges
 *    from our stored close by more than 2%, the whole stored history is
 *    rescaled to the new share basis.
 * 3. Regenerates public/scan.json for the dashboard.
 *
 * Run locally for the initial backfill, then daily from the GitHub Action.
 */

import fs from "node:fs";
import path from "node:path";
import { fetchBhavday, fetchIndexDay, toYmd } from "../src/lib/nse";
import type { DayRow } from "../src/lib/nse";
import { runScan } from "../src/lib/engine";
import { UNIVERSE } from "../src/lib/universe";
import type { Bar } from "../src/lib/types";

const ROOT = path.resolve(__dirname, "..");
const BARS_FILE = path.join(ROOT, "data", "bars.json");
const SCAN_FILE = path.join(ROOT, "public", "scan.json");

interface Store {
  updated: string;
  index: Array<[string, number]>;
  stocks: Record<string, Array<[string, number, number, number, number, number]>>;
}

const MAX_HISTORY = 420; // sessions kept per symbol (~SMA200 + trace + margin)
const STITCH_THRESHOLD = 0.02;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function loadStore(): Store {
  if (fs.existsSync(BARS_FILE)) {
    const store = JSON.parse(fs.readFileSync(BARS_FILE, "utf8")) as Store;
    migrateAliases(store);
    return store;
  }
  return { updated: "", index: [], stocks: {} };
}

/** Moves bars stored under predecessor tickers into their current symbol. */
function migrateAliases(store: Store) {
  for (const u of UNIVERSE) {
    for (const alias of u.aliases) {
      const aliasBars = store.stocks[alias];
      if (!aliasBars?.length) continue;
      const main = store.stocks[u.symbol] ?? [];
      const byDate = new Map(main.map((b) => [b[0], b]));
      for (const b of aliasBars) if (!byDate.has(b[0])) byDate.set(b[0], b);
      store.stocks[u.symbol] = [...byDate.values()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
      delete store.stocks[alias];
      console.log(`migrated alias ${alias} -> ${u.symbol} (${aliasBars.length} bars)`);
    }
  }
}

function saveStore(store: Store) {
  fs.mkdirSync(path.dirname(BARS_FILE), { recursive: true });
  fs.writeFileSync(BARS_FILE, JSON.stringify(store));
}

function sessionDates(store: Store): Set<string> {
  return new Set(store.index.map(([d]) => d));
}

/** All calendar days from `from` (YYYY-MM-DD, exclusive) through today, minus weekends. */
function candidateDays(from: string): string[] {
  const out: string[] = [];
  const start = new Date(from + "T12:00:00Z");
  start.setUTCDate(start.getUTCDate() + 1);
  const today = new Date();
  for (let d = new Date(start); d <= today; d.setUTCDate(d.getUTCDate() + 1)) {
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    out.push(toYmd(new Date(d.getTime())));
  }
  return out;
}

function backfillDays(n: number): string[] {
  const out: string[] = [];
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - n);
  for (let d = new Date(start); d <= new Date(); d.setUTCDate(d.getUTCDate() + 1)) {
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    out.push(toYmd(new Date(d.getTime())));
  }
  return out;
}

function appendDay(store: Store, ymd: string, day: DayRow, idxBar: Bar | null) {
  for (const u of UNIVERSE) {
    // A renamed name: the alias row carries the pre-rename session.
    const row = day.rows.get(u.symbol) ?? u.aliases.map((a) => day.rows.get(a)).find((r) => r);
    if (!row) continue;
    const hist = store.stocks[u.symbol] ?? [];
    if (hist.some((b) => b[0] === ymd)) continue; // already stored (re-walk)
    const last = hist[hist.length - 1];

    if (last && last[4] > 0 && row.prevClose > 0) {
      const ratio = row.prevClose / last[4];
      if (Math.abs(ratio - 1) > STITCH_THRESHOLD) {
        // Split / bonus / rights: rescale stored history to today's basis.
        for (const b of hist) {
          b[1] = round(b[1] * ratio);
          b[2] = round(b[2] * ratio);
          b[3] = round(b[3] * ratio);
          b[4] = round(b[4] * ratio);
          b[5] = Math.round(b[5] * ratio);
        }
        console.log(`    stitch ${u.symbol} on ${ymd}: ratio ${ratio.toFixed(4)}`);
      }
    }
    hist.push([ymd, round(row.open), round(row.high), round(row.low), round(row.close), Math.round(row.volume)]);
    if (hist.length > MAX_HISTORY) hist.splice(0, hist.length - MAX_HISTORY);
    store.stocks[u.symbol] = hist;
  }

  if (idxBar && !store.index.some(([d]) => d === idxBar.date)) {
    store.index.push([idxBar.date, round(idxBar.close)]);
    store.index.sort((a, b) => (a[0] < b[0] ? -1 : 1));
    if (store.index.length > MAX_HISTORY + 40) store.index.splice(0, store.index.length - (MAX_HISTORY + 40));
  }
}

function round(x: number): number {
  return Math.round(x * 100) / 100;
}

async function main() {
  const args = process.argv.slice(2);
  const daysFlagIdx = args.indexOf("--days");
  const store = loadStore();
  const have = sessionDates(store);
  let days: string[];

  // Symbols added or renamed since the last run have no bars; re-walk the
  // full window so they pick up their own trading history.
  const hasNewSymbols = UNIVERSE.some((u) => !store.stocks[u.symbol]?.length);
  if (daysFlagIdx !== -1 && args[daysFlagIdx + 1]) {
    days = backfillDays(Number(args[daysFlagIdx + 1]));
  } else if (store.updated && !hasNewSymbols) {
    days = candidateDays(store.updated);
  } else {
    days = backfillDays(550);
  }

  let missing = days.filter((d) => !have.has(d));
  if (hasNewSymbols) {
    // Re-walk every session so symbols added since the last run can pick up
    // their own history; per-symbol date checks prevent duplicate bars.
    missing = days;
    console.log("new symbols detected; re-walking the full window");
  }
  console.log(`store has ${store.index.length} sessions; ${missing.length} candidate days to try (${missing[0] ?? "-"} .. ${missing[missing.length - 1] ?? "-"})`);

  if (missing.length === 0) {
    console.log("store is already current");
  } else {
    // Health-check only, against a date we know was a real session (the
    // store's own last date). Probing recent *missing* days would probe
    // holidays, which have no bhavcopy at all.
    const probeTargets = store.updated
      ? [store.updated]
      : [...missing].reverse().slice(0, 6);
    let probeOk = false;
    for (const recent of probeTargets) {
      const day = await fetchBhavday(recent);
      if (day) {
        console.log(`probe ok: ${recent} (${day.rows.size} rows)`);
        probeOk = true;
        break;
      }
      await sleep(30000);
    }
    if (!probeOk) {
      console.error("NSE CDN is refusing requests (rate-limited or blocked). Try again later.");
      process.exit(1);
    }
  }

  let added = 0;
  let consecutiveFails = 0;
  for (const ymd of missing) {
    const day = await fetchBhavday(ymd);
    if (!day) {
      // Isolated nulls mid-history are holidays; long streaks mean the CDN
      // started refusing us mid-run.
      consecutiveFails++;
      if (consecutiveFails >= 20) {
        console.error(`20 consecutive failures at ${ymd}; stopping to avoid hammering the CDN.`);
        break;
      }
      if (consecutiveFails % 5 === 0) await sleep(5000 + Math.random() * 2000);
      continue;
    }
    consecutiveFails = 0;
    const idxBar = await fetchIndexDay(ymd);
    appendDay(store, ymd, day, idxBar);
    added++;
    if (added % 25 === 0) {
      console.log(`  ${added} sessions added (through ${ymd})`);
      saveStore(store); // checkpoint so long backfills can resume
    }
    await sleep(700 + Math.random() * 400);
  }
  console.log(`added ${added} sessions; total ${store.index.length}`);
  store.updated = store.index.length ? store.index[store.index.length - 1][0] : "";

  if (!store.index.length) {
    console.error("no sessions downloaded; aborting");
    process.exit(1);
  }

  saveStore(store);

  const indexBars: Bar[] = store.index.map(([d, c]) => ({ date: d, open: c, high: c, low: c, close: c, volume: 0 }));
  const barsBySymbol = new Map<string, Bar[]>(
    Object.entries(store.stocks).map(([sym, rows]) => [
      sym,
      rows.map(([date, o, h, l, c, v]) => ({ date, open: o, high: h, low: l, close: c, volume: v })),
    ]),
  );
  const scan = runScan(UNIVERSE, barsBySymbol, indexBars);
  fs.mkdirSync(path.dirname(SCAN_FILE), { recursive: true });
  fs.writeFileSync(SCAN_FILE, JSON.stringify(scan));

  const dist = new Map<number, number>();
  for (const s of scan.stocks) dist.set(s.score, (dist.get(s.score) ?? 0) + 1);
  console.log(
    "session", scan.session,
    "| scored", scan.stocks.length,
    "| at9", scan.breadth.at9.at(-1),
    "| mean", scan.breadth.meanScore.at(-1),
    "| movers", scan.movers.length,
  );
  console.log("distribution:", [...dist.entries()].sort((a, b) => b[0] - a[0]).map(([k, v]) => `${k}:${v}`).join(" "));
  console.log("scan.json bytes:", fs.statSync(SCAN_FILE).size);
}

main();
