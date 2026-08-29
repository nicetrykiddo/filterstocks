/**
 * Extends data/bars.json to cover every symbol the RPCI mirror publishes.
 *
 *   tsx scripts/recover-bars.ts          # fill gaps, repair truncation
 *   tsx scripts/recover-bars.ts --fresh  # wipe and rebuild all RPCI symbols
 *
 * An earlier walk appended some sessions out of order, which corrupted the
 * previous-close stitching for ~600 symbols (history rescaled against the
 * wrong baseline). --fresh clears every published symbol and re-walks the
 * store's sessions chronologically, so each day stitches against the true
 * prior session.
 */
import fs from "node:fs";
import path from "node:path";
import type { DayRow } from "../src/lib/nse";
import { fetchBhavday, fetchBseDay } from "../src/lib/nse";

const ROOT = path.resolve(__dirname, "..");
const BARS_FILE = path.join(ROOT, "data", "bars.json");
const SCAN_FILE = path.join(ROOT, "public", "scan.json");

interface Store {
  version: 2;
  updated: string;
  index: Array<[string, number]>;
  meta: Record<string, { ex: "NSE" | "BSE" }>;
  stocks: Record<string, Array<[string, number, number, number, number, number]>>;
}

const STITCH_THRESHOLD = 0.02;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const round = (x: number) => Math.round(x * 100) / 100;

async function main() {
  const fresh = process.argv.includes("--fresh");
  const scan = JSON.parse(fs.readFileSync(SCAN_FILE, "utf8"));
  const store: Store = JSON.parse(fs.readFileSync(BARS_FILE, "utf8"));
  const lastIndexDate = store.index[store.index.length - 1][0];

  let wanted: Array<{ symbol: string; exchange: "NSE" | "BSE" }>;
  let days: Array<[string, number]>;
  if (fresh) {
    wanted = (scan.rows as Array<{ symbol: string; tvSymbol: string }>).map((r) => ({
      symbol: r.symbol,
      exchange: String(r.tvSymbol).startsWith("BSE:") ? ("BSE" as const) : ("NSE" as const),
    }));
    for (const u of wanted) delete store.stocks[u.symbol];
    days = store.index;
    console.log(`FRESH rebuild: ${wanted.length} symbols, ${days.length} sessions`);
  } else {
    // Missing entirely, or truncated short of the index's last session.
    wanted = (scan.rows as Array<{ symbol: string; tvSymbol: string }>)
      .filter((r) => {
        const hist = store.stocks[r.symbol];
        if (!hist?.length) return true;
        return hist[hist.length - 1][0] < lastIndexDate;
      })
      .map((r) => ({
        symbol: r.symbol,
        exchange: String(r.tvSymbol).startsWith("BSE:") ? ("BSE" as const) : ("NSE" as const),
      }));
    console.log(`${wanted.length} symbols need bars; ${store.index.length} sessions in store`);

    const fromDate = wanted.reduce(
      (min, u) => {
        const hist = store.stocks[u.symbol];
        const last = hist?.length ? hist[hist.length - 1][0] : store.index[0][0];
        return last < min ? last : min;
      },
      lastIndexDate,
    );
    days = store.index.filter(([d]) => d >= fromDate);
    console.log(`walking ${days.length} sessions from ${days[0][0] ?? "?"} to ${lastIndexDate}`);

    // The store's arrays may be unsorted (an earlier walk appended some days
    // out of order). Sort once, then only strictly-newer dates are appended.
    for (const u of wanted) {
      const hist = store.stocks[u.symbol];
      if (hist?.length) {
        const seen = new Map<string, (typeof hist)[number]>();
        for (const row of hist) seen.set(row[0], row);
        store.stocks[u.symbol] = [...seen.values()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
      }
    }
  }

  let done = 0;
  let failed = 0;
  const startedAt = Date.now();
  for (const [ymd] of days) {
    let nseDay: DayRow | null = null;
    let bseDay: DayRow | null = null;
    for (let attempt = 0; attempt < 3 && !nseDay; attempt++) {
      nseDay = await fetchBhavday(ymd);
      if (!nseDay) await sleep(5000 * (attempt + 1));
    }
    await sleep(400);
    for (let attempt = 0; attempt < 2 && !bseDay; attempt++) {
      bseDay = await fetchBseDay(ymd);
      if (!bseDay) await sleep(5000 * (attempt + 1));
    }
    await sleep(400);
    if (!nseDay && !bseDay) {
      failed++;
      console.log(`  ${ymd}: both tapes empty (${failed} so far)`);
      continue;
    }

    for (const u of wanted) {
      const day = u.exchange === "NSE" ? nseDay : bseDay;
      const row = day?.rows.get(u.symbol);
      if (!row || !day) continue;
      const hist = store.stocks[u.symbol] ?? [];
      if (!store.meta[u.symbol]) store.meta[u.symbol] = { ex: u.exchange };
      if (hist.length && hist[hist.length - 1][0] >= ymd) continue; // already at or past this day
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
        }
      }
      hist.push([ymd, round(row.open), round(row.high), round(row.low), round(row.close), Math.round(row.volume)]);
      store.stocks[u.symbol] = hist;
    }
    done++;
    if (done % 10 === 0 || done === days.length) {
      const covered = wanted.filter((u) => {
        const hist = store.stocks[u.symbol];
        return hist?.length && hist[hist.length - 1][0] === lastIndexDate;
      }).length;
      console.log(
        `  ${done}/${days.length} sessions, ${covered}/${wanted.length} symbols current, ${failed} empty (${Math.round((Date.now() - startedAt) / 60000)}m)`,
      );
      fs.writeFileSync(BARS_FILE, JSON.stringify(store));
    }
  }
  console.log("done");
}

main();
