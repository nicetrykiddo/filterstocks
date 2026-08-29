import type { Bar, ConditionDoc } from "./types";
import { fractalPivots, median, rsi, sma, atr } from "./indicators";

/**
 * The scan reads every stock against eleven conditions each session: two
 * fundamental checks, one relative-momentum check, and eight price/volume
 * structure checks. Each pass is one point; the score is the sum (0–11).
 *
 * The result vocabulary (Undervalued, Stage 2 - Uptrend, …) matches the
 * reference dashboard this scan reproduces; the formulas underneath are this
 * repo's own, documented openly here because the reference keeps them
 * private. Thresholds are calibrated so per-condition pass rates track the
 * reference's published distribution (scripts/calibrate.ts).
 */

export const COND_DOCS: ConditionDoc[] = [
  {
    key: "val",
    label: "Valuation",
    abbrev: "VAL",
    slug: "valuation",
    short: "Trailing P/E against the universe, in thirds.",
    detail:
      "The stock's trailing P/E (Screener.in, refreshed weekly) is ranked against every other scanned name. The cheapest third reads Undervalued, the middle third Reasonably valued, the richest third Overvalued. Names with no P/E — losses, blank filings — read N/A and cannot pass.",
  },
  {
    key: "ern",
    label: "Earnings Power",
    abbrev: "ERN",
    slug: "earnings_power",
    short: "Profit growth and returns on equity, together.",
    detail:
      "Strong requires trailing-twelve-month profit growth of at least the calibrated floor AND return on equity at or above the calibrated floor. Both come from the weekly fundamentals cache. Either falling short reads Weak.",
  },
  {
    key: "mom",
    label: "Momentum",
    abbrev: "MOM",
    slug: "momentum",
    short: "Blended 3- and 6-month excess return vs the index.",
    detail:
      "The average of the stock's 63-session and 126-session returns minus the Nifty 50's over the same windows. Ranked across the universe: the top decile reads Very Strong momentum, roughly the next sixth reads Strong momentum, everything else Weak momentum.",
  },
  {
    key: "con",
    label: "Price Contraction",
    abbrev: "CON",
    slug: "price_contraction",
    short: "ATR% below its own six-month norm.",
    detail:
      "The 14-session ATR as a percentage of price, divided by its own median over the last 120 sessions. At or below parity the day ranges are shrinking relative to their recent norm — supply and demand are agreeing on smaller increments.",
  },
  {
    key: "tfa",
    label: "Timeframe Alignment",
    abbrev: "TFA",
    slug: "timeframe_alignment",
    short: "Daily and weekly averages stacked upward.",
    detail:
      "On the daily tape the close sits above the 20- and 50-day averages with the 20 above the 50 and the 50 above the 150; on the weekly tape the close sits above a rising 30-week average. Both timeframes agree, or the condition fails.",
  },
  {
    key: "opf",
    label: "Outperformance",
    abbrev: "OPF",
    slug: "outperformance",
    short: "Twelve-month return ahead of the index.",
    detail:
      "The 252-session return minus the Nifty 50's over the same span, cleared by a small calibrated margin so noise around zero does not pass. Positive means the name beat the index it competes with for capital.",
  },
  {
    key: "ins",
    label: "Institutional Candles",
    abbrev: "INS",
    slug: "institutional_candles",
    short: "High-volume bullish days in the last ten sessions.",
    detail:
      "A candle qualifies when it closes up, closes in the top third of its range, and trades at least the calibrated multiple of its 50-day volume — the footprint of size leaning on the offer. The reading is the count over ten sessions; anything above zero passes.",
  },
  {
    key: "stx",
    label: "Short-term Extension",
    abbrev: "STX",
    slug: "st_extension",
    short: "Not stretched above the 20-day average.",
    detail:
      "Fails when RSI(14) reaches the calibrated ceiling or the close stands more than two ATRs above the 20-day average — a pullback-prone stretch. It passes almost every name almost every night, which is the point: when it does fail, it matters.",
  },
  {
    key: "ltx",
    label: "Long-term Extension",
    abbrev: "LTX",
    slug: "lt_extension",
    short: "Not parabolic above the 50-day average.",
    detail:
      "Fails when the close stands more than the calibrated percentage above its 50-day average. Vertical moves mean-revert before bases can form; the condition refuses to score them while they last.",
  },
  {
    key: "stg",
    label: "Stage Analysis",
    abbrev: "STG",
    slug: "stage_analysis",
    short: "Weinstein stage from the 30-week average.",
    detail:
      "Price above a rising 30-week average with relative strength improving reads Stage 2 - Uptrend and passes. Price below a falling one reads Stage 4 - Downtrend. Everything in between — bases and tops — reads Not Confirmed and fails until it resolves.",
  },
  {
    key: "dow",
    label: "Dow Theory (W)",
    abbrev: "DOW",
    slug: "dow_theory_w",
    short: "Weekly swing structure: highs and lows agreeing.",
    detail:
      "Fractal swing pivots on the weekly chart over the past six months. Higher highs with higher lows read Uptrend; lower highs with lower lows read Downtrend; anything mixed reads Sideways. Only Uptrend passes.",
  },
];

export const LABELS = COND_DOCS.map((d) => d.label);
export const ABBREVS = COND_DOCS.map((d) => d.abbrev);
export const SLUGS = COND_DOCS.map((d) => d.slug);

/** Calibrated constants; scripts/calibrate.ts tunes these against the reference distribution. */
export const CONFIG = {
  /** Sessions of score history traced on the dashboard. */
  trace: 270,
  /**
   * Minimum daily sessions before a name can be scored at all. Set low on
   * purpose: conditions degrade to their safe reading (FAIL, or PASS for the
   * extension checks that have no basis without history) instead of
   * quarantining the name, so fresh listings are scored exactly like the
   * reference dashboard scores them.
   */
  minSessions: 65,

  valUndertop: 50,
  valReasonableTop: 82,

  ernGrowthFloor: 20,
  ernRoeFloor: 14,

  momVeryStrong: 91,
  momStrong: 77,

  conRatio: 0.86,

  opfMargin: 9,

  insVolMult: 4.5,
  insWindow: 10,

  stxRsi: 96,
  stxAtrMult: 4.5,

  ltxAboveMa50: 1.42,

  dowLookbackWeeks: 52,
};

export interface StockFundamentals {
  pe: number | null;
  roe: number | null;
  profitGrowthTtm: number | null;
}

/** Per-symbol series shared by every condition evaluation. */
export interface Pre {
  dates: string[];
  open: number[];
  high: number[];
  low: number[];
  close: number[];
  volume: number[];
  sma20: (number | null)[];
  sma50: (number | null)[];
  sma150: (number | null)[];
  sma200: (number | null)[];
  atr14: (number | null)[];
  atrPct: (number | null)[];
  atrPctMed120: (number | null)[];
  rsi14: (number | null)[];
  volSma50: (number | null)[];
  /** Most recent completed week index for each daily session (forward-filled). */
  weekAsOf: number[];
  weeklyClose: number[];
  weeklyHigh: number[];
  weeklyLow: number[];
  wma30: (number | null)[];
}

function weekKey(date: string): string {
  const t = Date.parse(date + "T00:00:00Z");
  const d = new Date(t);
  const dow = d.getUTCDay(); // 0 Sunday..6 Saturday
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - ((dow + 6) % 7));
  return monday.toISOString().slice(0, 10);
}

/** Rolling median via insertion-sorted window. */
function rollingMedian(xs: (number | null)[], n: number): (number | null)[] {
  const out: (number | null)[] = new Array(xs.length).fill(null);
  const win: number[] = [];
  for (let i = 0; i < xs.length; i++) {
    const v = xs[i];
    if (v === null) continue;
    let lo = 0;
    let hi = win.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (win[mid] < v) lo = mid + 1;
      else hi = mid;
    }
    win.splice(lo, 0, v);
    if (win.length > n) win.splice(lowerBound(win, xs[i - n] ?? -Infinity), 1);
    if (win.length >= Math.min(n, 40)) out[i] = median(win);
  }
  return out;
}

function lowerBound(arr: number[], v: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function precompute(bars: Bar[]): Pre {
  const closes = bars.map((b) => b.close);
  const atr14 = atr(bars.map((b) => b.high), bars.map((b) => b.low), closes, 14);
  const atrPct = atr14.map((a, i) => (a === null || closes[i] > 0 ? (a ?? 0) / closes[i] : null));
  // Weekly buckets: a session carries the week index only on the week's last
  // observed session; weekAsOf forward-fills so any session reads its most
  // recent completed week.
  const weekOf: number[] = new Array(bars.length).fill(-1);
  const weeklyClose: number[] = [];
  const weeklyHigh: number[] = [];
  const weeklyLow: number[] = [];
  let curWeek = "";
  let wIdx = -1;
  let wHigh = -Infinity;
  let wLow = Infinity;
  let wClose = 0;
  let weekEndIdx = -1;
  const closeWeek = () => {
    weeklyClose.push(wClose);
    weeklyHigh.push(wHigh);
    weeklyLow.push(wLow);
    if (weekEndIdx >= 0) weekOf[weekEndIdx] = wIdx;
  };
  for (let i = 0; i < bars.length; i++) {
    const wk = weekKey(bars[i].date);
    if (wk !== curWeek) {
      if (curWeek) closeWeek();
      curWeek = wk;
      wIdx++;
      wHigh = -Infinity;
      wLow = Infinity;
    }
    wHigh = Math.max(wHigh, bars[i].high);
    wLow = Math.min(wLow, bars[i].low);
    wClose = closes[i];
    weekEndIdx = i;
  }
  if (curWeek) closeWeek();
  const weekAsOf: number[] = new Array(bars.length).fill(-1);
  {
    let last = -1;
    for (let i = 0; i < bars.length; i++) {
      if (weekOf[i] !== -1) last = weekOf[i];
      weekAsOf[i] = last;
    }
  }
  const wma30 = sma(weeklyClose, 30);
  return {
    dates: bars.map((b) => b.date),
    open: bars.map((b) => b.open),
    high: bars.map((b) => b.high),
    low: bars.map((b) => b.low),
    close: closes,
    volume: bars.map((b) => b.volume),
    sma20: sma(closes, 20),
    sma50: sma(closes, 50),
    sma150: sma(closes, 150),
    sma200: sma(closes, 200),
    atr14,
    atrPct,
    atrPctMed120: rollingMedian(atrPct, 120),
    rsi14: rsi(closes, 14),
    volSma50: sma(bars.map((b) => b.volume), 50),
    weekAsOf,
    weeklyClose,
    weeklyHigh,
    weeklyLow,
    wma30,
  };
}

/** Cross-sectional context for one session: percentiles shared across names. */
export interface SessionCtx {
  /** PE percentile (0–100) per symbol; static between fundamentals refreshes. */
  pePctile: Map<string, number>;
  /** Momentum-score percentile per symbol, recomputed every session. */
  momPctile: Map<string, number>;
}

export interface Reading {
  value: string;
  pass: boolean;
}

/**
 * Evaluate all eleven conditions for one symbol at daily index i.
 * Returns null entries where history is insufficient; the caller treats any
 * null as "not scoreable tonight".
 */
export function evaluateAt(
  p: Pre,
  i: number,
  sym: string,
  ctx: SessionCtx,
  fund: StockFundamentals,
  indexCloses: number[],
  indexAt: number,
): Reading[] {
  const c = p.close[i];
  const s20 = p.sma20[i];
  const s50 = p.sma50[i];
  const s150 = p.sma150[i];
  const a = p.atr14[i];
  const aPct = p.atrPct[i];
  const aPctMed = p.atrPctMed120[i];
  const rsiV = p.rsi14[i];

  // ---- 1 Valuation ----
  const pePct = ctx.pePctile.get(sym);
  let val: Reading | null = null;
  if (fund.pe === null || fund.pe === undefined || fund.pe <= 0 || pePct === undefined) {
    val = { value: "N/A", pass: false };
  } else if (pePct < CONFIG.valUndertop) val = { value: "Undervalued", pass: true };
  else if (pePct < CONFIG.valReasonableTop) val = { value: "Reasonably valued", pass: true };
  else val = { value: "Overvalued", pass: false };

  // ---- 2 Earnings Power ----
  const ern =
    fund.profitGrowthTtm !== null &&
    fund.roe !== null &&
    fund.profitGrowthTtm >= CONFIG.ernGrowthFloor &&
    fund.roe >= CONFIG.ernRoeFloor;

  // ---- 3 Momentum ----
  const mp = ctx.momPctile.get(sym);
  let momValue = "Weak momentum";
  if (mp !== undefined) {
    if (mp >= CONFIG.momVeryStrong) momValue = "Very Strong momentum";
    else if (mp >= CONFIG.momStrong) momValue = "Strong momentum";
  }
  // Short tapes degrade to Weak rather than quarantining the name; the
  // reference scans fresh listings instead of excluding them.

  // ---- 4 Contraction ----
  const con = aPct !== null && aPctMed !== null && aPct <= aPctMed * CONFIG.conRatio;

  // ---- 5 Timeframe Alignment ----
  const wIdx = p.weekAsOf[i];
  const wma = wIdx >= 0 ? p.wma30[wIdx] : null;
  const wmaPast = wIdx - 5 >= 0 ? p.wma30[wIdx - 5] : null;
  const tfa =
    s20 !== null && s50 !== null && s150 !== null &&
    c > s20 && s20 > s50 && c > s150 && s50 > s150 &&
    wma !== null && c > wma && wmaPast !== null && wma > wmaPast;

  // ---- 6 Outperformance ----
  let opf = false;
  if (i >= 252 && indexAt >= 252) {
    const sr = c / p.close[i - 252] - 1;
    const ir = indexCloses[indexAt] / indexCloses[indexAt - 252] - 1;
    opf = sr - ir > CONFIG.opfMargin / 100;
  }

  // ---- 7 Institutional Candles ----
  let insCount = 0;
  if (p.volSma50[i] !== null && p.volSma50[i]! > 0) {
    const start = Math.max(0, i - CONFIG.insWindow + 1);
    for (let j = i; j >= start; j--) {
      const o = p.open[j], h = p.high[j], l = p.low[j], cl = p.close[j];
      const rng = h - l;
      const vRef = p.volSma50[j];
      if (vRef === null || vRef <= 0 || rng <= 0) continue;
      if (cl > o && (cl - l) / rng >= 2 / 3 && p.volume[j] >= vRef * CONFIG.insVolMult) insCount++;
    }
  }

  // ---- 8 Short-term Extension ----
  const stxExtended =
    (rsiV !== null && rsiV >= CONFIG.stxRsi) ||
    (a !== null && s20 !== null && c >= s20 + CONFIG.stxAtrMult * a);

  // ---- 9 Long-term Extension ----
  const ltxExtended = s50 !== null && c >= s50 * CONFIG.ltxAboveMa50;

  // ---- 10 Stage Analysis ----
  let stg: Reading = { value: "Not Confirmed", pass: false };
  if (wIdx >= 0 && wma !== null && wmaPast !== null) {
    const above = c > wma;
    const rising = wma > wmaPast;
    let rsImproving = false;
    if (wIdx - 10 >= 0) {
      const wC = p.weeklyClose[wIdx];
      const wC10 = p.weeklyClose[wIdx - 10];
      rsImproving = wC / wC10 > 1;
    }
    if (above && rising && rsImproving) stg = { value: "Stage 2 - Uptrend", pass: true };
    else if (!above && !rising) stg = { value: "Stage 4 - Downtrend", pass: false };
  }

  // ---- 11 Dow Theory (weekly swings) ----
  let dow: Reading = { value: "Sideways", pass: false };
  if (wIdx >= 13) {
    // Adaptive lookback: at least 13 completed weeks, up to the full year.
    const lookback = Math.min(CONFIG.dowLookbackWeeks, wIdx + 1);
    const fromW = wIdx - lookback + 1;
    const hs = p.weeklyHigh.slice(fromW, wIdx + 1);
    const ls = p.weeklyLow.slice(fromW, wIdx + 1);
    const ph = fractalPivots(hs, 2).filter((x) => x.high);
    const pl = fractalPivots(ls, 2).filter((x) => !x.high);
    if (ph.length < 2 || pl.length < 2) {
      // Sparse swings: read the primary trend from the 20-week rate of change
      // instead of leaving the name unclassified. Requires half a year of
      // weekly tape first, so a 14-week listing stays Sideways rather than
      // riding one lucky quarter.
      if (wIdx >= 30) {
        const ret20 = p.weeklyClose[wIdx] / p.weeklyClose[Math.max(0, wIdx - 20)] - 1;
        dow =
          ret20 > 0.02 ? { value: "Uptrend", pass: true }
          : ret20 < -0.02 ? { value: "Downtrend", pass: false }
          : { value: "Sideways", pass: false };
      }
    } else {
      // Equal swings read as holding the structure, not breaking it. Three
      // signed votes — swing highs, swing lows, and the 20-week rate of
      // change — settle the label; a single agreeing fact is not enough to
      // call a primary trend either way.
      const ret20 = p.weeklyClose[wIdx] / p.weeklyClose[Math.max(0, wIdx - 20)] - 1;
      const voteH = ph[ph.length - 1].price >= ph[ph.length - 2].price ? 1 : -1;
      const voteL = pl[pl.length - 1].price >= pl[pl.length - 2].price ? 1 : -1;
      const voteT = ret20 > 0.08 ? 1 : ret20 < -0.08 ? -1 : 0;
      // Structure leads; the trend vote confirms or breaks ties. A bare
      // trend vote without any swing agreement leaves the name Sideways.
      const votes = voteH + voteL + voteT;
      const structure = Math.sign(voteH + voteL);
      if (structure > 0 ? votes >= 0 : votes >= 1) dow = { value: "Uptrend", pass: true };
      else if (structure < 0 ? votes <= 0 : votes <= -1) dow = { value: "Downtrend", pass: false };
      else dow = { value: "Sideways", pass: false };
    }
  }

  const momReading: Reading = { value: momValue, pass: momValue !== "Weak momentum" };

  return [
    val,
    { value: ern ? "Strong" : "Weak", pass: ern },
    momReading,
    { value: con ? "YES" : "NO", pass: con },
    {
      value: tfa ? "YES" : "NO",
      pass: tfa,
    },
    { value: opf ? "YES" : "NO", pass: opf },
    { value: String(insCount), pass: insCount >= 1 },
    { value: stxExtended ? "YES" : "NO", pass: !stxExtended },
    { value: ltxExtended ? "YES" : "NO", pass: !ltxExtended },
    stg,
    dow,
  ];
}

/**
 * Blended momentum score for one symbol/session: mean of the 63- and 126-
 * session excess returns vs the index, in percent. Null until both windows fit.
 */
export function momentumScore(
  p: Pre,
  i: number,
  indexCloses: number[],
  indexAt: number,
): number | null {
  if (i < 126 || indexAt < 126) return null;
  const r63s = p.close[i] / p.close[i - 63] - 1;
  const r63i = indexCloses[indexAt] / indexCloses[indexAt - 63] - 1;
  const r126s = p.close[i] / p.close[i - 126] - 1;
  const r126i = indexCloses[indexAt] / indexCloses[indexAt - 126] - 1;
  return ((r63s - r63i) + (r126s - r126i)) * 50;
}
