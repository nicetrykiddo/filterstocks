/**
 * Daily data pipeline.
 *
 *   tsx scripts/update.ts [--days 700] [--skip-fundamentals]
 *
 * 1. Loads data/bars.json (adjusted daily bars for the scan universe, one
 *    primary tape per symbol).
 * 2. Downloads any missing sessions from both exchanges' public bhavcopy
 *    archives, appending one day at a time. Corporate actions are stitched
 *    using the exchange's own PrvsClsgPric: when the stated previous close
 *    diverges from our stored close by more than 2%, the stored history is
 *    rescaled to the new share basis.
 * 3. Refreshes the fundamentals cache when older than a week (Screener.in;
 *    skipped with --skip-fundamentals).
 * 4. Regenerates public/scan.json for the dashboard.
 *
 * The first run is a long backfill; later runs fetch only missing sessions.
 */
import fs from "node:fs";
import path from "node:path";
import type { DayRow } from "../src/lib/nse";
import { fetchBhavday, fetchBseDay, fetchIndexDay, toYmd } from "../src/lib/nse";
import { runScan } from "../src/lib/engine";
import { UNIVERSE, UNIVERSE_SNAPSHOT } from "../src/lib/universe";
import type { Bar } from "../src/lib/types";

const ROOT = path.resolve(__dirname, "..");
const BARS_FILE = path.join(ROOT, "data", "bars.json");
const SCAN_FILE = path.join(ROOT, "public", "scan.json");

/** Store v2: one primary tape per symbol, tracked in meta. */
interface Store {
  version: 2;
  updated: string;
  index: Array<[string, number]>;
  meta: Record<string, { ex: "NSE" | "BSE" }>;
  stocks: Record<string, Array<[string, number, number, number, number, number]>>;
}

const MAX_HISTORY = 720; // sessions kept per symbol (~weekly indicators + margin)
const STITCH_THRESHOLD = 0.02;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function loadStore(): Store {
  if (fs.existsSync(BARS_FILE)) {
    const raw = JSON.parse(fs.readFileSync(BARS_FILE, "utf8")) as Partial<Store>;
    // v1 stores had no version field; the schema changed wholesale, restart.
    if (raw.version === 2) return migrateAliases(raw as Store);
    console.log("v1 store found; starting a fresh v2 store (schema changed)");
  }
  return { version: 2, updated: "", index: [], meta: {}, stocks: {} };
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
      store.meta[u.symbol] = store.meta[alias] ?? store.meta[u.symbol];
      delete store.stocks[alias];
      delete store.meta[alias];
      console.log(`migrated alias ${alias} -> ${u.symbol} (${aliasBars.length} bars)`);
    }
  }
  return store;
}

function saveStore(store: Store) {
  fs.mkdirSync(path.dirname(BARS_FILE), { recursive: true });
  fs.writeFileSync(BARS_FILE, JSON.stringify(store));
}

function sessionDates(store: Store): Set<string> {
  return new Set(store.index.map(([d]) => d));
}

function candidateDays(from: string): string[] {
  const out: string[] = [];
  const start = new Date(from + "T12:00:00Z");
  start.setUTCDate(start.getUTCDate() + 1);
  for (let d = new Date(start); d <= new Date(); d.setUTCDate(d.getUTCDate() + 1)) {
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

function appendDay(store: Store, ymd: string, nseDay: DayRow | null, bseDay: DayRow | null, idxBar: Bar | null) {
  for (const u of UNIVERSE) {
    const day = u.exchange === "NSE" ? nseDay : bseDay;
    const row = day?.rows.get(u.symbol) ?? u.aliases.map((a) => day?.rows.get(a)).find((r) => r);
    if (!row || !day) continue;
    const hist = store.stocks[u.symbol] ?? [];
    if (!store.meta[u.symbol]) store.meta[u.symbol] = { ex: u.exchange };
    if (hist.some((b) => b[0] === ymd)) continue; // already stored (re-walk)
    const last = hist[hist.length - 1];

    if (last && last[4] > 0 && row.prevClose > 0) {
      const ratio = row.prevClose / last[4];
      if (Math.abs(ratio - 1) > STITCH_THRESHOLD) {
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
  const skipFund = args.includes("--skip-fundamentals");
  const store = loadStore();
  const have = sessionDates(store);
  let days: string[];

  const hasNewSymbols = UNIVERSE.some((u) => !store.stocks[u.symbol]?.length);
  if (daysFlagIdx !== -1 && args[daysFlagIdx + 1]) {
    days = backfillDays(Number(args[daysFlagIdx + 1]));
  } else if (store.updated && !hasNewSymbols) {
    days = candidateDays(store.updated);
  } else {
    days = backfillDays(760); // ~2 years of sessions
  }

  let missing = days.filter((d) => !have.has(d));
  if (hasNewSymbols && store.updated) {
    // Re-walk every session so symbols added since the last run pick up their
    // own trading history; per-symbol date checks prevent duplicate bars.
    missing = days;
    console.log("new symbols detected; re-walking the full window");
  }
  console.log(
    `store has ${store.index.length} sessions; ${missing.length} candidate days to try (${missing[0] ?? "-"} .. ${missing[missing.length - 1] ?? "-"})`,
  );

  if (missing.length === 0) {
    console.log("store is already current");
  } else {
    // Health-check against the store's own last date, a known real session.
    // Probing recent *missing* days would probe holidays, which 404.
    let probeOk = false;
    const probeTargets = store.updated ? [store.updated] : [...missing].reverse().slice(0, 6);
    for (const recent of probeTargets) {
      const day = await fetchBhavday(recent);
      if (day) {
        console.log(`probe ok: ${recent} (${day.rows.size} rows)`);
        probeOk = true;
        break;
      }
      await sleep(15000);
    }
    if (!probeOk) {
      console.error("NSE CDN refusing requests (rate-limited or blocked). Try again later.");
      process.exit(1);
    }
  }

  let added = 0;
  let consecutiveEmpty = 0;
  const startedAt = Date.now();
  for (const ymd of missing) {
    // Stop walking once both tapes agree the archive ends: 25 straight empty
    // days around the window's start means there is nothing deeper to get.
    if (consecutiveEmpty >= 25 && added > 0) {
      console.log(`archive floor reached before ${ymd}; stopping walk`);
      break;
    }
    const nseDay = await fetchBhavday(ymd);
    await sleep(250 + Math.random() * 200);
    const bseDay = await fetchBseDay(ymd);
    await sleep(250 + Math.random() * 200);

    if (!nseDay && !bseDay) {
      consecutiveEmpty++;
      continue; // holiday or archive edge on both tapes
    }
    consecutiveEmpty = 0;
    const idxBar = await fetchIndexDay(ymd);
    appendDay(store, ymd, nseDay, bseDay, idxBar);
    added++;
    if (added % 20 === 0) {
      console.log(`  ${added} sessions added (through ${ymd}, ${Math.round((Date.now() - startedAt) / 60000)}m)`);
      saveStore(store); // checkpoint so long backfills can resume
    }
  }
  console.log(`added ${added} sessions; total ${store.index.length}`);
  store.updated = store.index.length ? store.index[store.index.length - 1][0] : "";

  if (!store.index.length) {
    console.error("no sessions downloaded; aborting");
    process.exit(1);
  }

  saveStore(store);

  // ---- Fundamentals refresh (weekly) ----
  if (!skipFund) {
    const FUND_FILE = path.join(ROOT, "data", "fundamentals.json");
    const stale =
      !fs.existsSync(FUND_FILE) ||
      Date.now() - fs.statSync(FUND_FILE).mtimeMs > 7 * 86400_000;
    if (stale) {
      console.log("fundamentals cache stale; refreshing…");
      const { spawnSync } = await import("node:child_process");
      const r = spawnSync("npx", ["tsx", "scripts/fetch-fundamentals.ts"], {
        stdio: "inherit",
        cwd: ROOT,
      });
      if (r.status !== 0) console.error("fundamentals refresh failed; continuing with cache");
    } else {
      console.log("fundamentals cache is fresh");
    }
  }

  // ---- Scan ----
  const indexBars: Bar[] = store.index.map(([d, c]) => ({ date: d, open: c, high: c, low: c, close: c, volume: 0 }));
  const barsBySymbol = new Map<string, Bar[]>(
    Object.entries(store.stocks).map(([sym, rows]) => [
      sym,
      rows.map(([date, o, h, l, c, v]) => ({ date, open: o, high: h, low: l, close: c, volume: v })),
    ]),
  );
  const FUND_FILE = path.join(ROOT, "data", "fundamentals.json");
  const fundamentals: Record<string, {
    pe?: number | null; roe?: number | null; profitGrowthTtm?: number | null;
    name?: string; broadSector?: string; sector?: string; industry?: string; mcapCr?: number;
  }> = fs.existsSync(FUND_FILE) ? JSON.parse(fs.readFileSync(FUND_FILE, "utf8")) : {};
  const snapshotNote = UNIVERSE_SNAPSHOT.note;
  const scan = runScan(UNIVERSE, barsBySymbol, indexBars, fundamentals, snapshotNote);
  fs.writeFileSync(SCAN_FILE, JSON.stringify(scan));

  const dist = new Map<number, number>();
  for (const s of scan.rows) dist.set(s.score, (dist.get(s.score) ?? 0) + 1);
  console.log(
    "session", scan.session,
    "| scored", scan.breadth.universe,
    "| quar", scan.run.quar,
    "| at9+", scan.breadth.n9,
    "| mean", scan.breadth.mean.toFixed(3),
    "| movers", scan.trans.nUp + scan.trans.nDn,
  );
  console.log("distribution:", [...dist.entries()].sort((a, b) => b[0] - a[0]).map(([k, v]) => `${k}:${v}`).join(" "));
  console.log("scan.json bytes:", fs.statSync(SCAN_FILE).size);
}

main();
