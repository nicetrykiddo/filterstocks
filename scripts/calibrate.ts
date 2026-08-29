/**
 * Calibration harness: compares the scan's per-condition pass rates against
 * the reference dashboard's published distribution and prints the deltas.
 *
 *   tsx scripts/calibrate.ts
 *
 * The reference keeps its formulas private; only its pass counts are public.
 * This report is how we keep our honest, documented implementations tracking
 * the same shape of market without copying anything unknowable.
 */
import fs from "node:fs";
import path from "node:path";
import { runScan } from "../src/lib/engine";
import { UNIVERSE, UNIVERSE_SNAPSHOT } from "../src/lib/universe";
import type { Bar } from "../src/lib/types";

const ROOT = path.resolve(__dirname, "..");

/** Reference pass rates observed on rpci.stratlab.in (2026-08-28 session). */
const REFERENCE: Array<[string, number]> = [
  ["VAL", 0.684],
  ["ERN", 0.268],
  ["MOM", 0.211],
  ["CON", 0.536],
  ["TFA", 0.265],
  ["OPF", 0.429],
  ["INS", 0.087],
  ["STX", 1.0],
  ["LTX", 0.986],
  ["STG", 0.437],
  ["DOW", 0.609],
];

async function main() {
  const store = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "bars.json"), "utf8"));
  const indexBars: Bar[] = store.index.map(([d, c]: [string, number]) => ({ date: d, open: c, high: c, low: c, close: c, volume: 0 }));
  const barsBySymbol = new Map<string, Bar[]>(
    Object.entries(store.stocks as Record<string, Array<[string, number, number, number, number, number]>>).map(
      ([sym, rows]) => [
        sym,
        rows.map(([date, o, h, l, c, v]) => ({ date, open: o, high: h, low: l, close: c, volume: v })),
      ],
    ),
  );
  const FUND_FILE = path.join(ROOT, "data", "fundamentals.json");
  const fundamentals = fs.existsSync(FUND_FILE) ? JSON.parse(fs.readFileSync(FUND_FILE, "utf8")) : {};

  const scan = runScan(UNIVERSE, barsBySymbol, indexBars, fundamentals, UNIVERSE_SNAPSHOT.note);
  console.log(`session ${scan.session}, scored ${scan.breadth.universe}`);
  console.log("");
  console.log("condition  ours   ref    delta");
  let worst = 0;
  scan.conds.forEach((c, i) => {
    const ours = c.n ? c.pass / c.n : 0;
    const ref = REFERENCE[i][1];
    const d = ours - ref;
    worst = Math.max(worst, Math.abs(d));
    console.log(
      `${c.ab.padEnd(9)} ${(ours * 100).toFixed(1).padStart(5)}% ${(ref * 100).toFixed(1).padStart(5)}% ${d >= 0 ? "+" : ""}${((d) * 100).toFixed(1).padStart(5)}pp`,
    );
  });
  console.log("");
  console.log(`worst |delta|: ${(worst * 100).toFixed(1)}pp — target ±5pp`);
  const dist = new Map<number, number>();
  for (const r of scan.rows) dist.set(r.score, (dist.get(r.score) ?? 0) + 1);
  console.log("score distribution:", [...dist.entries()].sort((a, b) => b[0] - a[0]).map(([k, v]) => `${k}:${v}`).join(" "));
}

main();
