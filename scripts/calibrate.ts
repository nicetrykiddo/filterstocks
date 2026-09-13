/**
 * Calibration harness: measures each condition's agreement with the preserved
 * reference payload at the reference session, and grid-searches the calibrated
 * thresholds (VAL bands, ERN floors, CON multiple, OPF margin, MOM cuts)
 * against the reference's published pass/fail bits and pass rates.
 *
 *   tsx scripts/calibrate.ts
 *
 * Recovered formulas (STX, LTX, TFA, INS, STG, DOW) are printed as-is: their
 * thresholds come from the recovery research and are not re-tuned here.
 */
import fs from "node:fs";
import path from "node:path";
import { CONFIG, evaluateAt, precompute, type Pre, type SessionCtx, type StockFundamentals } from "../src/lib/conditions";
import { UNIVERSE } from "../src/lib/universe";
import type { ScanResult } from "../src/lib/types";

const ROOT = path.resolve(__dirname, "..");
const BARS_FILE = path.join(ROOT, "data", "bars.json");
const FUND_FILE = path.join(ROOT, "data", "fundamentals.json");
const REF_DIR = path.join(ROOT, "data", "reference");

interface Store {
  index: Array<[string, number]>;
  stocks: Record<string, Array<[string, number, number, number, number, number]>>;
}

interface Feat {
  sym: string;
  p: Pre;
  i: number;
  indexAt: number;
  fund: StockFundamentals;
  pePct: number | null;
  hiPct: number | null;
  retPct: number | null;
}

function pctRank(sorted: number[], v: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return (lo / Math.max(1, sorted.length)) * 100;
}

async function main() {
  const refFiles = fs.readdirSync(REF_DIR).filter((f) => /^scan-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  if (!refFiles.length) throw new Error("no reference payload in data/reference");
  const ref = JSON.parse(fs.readFileSync(path.join(REF_DIR, refFiles[refFiles.length - 1]), "utf8")) as ScanResult;
  const store: Store = JSON.parse(fs.readFileSync(BARS_FILE, "utf8"));
  const funds = JSON.parse(fs.readFileSync(FUND_FILE, "utf8"));
  const refSession = ref.session;
  const bitsOf = new Map<string, number[]>(
    ref.rows.map((r) => [r.symbol, String(r.st).split("").map((c) => (c === "1" ? 1 : 0))]),
  );
  const indexDates = new Map(store.index.map(([d], i) => [d, i] as const));
  const indexAt = indexDates.get(refSession);
  if (indexAt === undefined) throw new Error(`store lacks reference session ${refSession}`);
  const indexCloses = store.index.map(([, c]) => c);
  console.log(`reference session ${refSession}: ${ref.rows.length} rows, index at ${indexAt}`);

  // ---- features at the reference session ----
  const feats: Feat[] = [];
  for (const u of UNIVERSE) {
    const rows = store.stocks[u.symbol];
    if (!rows?.length || !bitsOf.has(u.symbol)) continue;
    const i = rows.findLastIndex(([d]) => d === refSession);
    if (i === -1) continue;
    const p = precompute(rows.map(([date, o, h, l, c, v]) => ({ date, open: o, high: h, low: l, close: c, volume: v })));
    const f = funds[u.symbol] ?? {};
    feats.push({
      sym: u.symbol,
      p,
      i,
      indexAt,
      fund: {
        pe: typeof f.pe === "number" && f.pe > 0 ? f.pe : null,
        roe: typeof f.roe === "number" ? f.roe : null,
        profitGrowthTtm: typeof f.profitGrowthTtm === "number" ? f.profitGrowthTtm : null,
      },
      pePct: null,
      hiPct: null,
      retPct: null,
    });
  }
  console.log(`features for ${feats.length} names`);

  // Cross-sectional ranks: P/E, 52-week-high proximity, 126-session return.
  const pes = feats.map((f) => f.fund.pe).filter((x): x is number => x !== null).sort((a, b) => a - b);
  const his: number[] = [];
  const rets: number[] = [];
  for (const f of feats) {
    const hi52 = f.p.hi52[f.i];
    if (hi52 !== null && hi52 > 0) his.push(f.p.close[f.i] / hi52);
    if (f.i >= CONFIG.momReturnWindow) rets.push(f.p.close[f.i] / f.p.close[f.i - CONFIG.momReturnWindow] - 1);
  }
  his.sort((a, b) => a - b);
  rets.sort((a, b) => a - b);
  for (const f of feats) {
    if (f.fund.pe !== null) f.pePct = pctRank(pes, f.fund.pe);
    const hi52 = f.p.hi52[f.i];
    if (hi52 !== null && hi52 > 0) f.hiPct = pctRank(his, f.p.close[f.i] / hi52);
    if (f.i >= CONFIG.momReturnWindow) f.retPct = pctRank(rets, f.p.close[f.i] / f.p.close[f.i - CONFIG.momReturnWindow] - 1);
  }

  const agreement = (pred: (f: Feat) => boolean | null, bit: number) => {
    let ok = 0, n = 0, passes = 0;
    for (const f of feats) {
      const v = pred(f);
      if (v === null) continue;
      n++;
      if (v) passes++;
      if (v === (bitsOf.get(f.sym)![bit] === 1)) ok++;
    }
    return { ag: ok / Math.max(1, n), passRate: passes / Math.max(1, n), n };
  };
  const row = (label: string, r: { ag: number; passRate: number; n: number }, target: number) =>
    console.log(
      `  ${label.padEnd(30)} ag ${(r.ag * 100).toFixed(1).padStart(5)}%  pass ${(r.passRate * 100).toFixed(1).padStart(5)}% (ref ${(target * 100).toFixed(1)}%)  n=${r.n}`,
    );

  // ---- TFA clause check: with/without s150>s200 ----
  console.log("\n== 5 TFA clause check ==");
  {
    const tfa = (withLadder: boolean) => (f: Feat) => {
      const c = f.p.close[f.i];
      const s50 = f.p.sma50[f.i], s150 = f.p.sma150[f.i], s200 = f.p.sma200[f.i];
      const s200Prev = f.i >= CONFIG.tfaRisingLag ? f.p.sma200[f.i - CONFIG.tfaRisingLag] : null;
      const hi52 = f.p.hi52[f.i], lo52 = f.p.lo52[f.i];
      if (s50 === null || s150 === null || s200 === null || s200Prev === null || hi52 === null || lo52 === null || lo52 <= 0) return null;
      if (!(c > s50 && c > s150 && c > s200 && s50 > s150)) return false;
      if (withLadder && !(s150 > s200)) return false;
      if (!(s200 > s200Prev)) return false;
      return c >= CONFIG.tfaFromLow * lo52 && c >= CONFIG.tfaFromHigh * hi52;
    };
    row("with s150>s200", agreement(tfa(true), 4), 0.265);
    row("without s150>s200", agreement(tfa(false), 4), 0.265);
  }

  // ---- fixed recovered formulas, as configured ----
  console.log("\n== recovered formulas (fixed) ==");  {
    const ctx: SessionCtx = {
      pePctile: new Map(feats.map((f) => [f.sym, f.pePct ?? -1])),
      momPctile: new Map(feats.map((f) => [f.sym, f.hiPct !== null && f.retPct !== null ? (f.hiPct + f.retPct) / 2 : -1])),
    };
    const counts = new Array(11).fill(0);
    const oks = new Array(11).fill(0);
    const ns = new Array(11).fill(0);
    for (const f of feats) {
      const readings = evaluateAt(f.p, f.i, f.sym, ctx, f.fund, indexCloses, f.indexAt);
      readings.forEach((r, ci) => {
        if (ci <= 1 || ci === 3 || ci === 5) return; // VAL/ERN/CON/OPF handled below
        ns[ci]++;
        if (r.pass === (bitsOf.get(f.sym)![ci] === 1)) oks[ci]++;
        if (r.pass) counts[ci]++;
      });
    }
    ref.labels.forEach((label, ci) => {
      if (ns[ci] === 0) return;
      const refPass = ref.conds[ci].pass / ref.conds[ci].n;
      console.log(
        `  ${String(ci + 1).padStart(2)} ${ref.abbrevs[ci].padEnd(4)} ${label.padEnd(22)} ag ${((oks[ci] / ns[ci]) * 100).toFixed(1).padStart(5)}%  pass ${((counts[ci] / ns[ci]) * 100).toFixed(1).padStart(5)}% (ref ${(refPass * 100).toFixed(1)}%)  n=${ns[ci]}`,
      );
    });
  }

  // ---- CON: ATR% vs its own median ----
  console.log("\n== 4 CON grid (target pass 53.6%) ==");
  {
    const out = [];
    for (let t = 0.78; t <= 1.02; t += 0.01) {
      out.push({ t, ...agreement((f) => {
        const a = f.p.atrPct[f.i], m = f.p.atrPctMed120[f.i];
        return a === null || m === null ? null : a <= m * t;
      }, 3) });
    }
    out.sort((a, b) => Math.abs(a.passRate - 0.536) - Math.abs(b.passRate - 0.536));
    for (const r of out.slice(0, 5)) row(`conRatio <= ${r.t.toFixed(2)}`, r, 0.536);
  }

  // ---- OPF: 252-session excess margin ----
  console.log("\n== 6 OPF grid (target pass 42.9%) ==");
  {
    const out = [];
    for (let m = 0; m <= 12; m += 0.5) {
      out.push({ m, ...agreement((f) => {
        if (f.i < 252 || f.indexAt < 252) return false;
        const sr = f.p.close[f.i] / f.p.close[f.i - 252] - 1;
        const ir = indexCloses[f.indexAt] / indexCloses[f.indexAt - 252] - 1;
        return sr - ir > m / 100;
      }, 5) });
    }
    out.sort((a, b) => Math.abs(a.passRate - 0.429) - Math.abs(b.passRate - 0.429));
    for (const r of out.slice(0, 5)) row(`opfMargin ${r.m.toFixed(1)}pp`, r, 0.429);
  }

  // ---- ERN: growth & ROE floors ----
  console.log("\n== 2 ERN grid (target pass 26.8%) ==");
  {
    const out = [];
    for (const g of [10, 15, 18, 20, 22, 25, 30]) {
      for (const r of [6, 8, 10, 12, 14, 16, 18]) {
        out.push({ g, r, ...agreement((f) =>
          f.fund.profitGrowthTtm !== null && f.fund.roe !== null &&
          f.fund.profitGrowthTtm >= g && f.fund.roe >= r, 1) });
      }
    }
    out.sort((a, b) => Math.abs(a.passRate - 0.268) - Math.abs(b.passRate - 0.268) || b.ag - a.ag);
    for (const x of out.slice(0, 6)) row(`growth>=${x.g} & roe>=${x.r}`, x, 0.268);
  }

  // ---- MOM: combined rank cuts ----
  console.log("\n== 3 MOM grid (target pass 21.1%, very-strong 6.2%) ==");
  {
    for (const combine of ["mean", "min"] as const) {
      const out = [];
      for (let cut = 55; cut <= 97; cut += 1) {
        out.push({ cut, ...agreement((f) => {
          if (f.hiPct === null || f.retPct === null) return false;
          return combine === "mean"
            ? (f.hiPct + f.retPct) / 2 >= cut
            : Math.min(f.hiPct, f.retPct) >= cut;
        }, 2) });
      }
      out.sort((a, b) => Math.abs(a.passRate - 0.211) - Math.abs(b.passRate - 0.211) || b.ag - a.ag);
      for (const x of out.slice(0, 3)) row(`mom ${combine} >= ${x.cut}`, x, 0.211);
    }
  }

  // ---- VAL: P/E percentile bands ----
  console.log("\n== 1 VAL grid (target pass 68.4%) ==");
  {
    const out = [];
    for (const top of [62, 65, 68, 70, 73, 75, 78]) {
      out.push({ top, ...agreement((f) => f.pePct !== null && f.pePct < top, 0) });
    }
    out.sort((a, b) => Math.abs(a.passRate - 0.684) - Math.abs(b.passRate - 0.684) || b.ag - a.ag);
    for (const x of out.slice(0, 5)) row(`pePct < ${x.top}`, x, 0.684);
  }

  // ---- INS: volume multiple x window (our bhavcopy volume basis differs
  // from the reference's, so the recovered 10x is re-derived here) ----
  console.log("\n== 7 INS grid (target pass 8.7%) ==");
  {
    const out = [];
    for (const win of [5, 10, 15, 20]) {
      for (let k = 3; k <= 10; k += 0.5) {
        out.push({ win, k, ...agreement((f) => {
          let cnt = 0;
          const start = Math.max(0, f.i - win + 1);
          for (let j = f.i; j >= start; j--) {
            const o = f.p.open[j], h = f.p.high[j], l = f.p.low[j], cl = f.p.close[j];
            const rng = h - l;
            const vRef = f.p.volSma50[j];
            if (vRef === null || vRef <= 0 || rng <= 0) continue;
            if (cl > o && (cl - l) / rng >= 2 / 3 && f.p.volume[j] >= vRef * k) cnt++;
          }
          return cnt >= 1;
        }, 6) });
      }
    }
    out.sort((a, b) => Math.abs(a.passRate - 0.087) - Math.abs(b.passRate - 0.087) || b.ag - a.ag);
    for (const x of out.slice(0, 8)) row(`last${x.win} vol>=${x.k}x pos>=2/3`, x, 0.087);
  }

  // ---- STG: stage rule variants on weekly averages ----
  console.log("\n== 10 STG variants (target pass 43.7%) ==");
  {
    const ema = (xs: number[], n: number): (number | null)[] => {
      const out: (number | null)[] = new Array(xs.length).fill(null);
      const k = 2 / (n + 1);
      let prev: number | null = null;
      for (let i = 0; i < xs.length; i++) {
        if (i === n - 1) {
          let s = 0;
          for (let j = 0; j < n; j++) s += xs[j];
          prev = s / n;
        } else if (i >= n && prev !== null) {
          prev = xs[i] * k + prev * (1 - k);
        }
        if (prev !== null) out[i] = prev;
      }
      return out;
    };
    const emas = new Map<string, { e30: (number | null)[]; e40: (number | null)[] }>();
    for (const f of feats) {
      if (!emas.has(f.sym)) {
        emas.set(f.sym, { e30: ema(f.p.weeklyClose, 30), e40: ema(f.p.weeklyClose, 40) });
      }
    }
    const out = [];
    const rule = (weeks: number, lag: number, kind: "sma" | "ema") => (f: Feat) => {
      const w = f.p.weekAsOf[f.i];
      if (w < 0) return null;
      const series = kind === "sma"
        ? (weeks === 30 ? f.p.wma30 : f.p.wma40)
        : (weeks === 30 ? emas.get(f.sym)!.e30 : emas.get(f.sym)!.e40);
      const ma = series[w];
      const prev = w - lag >= 0 ? series[w - lag] : null;
      if (ma === null || prev === null) return null;
      return f.p.close[f.i] > ma && ma > prev;
    };
    for (const kind of ["sma", "ema"] as const) {
      for (const weeks of [30, 40] as const) {
        for (const lag of [2, 4, 5, 8, 13]) {
          out.push({ label: `above rising ${weeks}w-${kind} lag=${lag}`, ...agreement(rule(weeks, lag, kind), 9) });
        }
      }
    }
    out.sort((a, b) => Math.abs(a.passRate - 0.437) - Math.abs(b.passRate - 0.437) || b.ag - a.ag);
    for (const x of out.slice(0, 8)) row(x.label, x, 0.437);
  }

  // ---- DOW: primary-trend variants ----
  console.log("\n== 11 DOW variants (target pass 60.9%) ==");
  {
    const out: Array<{ label: string; ag: number; passRate: number; n: number }> = [];
    const wOf = (f: Feat) => f.p.weekAsOf[f.i];
    const maAt = (f: Feat, weeks: number, back: number) => {
      const w = wOf(f) - back;
      return w >= 0 ? (weeks === 30 ? f.p.wma30[w] : f.p.wma40[w]) : null;
    };
    const add = (label: string, pred: (f: Feat) => boolean | null) => out.push({ label, ...agreement(pred, 10) });
    // above-only on each weekly average
    for (const weeks of [20, 30, 40, 50] as const) {
      add(`${weeks}w above-only`, (f) => {
        const ma = maAt(f, weeks, 0);
        if (ma === null && weeks !== 20 && weeks !== 50) return null;
        if (ma === null) return null;
        return f.p.close[f.i] > ma;
      });
    }
    // above + momentum confirmations
    add(`40w above & 20w roc>0`, (f) => {
      const ma = maAt(f, 40, 0);
      const w = wOf(f);
      if (ma === null || w < 20) return null;
      return f.p.close[f.i] > ma && f.p.weeklyClose[w] > f.p.weeklyClose[w - 20];
    });
    add(`40w above & 30w above`, (f) => {
      const ma40 = maAt(f, 40, 0), ma30 = maAt(f, 30, 0);
      if (ma40 === null || ma30 === null) return null;
      return f.p.close[f.i] > ma40 && f.p.close[f.i] > ma30;
    });
    add(`40w above & 30w rising`, (f) => {
      const ma40 = maAt(f, 40, 0), ma30 = maAt(f, 30, 0), ma30p = maAt(f, 30, 5);
      if (ma40 === null || ma30 === null || ma30p === null) return null;
      return f.p.close[f.i] > ma40 && ma30 > ma30p;
    });
    add(`40w above & rising`, (f) => {
      const ma = maAt(f, 40, 0), prev = maAt(f, 40, 5);
      if (ma === null || prev === null) return null;
      return f.p.close[f.i] > ma && ma > prev;
    });
    out.sort((a, b) => Math.abs(a.passRate - 0.609) - Math.abs(b.passRate - 0.609) || b.ag - a.ag);
    for (const x of out.slice(0, 10)) row(x.label, x, 0.609);
  }

  // ---- MOM very-strong tier: target 6.2% of the universe ----
  console.log("\n== 3 MOM very-strong tier (target pass 6.2%) ==");
  {
    const out = [];
    for (let cut = 80; cut <= 97; cut += 0.5) {
      out.push({ cut, ...agreement((f) => {
        if (f.hiPct === null || f.retPct === null) return false;
        return (f.hiPct + f.retPct) / 2 >= cut;
      }, 2) });
    }
    out.sort((a, b) => Math.abs(a.passRate - 0.062) - Math.abs(b.passRate - 0.062));
    for (const x of out.slice(0, 5)) row(`mom mean >= ${x.cut}`, x, 0.062);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
