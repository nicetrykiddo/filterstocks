/**
 * Formula recovery harness, pass 2.
 *
 * The condition names (Price Contraction, Timeframe Alignment,
 * Outperformance, Institutional Candles, Stage Analysis) map to the
 * Minervini / Weinstein system: Trend Template, VCP, RS, accumulation
 * candles and Stage Analysis. This grids those hypothesis families against
 * the published bits and reports agreement, precision/recall and achieved
 * pass rate for each candidate.
 */
import fs from "node:fs";
import path from "node:path";
import { precompute, momentumScore, type Pre } from "../src/lib/conditions";
import type { Bar } from "../src/lib/types";

const ROOT = path.resolve(__dirname, "..");
const SCAN_FILE = path.join(ROOT, "public", "scan.json");
const BARS_FILE = path.join(ROOT, "data", "bars.json");
const FUND_FILE = path.join(ROOT, "data", "fundamentals.json");

interface Store {
  index: Array<[string, number]>;
  stocks: Record<string, Array<[string, number, number, number, number, number]>>;
}
interface Label {
  sym: string;
  bits: number[];
  res: string[];
}

interface Feat {
  sym: string;
  pe: number | null;
  roe: number | null;
  growth: number | null;
  pePct: number | null;
  // closes-based series for indicator computations
  c: number;
  // momentum candidates
  r21: number | null;
  r63: number | null;
  r126: number | null;
  r252: number | null;
  r63x: number | null;
  r126x: number | null;
  r252ex: number | null;
  // MAs
  s20: number | null;
  s50: number | null;
  s150: number | null;
  s200: number | null;
  e20: number | null;
  e50: number | null;
  e150: number | null;
  e200: number | null;
  s150r: boolean;
  s200r: boolean;
  // 52-week
  hi52: number | null;
  lo52: number | null;
  hi52dist: number | null; // c / 52w high
  lo52dist: number | null; // c / 52w low
  // contraction
  con120: number | null;
  con63: number | null;
  con250: number | null;
  rangeFrac: number | null; // today range / max range of last 10
  atrPctNow: number | null;
  atrPctMed63: number | null;
  // extension
  rsi: number | null;
  cS20Atr: number | null;
  cS50ratio: number | null;
  cE50ratio: number | null;
  // stage / weekly
  wma30: number | null;
  wma30p: number | null;
  ewa30: number | null;
  ewa30p: number | null;
  rs10: number | null;
  idx10: number | null;
  wkHigh: number[];
  wkLow: number[];
  wkClose: number[];
  dowRoc20: number | null;
  wkmacd: number | null; // weekly MACD(12,26,9) histogram sign at last week
  // ins
  ins: Array<{ up: boolean; closePos: number; volRatio: number; abovePrevHigh: boolean }>;
  momExcess: number | null;
}

const INS_LOOKBACK = 20;

function ema(xs: number[], n: number): (number | null)[] {
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
}

function pctRank(sorted: number[], v: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return (lo / sorted.length) * 100;
}

function macdHist(closes: number[]): number | null {
  const n = closes.length;
  if (n < 26) return null;
  const e12 = ema(closes, 12)[n - 1];
  const e26 = ema(closes, 26)[n - 1];
  const sig = e12 !== null && e26 !== null ? e12 - e26 : null;
  return sig;
}

function main() {
  const labels: Label[] = (() => {
    const scan = JSON.parse(fs.readFileSync(SCAN_FILE, "utf8"));
    return scan.rows.map((r: Record<string, unknown>) => ({
      sym: r.symbol as string,
      bits: String(r.st).split("").map((c) => (c === "1" ? 1 : 0)),
      res: (r.res as string[]) ?? [],
    }));
  })();
  const store: Store = JSON.parse(fs.readFileSync(BARS_FILE, "utf8"));
  const funds = JSON.parse(fs.readFileSync(FUND_FILE, "utf8"));
  const indexBars: Bar[] = store.index.map(([d, c]) => ({ date: d, open: c, high: c, low: c, close: c, volume: 0 }));
  const indexCloses = indexBars.map((b) => b.close);
  const session = indexBars[indexBars.length - 1].date;
  console.log(`labels ${labels.length}, index through ${session}`);

  const feats = new Map<string, Feat>();
  for (const l of labels) {
    const bars = store.stocks[l.sym];
    if (!bars || bars.length < 200) continue;
    if (bars[bars.length - 1][0] !== session) continue;
    const p: Pre = precompute(
      bars.map(([date, o, h, lo, c, v]) => ({ date, open: o, high: h, low: lo, close: c, volume: v })),
    );
    const i = bars.length - 1;
    const closes = p.close;
    const r21 = i >= 21 ? closes[i] / closes[i - 21] - 1 : null;
    const r63 = i >= 63 ? closes[i] / closes[i - 63] - 1 : null;
    const r126 = i >= 126 ? closes[i] / closes[i - 126] - 1 : null;
    const r252 = i >= 252 ? closes[i] / closes[i - 252] - 1 : null;
    const ix = indexCloses.length - 1;
    const r63x = r63 !== null && ix >= 63 ? r63 - (indexCloses[ix] / indexCloses[ix - 63] - 1) : null;
    const r126x = r126 !== null && ix >= 126 ? r126 - (indexCloses[ix] / indexCloses[ix - 126] - 1) : null;
    const r252ex = r252 !== null && ix >= 252 ? (r252 - (indexCloses[ix] / indexCloses[ix - 252] - 1)) * 100 : null;

    const s20 = p.sma20[i];
    const s50 = p.sma50[i];
    const s150 = p.sma150[i];
    const s200 = p.sma200[i];
    const e20A = ema(closes, 20);
    const e50A = ema(closes, 50);
    const e150A = ema(closes, 150);
    const e200A = ema(closes, 200);

    const hi52 = i >= 250 ? Math.max(...closes.slice(i - 250, i + 1)) : null;
    const lo52 = i >= 250 ? Math.min(...closes.slice(i - 250, i + 1)) : null;

    const wIdx = p.weekAsOf[i];
    const wma30 = wIdx >= 0 ? p.wma30[wIdx] : null;
    const wma30p = wIdx - 5 >= 0 ? p.wma30[wIdx - 5] : null;
    const wkE30 = ema(p.weeklyClose, 30);
    const ewa30 = wIdx >= 0 ? wkE30[wIdx] : null;
    const ewa30p = wIdx - 5 >= 0 ? wkE30[wIdx - 5] : null;
    const rs10 = wIdx >= 10 ? p.weeklyClose[wIdx] / p.weeklyClose[wIdx - 10] - 1 : null;
    const idx10 = ix >= 50 ? indexCloses[ix] / indexCloses[ix - 50] - 1 : null;

    const ins: Feat["ins"] = [];
    for (let j = Math.max(1, i - INS_LOOKBACK + 1); j <= i; j++) {
      const o = p.open[j];
      const h = p.high[j];
      const lo = p.low[j];
      const cl = p.close[j];
      const rng = h - lo;
      const vRef = p.volSma50[j];
      ins.push({
        up: cl > o,
        closePos: rng > 0 ? (cl - lo) / rng : 0,
        volRatio: vRef !== null && vRef > 0 ? p.volume[j] / vRef : 0,
        abovePrevHigh: j > 0 && cl > p.high[j - 1],
      });
    }

    let rangeFrac: number | null = null;
    if (i >= 10) {
      let mx = 0;
      for (let j = i - 9; j <= i; j++) mx = Math.max(mx, p.high[j] - p.low[j]);
      if (mx > 0) rangeFrac = (p.high[i] - p.low[i]) / mx;
    }

    feats.set(l.sym, {
      sym: l.sym,
      pe: typeof funds[l.sym]?.pe === "number" && funds[l.sym].pe > 0 ? funds[l.sym].pe : null,
      roe: typeof funds[l.sym]?.roe === "number" && funds[l.sym].roe > 0 ? funds[l.sym].roe : null,
      growth: typeof funds[l.sym]?.profitGrowthTtm === "number" ? funds[l.sym].profitGrowthTtm : null,
      pePct: null,
      c: closes[i],
      r21,
      r63,
      r126,
      r252,
      r63x: r63x !== null ? r63x * 100 : null,
      r126x: r126x !== null ? r126x * 100 : null,
      r252ex,
      s20,
      s50,
      s150,
      s200,
      e20: e20A[i],
      e50: e50A[i],
      e150: e150A[i],
      e200: e200A[i],
      s150r: s150 !== null && p.sma150[i - 20] !== null && s150 > p.sma150[i - 20]!,
      s200r: s200 !== null && p.sma200[i - 20] !== null && s200 > p.sma200[i - 20]!,
      hi52,
      lo52,
      hi52dist: hi52 !== null && hi52 > 0 ? closes[i] / hi52 : null,
      lo52dist: lo52 !== null && lo52 > 0 ? closes[i] / lo52 : null,
      con120: p.atrPct[i] !== null && p.atrPctMed120[i] !== null ? p.atrPct[i]! / p.atrPctMed120[i]! : null,
      con63: null,
      con250: null,
      rangeFrac,
      atrPctNow: p.atrPct[i],
      atrPctMed63: null,
      rsi: p.rsi14[i],
      cS20Atr: p.atr14[i] !== null && p.atr14[i]! > 0 && s20 !== null ? (closes[i] - s20) / p.atr14[i]! : null,
      cS50ratio: s50 !== null && s50 > 0 ? closes[i] / s50 : null,
      cE50ratio: e50A[i] !== null && e50A[i]! > 0 ? closes[i] / e50A[i]! : null,
      wma30,
      wma30p,
      ewa30,
      ewa30p,
      rs10,
      idx10,
      wkHigh: p.weeklyHigh.slice(0, wIdx + 1),
      wkLow: p.weeklyLow.slice(0, wIdx + 1),
      wkClose: p.weeklyClose.slice(0, wIdx + 1),
      dowRoc20: wIdx >= 20 ? p.weeklyClose[wIdx] / p.weeklyClose[wIdx - 20] - 1 : null,
      wkmacd: macdHist(p.weeklyClose.slice(0, wIdx + 1)),
      ins,
      momExcess: momentumScore(p, i, indexCloses, ix),
    });
  }
  console.log(`features for ${feats.size} symbols`);

  const pes = [...feats.values()].map((f) => f.pe).filter((x): x is number => x !== null);
  pes.sort((a, b) => a - b);
  for (const f of feats.values()) if (f.pe !== null) f.pePct = pctRank(pes, f.pe);

  // 63/250-day contraction medians
  {
    const atrPctSeries = new Map<string, number[]>();
    for (const l of labels) {
      const bars = store.stocks[l.sym];
      if (!bars || bars.length < 200) continue;
      if (bars[bars.length - 1][0] !== session) continue;
      const p = precompute(bars.map(([date, o, h, lo, c, v]) => ({ date, open: o, high: h, low: lo, close: c, volume: v })));
      const i = bars.length - 1;
      atrPctSeries.set(l.sym, p.atrPct.slice(Math.max(0, i - 250), i + 1).filter((x): x is number => x !== null));
    }
    for (const f of feats.values()) {
      const s = atrPctSeries.get(f.sym);
      if (!s?.length || f.atrPctNow === null) continue;
      const med = (arr: number[]) => {
        const a = [...arr].sort((x, y) => x - y);
        return a[Math.floor(a.length / 2)];
      };
      const last63 = s.slice(-63);
      const last250 = s.slice(-250);
      f.atrPctMed63 = med(last63);
      f.con63 = f.atrPctNow / f.atrPctMed63;
      f.con250 = f.atrPctNow / med(last250);
    }
  }

  const labeled = labels.filter((l) => feats.has(l.sym));
  console.log(`labeled with features: ${labeled.length}`);

  const stat = (pred: (f: Feat) => number | null, bitIdx: number) => {
    let ok = 0;
    let n = 0;
    let tp = 0;
    let fp = 0;
    let fn = 0;
    let passes = 0;
    for (const l of labeled) {
      const v = pred(feats.get(l.sym)!);
      if (v === null) continue;
      n++;
      if (v === 1) passes++;
      const want = l.bits[bitIdx];
      if (v === want) ok++;
      if (v === 1 && want === 1) tp++;
      if (v === 1 && want === 0) fp++;
      if (v === 0 && want === 1) fn++;
    }
    return {
      ok,
      n,
      ag: ok / Math.max(1, n),
      pr: tp / Math.max(1, tp + fp),
      rec: tp / Math.max(1, tp + fn),
      passRate: passes / Math.max(1, n),
    };
  };
  const show = (name: string, bitIdx: number, results: Array<{ label: string } & ReturnType<typeof stat>>) => {
    results.sort((a, b) => b.ag - a.ag);
    console.log(`\n== ${name} ==  (label pass rate: ${(labeled.filter((l) => l.bits[bitIdx]).length / labeled.length * 100).toFixed(1)}%)`);
    for (const r of results.slice(0, 5)) {
      console.log(
        `  ag ${(r.ag * 100).toFixed(2)}% (${r.ok}/${r.n})  pr ${(r.pr * 100).toFixed(0)}% rec ${(r.rec * 100).toFixed(0)}% passRate ${(r.passRate * 100).toFixed(1)}%  ${r.label}`,
      );
    }
  };

  // ---------- TFA: Minervini trend template ----------
  {
    const out = [];
    const clauses: Array<[string, (f: Feat) => boolean | null]> = [
      ["c>s50", (f) => f.s50 !== null && f.c > f.s50],
      ["c>s150", (f) => f.s150 !== null && f.c > f.s150],
      ["c>s200", (f) => f.s200 !== null && f.c > f.s200],
      ["s50>s150", (f) => f.s50 !== null && f.s150 !== null && f.s50 > f.s150],
      ["s150>s200", (f) => f.s150 !== null && f.s200 !== null && f.s150 > f.s200],
      ["s150 rising", (f) => f.s150r],
      ["s200 rising", (f) => f.s200r],
      ["c>=1.3*52wLo", (f) => f.lo52dist !== null && f.lo52dist >= 1.3],
      ["c>=0.75*52wHi", (f) => f.hi52dist !== null && f.hi52dist >= 0.75],
      ["c>=0.85*52wHi", (f) => f.hi52dist !== null && f.hi52dist >= 0.85],
      ["c>e50", (f) => f.e50 !== null && f.c > f.e50],
      ["c>e150", (f) => f.e150 !== null && f.c > f.e150],
      ["c>e200", (f) => f.e200 !== null && f.c > f.e200],
      ["e50>e150", (f) => f.e50 !== null && f.e150 !== null && f.e50 > f.e150],
      ["e150>e200", (f) => f.e150 !== null && f.e200 !== null && f.e150 > f.e200],
      ["c>wma30", (f) => f.wma30 !== null && f.c > f.wma30],
      ["wma30 rising", (f) => f.wma30 !== null && f.wma30p !== null && f.wma30 > f.wma30p],
      ["c>ewa30", (f) => f.ewa30 !== null && f.c > f.ewa30],
      ["ewa30 rising", (f) => f.ewa30 !== null && f.ewa30p !== null && f.ewa30 > f.ewa30p],
    ];
    // full template + each drop-one + key variants
    const full = [0, 1, 2, 3, 4, 6, 7, 8];
    const variants: number[][] = [full];
    for (const drop of full) variants.push(full.filter((x) => x !== drop));
    variants.push([0, 1, 2, 3, 4, 6, 7]); // no 52w hi requirement
    variants.push([0, 1, 2, 3, 4, 5, 7, 8]);
    variants.push([0, 2, 3, 4, 6, 7, 8]); // drop c>s150
    variants.push([1, 2, 4, 6, 7, 8]); // minimal MA ladder
    variants.push([0, 1, 2, 3, 4, 6, 7, 8, 15, 16]); // + weekly rising
    variants.push([0, 1, 2, 3, 4, 6, 7, 8, 17, 18]); // + weekly ema rising
    variants.push([15, 16]); // weekly only
    variants.push([0, 1, 2, 3, 4, 5, 6, 7, 8]); // + s150 rising
    for (const v of variants) {
      const r = stat((f) => {
        for (const ci of v) {
          const hold = clauses[ci][1](f);
          if (hold === null) return null;
          if (!hold) return 0;
        }
        return 1;
      }, 4);
      out.push({ label: v.map((ci) => clauses[ci][0]).join(" & "), ...r });
    }
    show("5 TFA Timeframe Alignment", 4, out);
  }

  // ---------- OPF ----------
  {
    const out = [];
    const series: Array<[string, (f: Feat) => number | null]> = [
      ["252ex>0", (f) => (f.r252ex === null ? null : f.r252ex > 0 ? 1 : 0)],
      ["r252>0", (f) => (f.r252 === null ? null : f.r252 > 0 ? 1 : 0)],
      ["r126>0", (f) => (f.r126 === null ? null : f.r126 > 0 ? 1 : 0)],
      ["hi52dist>=0.9", (f) => (f.hi52dist === null ? null : f.hi52dist >= 0.9 ? 1 : 0)],
      ["hi52dist>=0.85", (f) => (f.hi52dist === null ? null : f.hi52dist >= 0.85 ? 1 : 0)],
      ["hi52dist>=0.8", (f) => (f.hi52dist === null ? null : f.hi52dist >= 0.8 ? 1 : 0)],
      ["r252>0 & 252ex>0", (f) => (f.r252 === null || f.r252ex === null ? null : f.r252 > 0 && f.r252ex > 0 ? 1 : 0)],
    ];
    for (const [label, pred] of series) {
      out.push({ label, ...stat(pred, 5) });
    }
    // percentile cut on 252-day excess
    const vals = [...feats.values()].map((f) => f.r252ex).filter((x): x is number => x !== null);
    vals.sort((a, b) => a - b);
    for (const cut of [50, 55, 60, 65, 70]) {
      const r = stat((f) => (f.r252ex === null ? null : pctRank(vals, f.r252ex) >= cut ? 1 : 0), 5);
      out.push({ label: `r252ex pct>=${cut}`, ...r });
    }
    const absVals = [...feats.values()].map((f) => f.r252).filter((x): x is number => x !== null);
    absVals.sort((a, b) => a - b);
    for (const cut of [55, 60, 65, 70]) {
      const r = stat((f) => (f.r252 === null ? null : pctRank(absVals, f.r252) >= cut ? 1 : 0), 5);
      out.push({ label: `r252 pct>=${cut}`, ...r });
    }
    // RS hybrid: 12m return > index AND 12m return > universe median
    const med252 = absVals[Math.floor(absVals.length / 2)];
    out.push({
      label: "r252>0 & r252>median & 252ex>0",
      ...stat((f) => (f.r252 === null || f.r252ex === null ? null : f.r252 > 0 && f.r252 > med252 && f.r252ex > 0 ? 1 : 0), 5),
    });
    out.push({
      label: "r252>median",
      ...stat((f) => (f.r252 === null ? null : f.r252 > med252 ? 1 : 0), 5),
    });
    show("6 OPF Outperformance", 5, out);
  }

  // ---------- MOM ----------
  {
    const out = [];
    const series: Array<[string, (f: Feat) => number | null]> = [
      ["r63x", (f) => f.r63x],
      ["r126x", (f) => f.r126x],
      ["r63", (f) => (f.r63 === null ? null : f.r63 * 100)],
      ["r126", (f) => (f.r126 === null ? null : f.r126 * 100)],
      ["mean(r63x,r126x)", (f) => (f.r63x === null || f.r126x === null ? null : (f.r63x + f.r126x) / 2)],
      ["mean(r63,r126)", (f) => (f.r63 === null || f.r126 === null ? null : (f.r63 + f.r126) / 2 * 100)],
      ["hi52dist", (f) => f.hi52dist],
      ["r252ex", (f) => f.r252ex],
    ];
    for (const [name, get] of series) {
      const vals = [...feats.values()].map((f) => get(f)).filter((x): x is number => x !== null);
      vals.sort((a, b) => a - b);
      for (const cut of [55, 60, 65, 70, 75, 80, 85, 90, 95]) {
        const r = stat((f) => {
          const v = get(f);
          if (v === null) return null;
          return pctRank(vals, v) >= cut ? 1 : 0;
        }, 2);
        out.push({ label: `${name} pct>=${cut}`, ...r });
      }
    }
    // hybrid: proximity + return
    const hiVals = [...feats.values()].map((f) => f.hi52dist).filter((x): x is number => x !== null);
    hiVals.sort((a, b) => a - b);
    const r126Vals = [...feats.values()].map((f) => f.r126).filter((x): x is number => x !== null);
    r126Vals.sort((a, b) => a - b);
    for (const hCut of [70, 80, 85, 90]) {
      for (const rCut of [50, 60, 70]) {
        const r = stat((f) => {
          if (f.hi52dist === null || f.r126 === null) return null;
          return pctRank(hiVals, f.hi52dist) >= hCut && pctRank(r126Vals, f.r126) >= rCut ? 1 : 0;
        }, 2);
        out.push({ label: `hi52 pct>=${hCut} & r126 pct>=${rCut}`, ...r });
      }
    }
    show("3 MOM Momentum", 2, out);
  }

  // ---------- CON ----------
  {
    const out = [];
    for (const [name, get] of [
      ["con120", (f: Feat) => f.con120],
      ["con63", (f: Feat) => f.con63],
      ["con250", (f: Feat) => f.con250],
      ["rangeFrac", (f: Feat) => f.rangeFrac],
    ] as Array<[string, (f: Feat) => number | null]>) {
      for (let t = 0.3; t <= 1.2; t += 0.025) {
        const r = stat((f) => {
          const v = get(f);
          if (v === null) return null;
          return v <= t ? 1 : 0;
        }, 3);
        out.push({ label: `${name}<=${t.toFixed(2)}`, ...r });
      }
    }
    // VCP-style weekly contraction: count of contracting weekly ranges in
    // the last N weeks, tight week = range < f x previous week's range.
    {
      const weeklyRanges = new Map<string, Array<{ hi: number; lo: number; vol: number }>>();
      for (const l of labels) {
        const bars = store.stocks[l.sym];
        if (!bars || bars.length < 200) continue;
        if (bars[bars.length - 1][0] !== session) continue;
        const p = precompute(bars.map(([date, o, h, lo, c, v]) => ({ date, open: o, high: h, low: lo, close: c, volume: v })));
        weeklyRanges.set(l.sym, p.weeklyHigh.map((hi, wi) => ({ hi, lo: p.weeklyLow[wi], vol: 0 })));
      }
      for (const n of [5, 8, 13]) {
        for (const frac of [0.4, 0.5, 0.6]) {
          for (const need of [2, 3, 4]) {
            const r = stat((f) => {
              const w = weeklyRanges.get(f.sym);
              if (!w || w.length < n + 1) return null;
              let cnt = 0;
              for (let j = w.length - n; j < w.length; j++) {
                const prev = w[j - 1];
                const cur = w[j];
                if ((cur.hi - cur.lo) < frac * (prev.hi - prev.lo)) cnt++;
              }
              return cnt >= need ? 1 : 0;
            }, 3);
            out.push({ label: `wkContract last${n} frac<${frac} need${need}`, ...r });
          }
        }
      }
    }
    show("4 CON Contraction", 3, out);
  }

  // ---------- STG ----------
  {
    const out = [];
    const defs: Array<[string, (f: Feat) => number | null]> = [
      ["above30w & rising30w", (f) => (f.wma30 === null || f.wma30p === null ? null : f.c > f.wma30 && f.wma30 > f.wma30p ? 1 : 0)],
      ["above & rising & rs10>0", (f) => (f.wma30 === null || f.wma30p === null || f.rs10 === null ? null : f.c > f.wma30 && f.wma30 > f.wma30p && f.rs10 > 0 ? 1 : 0)],
      ["above & rising & rs10>idx10", (f) => (f.wma30 === null || f.wma30p === null || f.rs10 === null || f.idx10 === null ? null : f.c > f.wma30 && f.wma30 > f.wma30p && f.rs10 > f.idx10 ? 1 : 0)],
      ["above30e & rising30e", (f) => (f.ewa30 === null || f.ewa30p === null ? null : f.c > f.ewa30 && f.ewa30 > f.ewa30p ? 1 : 0)],
      ["above30e & rising30e & rs10>0", (f) => (f.ewa30 === null || f.ewa30p === null || f.rs10 === null ? null : f.c > f.ewa30 && f.ewa30 > f.ewa30p && f.rs10 > 0 ? 1 : 0)],
      ["wkmacd>0 & above30w", (f) => (f.wkmacd === null || f.wma30 === null ? null : f.wkmacd > 0 && f.c > f.wma30 ? 1 : 0)],
    ];
    for (const [label, pred] of defs) out.push({ label, ...stat(pred, 9) });
    show("10 STG Stage Analysis", 9, out);
  }

  // ---------- DOW ----------
  {
    const out = [];
    const pivots = (xs: number[], k: number, high: boolean) => {
      const arr: number[] = [];
      for (let i = k; i < xs.length - k; i++) {
        let ok = true;
        for (let j = i - k; j <= i + k; j++) {
          if (j === i) continue;
          if (high ? xs[j] > xs[i] : xs[j] < xs[i]) {
            ok = false;
            break;
          }
        }
        if (ok) arr.push(xs[i]);
      }
      return arr;
    };
    for (const lookback of [13, 26, 39, 52]) {
      for (const pk of [1, 2, 3]) {
        // strict HH/HL rule
        const r1 = stat((f) => {
          const n = f.wkClose.length;
          if (n < lookback) return null;
          const from = n - lookback;
          const ph = pivots(f.wkHigh.slice(from), pk, true);
          const pl = pivots(f.wkLow.slice(from), pk, false);
          if (ph.length < 2 || pl.length < 2) return 0;
          return ph[ph.length - 1] > ph[ph.length - 2] && pl[pl.length - 1] > pl[pl.length - 2] ? 1 : 0;
        }, 10);
        out.push({ label: `HH/HL strict lb=${lookback} pk=${pk}`, ...r1 });
        // roc gate on top
        const r2 = stat((f) => {
          const n = f.wkClose.length;
          if (n < lookback) return null;
          const from = n - lookback;
          const ph = pivots(f.wkHigh.slice(from), pk, true);
          const pl = pivots(f.wkLow.slice(from), pk, false);
          if (ph.length < 2 || pl.length < 2) return 0;
          return ph[ph.length - 1] > ph[ph.length - 2] && pl[pl.length - 1] > pl[pl.length - 2] && f.dowRoc20 !== null && f.dowRoc20 > 0 ? 1 : 0;
        }, 10);
        out.push({ label: `HH/HL & roc20>0 lb=${lookback} pk=${pk}`, ...r2 });
      }
    }
    // weekly CLOSE structure: higher closes stepwise
    for (const step of [5, 10, 20]) {
      const r = stat((f) => {
        const n = f.wkClose.length;
        if (n < step * 2) return null;
        const c1 = f.wkClose[n - 1];
        const c2 = f.wkClose[n - 1 - step];
        const c3 = f.wkClose[n - 1 - step * 2];
        return c1 > c2 && c2 > c3 ? 1 : 0;
      }, 10);
      out.push({ label: `wkClose HH step=${step}`, ...r });
    }
    // 40wk MA rising & above
    {
      const r = stat((f) => {
        const n = f.wkClose.length;
        if (n < 45) return null;
        const w = f.wkClose;
        const avg = (a: number, b: number) => w.slice(a, b).reduce((x, y) => x + y, 0) / (b - a);
        const now = avg(n - 40, n);
        const prev = avg(n - 45, n - 5);
        return f.c > now && now > prev ? 1 : 0;
      }, 10);
      out.push({ label: "above rising 40wkMA", ...r });
    }
    show("11 DOW Dow Theory (W)", 10, out);
  }

  // ---------- INS refined ----------
  {
    const out = [];
    for (const n of [5, 10, 15, 20]) {
      for (const k of [8, 9, 10, 11, 12]) {
        for (const aboveHigh of [false, true]) {
          const r = stat((f) => {
            let cnt = 0;
            for (let j = 0; j < n && j < f.ins.length; j++) {
              const d = f.ins[j];
              const ok = d.up && d.closePos >= 2 / 3 && d.volRatio >= k && (!aboveHigh || d.abovePrevHigh);
              if (ok) cnt++;
            }
            return cnt >= 1 ? 1 : 0;
          }, 6);
          out.push({ label: `last${n} vol>=${k}x pos>=.67${aboveHigh ? " abovePrevHigh" : ""}`, ...r });
        }
      }
    }
    show("7 INS Institutional Candles", 6, out);
  }

  // ---------- STX/LTX fine ----------
  {
    const out = [];
    for (const r of [83, 84, 85, 86, 87]) {
      for (const a of [5, 5.5, 6]) {
        const res = stat((f) => {
          const ext = (f.rsi !== null && f.rsi >= r) || (f.cS20Atr !== null && f.cS20Atr >= a);
          return ext ? 0 : 1;
        }, 7);
        out.push({ label: `rsi>=${r} OR c>=s20+${a}ATR`, ...res });
      }
    }
    show("8 STX Short-term Extension", 7, out);
  }
  {
    const out = [];
    for (const t of [1.25, 1.28, 1.3, 1.31, 1.32, 1.35]) {
      const r = stat((f) => (f.cS50ratio === null ? null : f.cS50ratio >= t ? 0 : 1), 8);
      out.push({ label: `c>=s50*${t}`, ...r });
      const r2 = stat((f) => (f.cE50ratio === null ? null : f.cE50ratio >= t ? 0 : 1), 8);
      out.push({ label: `c>=e50*${t}`, ...r2 });
    }
    show("9 LTX Long-term Extension", 8, out);
  }

  // ---------- VAL / ERN ----------
  {
    const out = [];
    for (const [p1, p2] of [[20, 60], [30, 60], [30, 65], [35, 65], [40, 70], [25, 55]] as Array<[number, number]>) {
      const r = stat((f) => {
        if (f.pe === null || f.pePct === null) return 0;
        return f.pePct < p1 || f.pePct < p2 ? 1 : 0;
      }, 0);
      out.push({ label: `pePct<${p1} or <${p2}`, ...r });
    }
    for (const [a, b] of [[10, 30], [15, 30], [15, 40], [20, 40], [10, 50]] as Array<[number, number]>) {
      const r = stat((f) => (f.pe === null ? 0 : f.pe < a || f.pe < b ? 1 : 0), 0);
      out.push({ label: `pe<${a} or pe<${b}`, ...r });
    }
    show("1 VAL Valuation", 0, out);
  }
  {
    const out = [];
    for (const g of [15, 20, 25, 30, 40]) {
      for (const r of [0, 5, 10, 15]) {
        const pred = stat((f) => {
          if (f.growth === null || f.roe === null) return null;
          return f.growth >= g && f.roe >= r ? 1 : 0;
        }, 1);
        out.push({ label: `growth>=${g} & roe>=${r}`, ...pred });
      }
    }
    show("2 ERN Earnings Power", 1, out);
  }
}

main();
