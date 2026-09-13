/**
 * Parity harness: runs the production engine as of the preserved reference
 * session (scripts/fetch-rpci.ts's last mirrored payload) over exactly the
 * names the reference scanned, then compares our eleven pass/fail bits,
 * reading vocabulary, scores and score history against the published ones.
 *
 *   tsx scripts/parity.ts
 *
 * This is the honest accuracy metric for the recovered formulas: it measures
 * the whole pipeline — data basis included — through the same runScan path
 * the dashboard ships, not a hand-built feature table.
 */
import fs from "node:fs";
import path from "node:path";
import { runScan, type FundEntry } from "../src/lib/engine";
import { UNIVERSE } from "../src/lib/universe";
import type { Bar, ScanResult } from "../src/lib/types";

const ROOT = path.resolve(__dirname, "..");
const BARS_FILE = path.join(ROOT, "data", "bars.json");
const FUND_FILE = path.join(ROOT, "data", "fundamentals.json");
const REF_DIR = path.join(ROOT, "data", "reference");

interface Store {
  version: 2;
  index: Array<[string, number]>;
  meta: Record<string, { ex: "NSE" | "BSE" }>;
  stocks: Record<string, Array<[string, number, number, number, number, number]>>;
}

function latestReference(): { file: string; payload: ScanResult } {
  const files = fs.readdirSync(REF_DIR).filter((f) => /^scan-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  if (!files.length) throw new Error("no reference payload in data/reference; run scripts/fetch-rpci.ts first");
  const file = path.join(REF_DIR, files[files.length - 1]);
  return { file, payload: JSON.parse(fs.readFileSync(file, "utf8")) as ScanResult };
}

function main() {
  const { file, payload: ref } = latestReference();
  const store: Store = JSON.parse(fs.readFileSync(BARS_FILE, "utf8"));
  const fundamentals: Record<string, FundEntry> = fs.existsSync(FUND_FILE)
    ? JSON.parse(fs.readFileSync(FUND_FILE, "utf8"))
    : {};
  const refSession = ref.session;
  const lastStoreSession = store.index[store.index.length - 1]?.[0];
  if (!lastStoreSession || lastStoreSession < refSession) {
    // The store must have reached the reference session; the harness
    // truncates forward, but cannot go back below it.
    console.log(
      `store is at ${lastStoreSession ?? "nothing"}, reference is ${refSession}; run scripts/update.ts past that session first — skipping`,
    );
    return;
  }
  console.log(`reference ${path.basename(file)}: session ${refSession}, ${ref.rows.length} rows`);

  // Truncate the store to the reference session so runScan's last trace
  // session is exactly the session the reference published.
  const indexBars: Bar[] = store.index
    .filter(([d]) => d <= refSession)
    .map(([d, c]) => ({ date: d, open: c, high: c, low: c, close: c, volume: 0 }));
  if (indexBars[indexBars.length - 1]?.date !== refSession) {
    throw new Error(`store lacks the reference session ${refSession}; run scripts/update.ts`);
  }

  const refBySymbol = new Map(ref.rows.map((r) => [r.symbol, r]));
  const universe = UNIVERSE.filter((u) => refBySymbol.has(u.symbol));
  const barsBySymbol = new Map<string, Bar[]>();
  let absent = 0;
  for (const u of universe) {
    const rows = store.stocks[u.symbol];
    if (!rows?.length) { absent++; continue; }
    barsBySymbol.set(
      u.symbol,
      rows.filter(([d]) => d <= refSession).map(([date, o, h, l, c, v]) => ({ date, open: o, high: h, low: l, close: c, volume: v })),
    );
  }
  console.log(`parity universe: ${universe.length} names (${absent} without bars)`);

  const scan = runScan(universe, barsBySymbol, indexBars, fundamentals, "parity harness");
  const ourBySymbol = new Map(scan.rows.map((r) => [r.symbol, r]));

  // ---- per-condition agreement ----
  const N = 11;
  const ok = new Array(N).fill(0);
  const considered = new Array(N).fill(0);
  const vocabOk = new Array(N).fill(0);
  let bitMatches = 0;
  let scoreMatches = 0;
  let compared = 0;
  let histCorrSum = 0;
  let histN = 0;
  let absScoreDiffSum = 0;

  for (const [sym, refRow] of refBySymbol) {
    const ours = ourBySymbol.get(sym);
    if (!ours) continue;
    compared++;
    let allBits = true;
    for (let ci = 0; ci < N; ci++) {
      const want = refRow.st[ci] === "1";
      const got = ours.st[ci] === "1";
      considered[ci]++;
      if (want === got) ok[ci]++;
      else allBits = false;
      if (refRow.res?.[ci] !== undefined && refRow.res[ci] === ours.res[ci]) vocabOk[ci]++;
    }
    if (allBits) bitMatches++;
    if (refRow.score === ours.score) scoreMatches++;
    absScoreDiffSum += Math.abs(refRow.score - ours.score);
    if (refRow.hist?.length === 120 && ours.hist.length === 120) {
      const r = pearson(ours.hist, refRow.hist);
      if (Number.isFinite(r)) { histCorrSum += r; histN++; }
    }
  }

  console.log(`\ncompared ${compared} of ${ref.rows.length} reference rows`);
  console.log("\ncondition  agreement  vocabulary");
  ref.labels.forEach((label, ci) => {
    const ag = considered[ci] ? ((ok[ci] / considered[ci]) * 100).toFixed(1) : "-";
    const vg = considered[ci] ? ((vocabOk[ci] / considered[ci]) * 100).toFixed(1) : "-";
    console.log(
      `${String(ci + 1).padStart(2)} ${ref.abbrevs[ci].padEnd(4)} ${label.padEnd(22)} ${ag.padStart(6)}%  ${vg.padStart(6)}%`,
    );
  });
  const meanAg = ok.reduce((a, b, ci) => a + (considered[ci] ? ok[ci] / considered[ci] : 0), 0) / N;
  console.log(`\nmean per-condition agreement: ${(meanAg * 100).toFixed(1)}%`);
  console.log(`exact 11-bit rows:  ${bitMatches}/${compared} (${((bitMatches / compared) * 100).toFixed(1)}%)`);
  console.log(`exact score rows:   ${scoreMatches}/${compared} (${((scoreMatches / compared) * 100).toFixed(1)}%)`);
  console.log(`mean |score diff|:  ${(absScoreDiffSum / compared).toFixed(3)} of 11`);
  if (histN) console.log(`mean Pearson(our score history, published history): ${(histCorrSum / histN).toFixed(3)} over ${histN} names`);
  console.log(`\nbreadth: ours n9 ${scan.breadth.n9}/${scan.breadth.universe} mean ${scan.breadth.mean} | reference n9 ${ref.breadth.n9}/${ref.breadth.universe} mean ${ref.breadth.mean}`);
}

function pearson(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((x, y) => x + y, 0) / n;
  const mb = b.reduce((x, y) => x + y, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return num / Math.sqrt(da * db);
}

main();
