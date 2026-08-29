/**
 * Boundary analysis + history validation for recovered formulas.
 *
 * For each candidate formula: (1) how close to the decision boundary are the
 * mismatches? (2) simulate the formula across the last 120 sessions and
 * compare the resulting score series to RPCI's published per-stock score
 * history (h arrays) — the decisive test for whether a formula is truly
 * recovered or merely calibrated to one session.
 */
import fs from "node:fs";
import path from "node:path";
import { precompute, type Pre } from "../src/lib/conditions";
import type { Bar } from "../src/lib/types";

const ROOT = path.resolve(__dirname, "..");
const SCAN_FILE = path.join(ROOT, "public", "scan.json");
const BARS_FILE = path.join(ROOT, "data", "bars.json");

function main() {
  const scan = JSON.parse(fs.readFileSync(SCAN_FILE, "utf8"));
  const store = JSON.parse(fs.readFileSync(BARS_FILE, "utf8"));
  const indexBars: Bar[] = store.index.map(([d, c]: [string, number]) => ({ date: d, open: c, high: c, low: c, close: c, volume: 0 }));
  const session = indexBars[indexBars.length - 1].date;
  interface Label { bits: number[]; h: number[] }
  const labelOf = new Map<string, Label>(
    (scan.rows as Array<Record<string, unknown>>).map((r) => [
      r.symbol as string,
      { bits: String(r.st).split("").map((c: string) => (c === "1" ? 1 : 0)), h: (r.hist ?? r.h ?? []) as number[] },
    ]),
  );

  // TFA candidate: Minervini template (best config from recover.ts)
  const tfaCandidates: Array<[string, (p: Pre, i: number) => boolean | null]> = [
    [
      "template(c50,c150,c200,s50>s150,s200r,lo30,hi75)",
      (p, i) => {
        const c = p.close[i];
        const s50 = p.sma50[i], s150 = p.sma150[i], s200 = p.sma200[i];
        if (!s50 || !s150 || !s200 || p.sma200[i - 20] == null) return null;
        const lo52 = Math.min(...p.close.slice(Math.max(0, i - 250), i + 1));
        const hi52 = Math.max(...p.close.slice(Math.max(0, i - 250), i + 1));
        return c > s50 && c > s150 && c > s200 && s50 > s150 && s200 > p.sma200[i - 20]! && c >= 1.3 * lo52 && c >= 0.75 * hi52;
      },
    ],
  ];
  // STG candidate
  const stgCandidates: Array<[string, (p: Pre, i: number) => boolean | null]> = [
    [
      "above30w & rising30w",
      (p, i) => {
        const w = p.weekAsOf[i];
        if (w < 5) return null;
        const wma = p.wma30[w];
        if (wma == null) return null;
        return p.close[i] > wma && wma > (p.wma30[w - 5] ?? 0);
      },
    ],
  ];
  // DOW candidate: above rising 40wk MA
  const dowCandidates: Array<[string, (p: Pre, i: number) => boolean | null]> = [
    [
      "above rising 40wkMA",
      (p, i) => {
        const w = p.weekAsOf[i];
        if (w < 45) return null;
        const wc = p.weeklyClose;
        const avg = (a: number, b: number) => wc.slice(a, b).reduce((x, y) => x + y, 0) / (b - a);
        const now = avg(w - 39, w + 1);
        const prev = avg(w - 44, w - 4);
        return p.close[i] > now && now > prev;
      },
    ],
  ];

  type Cand = { name: string; idx: number; fn: (p: Pre, i: number) => boolean | null };
  const candidates: Cand[] = [
    ...tfaCandidates.map(([name, fn]) => ({ name, idx: 4, fn })),
    ...stgCandidates.map(([name, fn]) => ({ name, idx: 9, fn })),
    ...dowCandidates.map(([name, fn]) => ({ name, idx: 10, fn })),
  ];

  for (const cand of candidates) {
    const mismatchDists: number[] = [];
    let ok = 0, n = 0;
    for (const [sym, lab] of labelOf) {
      const bars = store.stocks[sym];
      if (!bars || bars.length < 250) continue;
      if (bars[bars.length - 1][0] !== session) continue;
      const p = precompute(bars.map(([date, o, h, lo, c, v]: [string, number, number, number, number, number]) => ({ date, open: o, high: h, low: lo, close: c, volume: v })));
      const i = bars.length - 1;
      const v = cand.fn(p, i);
      if (v === null) continue;
      n++;
      const want = lab.bits[cand.idx];
      if (v === (want === 1)) ok++;
      else {
        // boundary distance: closest clause margin (normalized)
        const c = p.close[i];
        const s50 = p.sma50[i] ?? c, s150 = p.sma150[i] ?? c, s200 = p.sma200[i] ?? c;
        const margins = [
          Math.abs(c / s50 - 1),
          Math.abs(c / s150 - 1),
          Math.abs(c / s200 - 1),
          Math.abs(s50 / s150 - 1),
        ].filter((x) => Number.isFinite(x));
        mismatchDists.push(Math.min(...margins));
      }
    }
    const near = mismatchDists.filter((d) => d < 0.02).length;
    console.log(`${cand.name}  ag ${(ok / n * 100).toFixed(1)}% (${ok}/${n})  mismatches ${mismatchDists.length}  of which within 2% of a boundary: ${near} (${(near / mismatchDists.length * 100).toFixed(0)}%)`);
  }

  // ---- history validation: simulate score over last 120 sessions ----
  console.log("\nhistory validation (simulate 120 sessions, compare to published h):");
  const techConds: Cand[] = [
    ...tfaCandidates.map(([name, fn]) => ({ name, idx: 4, fn })),
    ...stgCandidates.map(([name, fn]) => ({ name, idx: 9, fn })),
    ...dowCandidates.map(([name, fn]) => ({ name, idx: 10, fn })),
  ];
  // For history we simulate these three technical conditions and check
  // whether the published h moves with them.
  let totCorr = 0, totN = 0;
  for (const [sym, lab] of labelOf) {
    const bars = store.stocks[sym];
    if (!bars || bars.length < 300) continue;
    if (bars[bars.length - 1][0] !== session) continue;
    const p = precompute(bars.map(([date, o, h, lo, c, v]: [string, number, number, number, number, number]) => ({ date, open: o, high: h, low: lo, close: c, volume: v })));
    const lastT = bars.length - 1;
    const sim: number[] = [];
    const pub = lab.h.slice(-120);
    for (let t = lastT - 119; t <= lastT; t++) {
      let sum = 0;
      for (const cand of techConds) {
        const v = cand.fn(p, t);
        if (v) sum++;
      }
      sim.push(sum);
    }
    if (pub.length !== sim.length) continue;
    const corr = pearson(sim, pub);
    if (Number.isFinite(corr)) { totCorr += corr; totN++; }
  }
  console.log(`mean Pearson(simulated 3-tech-cond score, published h): ${(totCorr / totN).toFixed(3)} over ${totN} stocks`);
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
