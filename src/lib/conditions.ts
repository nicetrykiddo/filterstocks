import type { Bar, ConditionDoc } from "./types";
import { median, rsi, sma, rollingMax, rollingMin, atr } from "./indicators";

/**
 * The scan reads every stock against eleven conditions each session: two
 * fundamental checks, one relative-momentum check, and eight price/volume
 * structure checks. Each pass is one point; the score is the sum (0–11).
 *
 * Eight of the eleven formulas below were recovered by grid-searching
 * hypothesis families against RPCI's published readings (see
 * scripts/recover.ts and scripts/parity.ts): they reproduce the reference's
 * published pass/fail bits on the overlap session at the agreement rates
 * printed by scripts/parity.ts. The remaining three (VAL, ERN, CON) are
 * calibrated so per-condition pass rates track the reference's published
 * distribution (scripts/calibrate.ts). Everything here is documented openly.
 */

export const COND_DOCS: ConditionDoc[] = [
  {
    key: "val",
    label: "Valuation",
    abbrev: "VAL",
    slug: "valuation",
    short: "Trailing P/E against the universe, in bands.",
    detail:
      "The stock's trailing P/E (Screener.in, refreshed weekly) is ranked against every other scanned name. The cheapest 45% read Undervalued, the next band up to 73% reads Reasonably valued, and the richest 27% read Overvalued. Names with no P/E — losses, blank filings — read N/A and cannot pass.",
  },
  {
    key: "ern",
    label: "Earnings Power",
    abbrev: "ERN",
    slug: "earnings_power",
    short: "Profit growth and returns on equity, together.",
    detail:
      "Strong requires trailing-twelve-month profit growth of at least 22% AND return on equity of at least 8%. Both come from the weekly fundamentals cache. Either falling short — or missing filings — reads Weak.",
  },
  {
    key: "mom",
    label: "Momentum",
    abbrev: "MOM",
    slug: "momentum",
    short: "Near its 52-week high AND a strong six-month return.",
    detail:
      "Each session every scanned name is ranked, cross-sectionally, on two features: how close its close sits to its 250-session high, and its 126-session return. The two ranks are averaged; roughly the top quarter of the market reads Strong momentum and roughly the top six percent reads Very Strong momentum. Names with short tapes read Weak rather than guessing.",
  },
  {
    key: "con",
    label: "Price Contraction",
    abbrev: "CON",
    slug: "price_contraction",
    short: "ATR% below its own six-month norm.",
    detail:
      "The 14-session ATR as a percentage of price, divided by its own median over the last 120 sessions. At or below a calibrated multiple of that norm, day ranges are shrinking relative to their recent behaviour — supply and demand are agreeing on smaller increments.",
  },
  {
    key: "tfa",
    label: "Timeframe Alignment",
    abbrev: "TFA",
    slug: "timeframe_alignment",
    short: "The Minervini trend template, clause by clause.",
    detail:
      "On the daily tape: close above the 50-, 150- and 200-day averages, the 50 above the 150, the 200-day average rising over the last twenty sessions, the close at least 1.3× its 52-week low, and no further than 25% below its 52-week high. Every clause must hold; one miss fails the condition.",
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
    short: "High-volume bullish days in the last twenty sessions.",
    detail:
      "A candle qualifies when it closes up, closes in the top two-thirds of its range, and trades at least nine times its 50-day average volume — the footprint of size leaning on the offer. The reading is the count over the last twenty sessions; anything above zero passes.",
  },
  {
    key: "stx",
    label: "Short-term Extension",
    abbrev: "STX",
    slug: "st_extension",
    short: "Not stretched above the 20-day average.",
    detail:
      "Fails when RSI(14) reaches 87 or the close stands 5.5 ATRs above the 20-day average — a pullback-prone stretch. It passes almost every name almost every night, which is the point: when it does fail, it matters.",
  },
  {
    key: "ltx",
    label: "Long-term Extension",
    abbrev: "LTX",
    slug: "lt_extension",
    short: "Not parabolic above the 50-day average.",
    detail:
      "Fails when the close stands 30% or more above its 50-day average. Vertical moves mean-revert before bases can form; the condition refuses to score them while they last.",
  },
  {
    key: "stg",
    label: "Stage Analysis",
    abbrev: "STG",
    slug: "stage_analysis",
    short: "Stage from the 40-week average.",
    detail:
      "Price above a rising 40-week average reads Stage 2 - Uptrend and passes. Price below a falling one reads Stage 4 - Downtrend. Everything in between — above a flat average, below a rising one — reads Not Confirmed and fails until it resolves.",
  },
  {
    key: "dow",
    label: "Dow Theory (W)",
    abbrev: "DOW",
    slug: "dow_theory_w",
    short: "Primary trend from the 40-week average.",
    detail:
      "A close above the 40-week average reads Uptrend and passes; a close below a falling one reads Downtrend. Mixed states — below a flat or rising average — read Sideways and fail. On weekly data the 40-week average is slow enough to ignore most swing noise.",
  },
];

export const LABELS = COND_DOCS.map((d) => d.label);
export const ABBREVS = COND_DOCS.map((d) => d.abbrev);
export const SLUGS = COND_DOCS.map((d) => d.slug);

/** Scan constants; scripts/calibrate.ts tunes the calibrated ones against the reference distribution. */
export const CONFIG = {
  /** Sessions of score history traced on the dashboard. */
  trace: 270,
  /**
   * Minimum daily sessions before a name can be scored at all. Set to the
   * bare minimum on purpose: conditions degrade to their safe reading (FAIL,
   * or PASS for the extension checks that have no basis to call a name
   * extended) instead of quarantining the name, so fresh listings are scored
   * exactly like the reference dashboard scores them — 999/999, 0 quarantined.
   */
  minSessions: 2,

  // VAL — P/E percentile bands, matched to the reference's published value
  // split (45% Undervalued, 73% cumulative pass among names with a P/E).
  valUndertop: 45,
  valReasonableTop: 73,

  // ERN — calibrated floors on the weekly fundamentals cache.
  ernGrowthFloor: 22,
  ernRoeFloor: 8,

  // MOM — percentile cuts on the combined 52-week-high proximity and
  // 126-session return rank (calibrated to the reference's tier sizes).
  momVeryStrong: 89,
  momStrong: 75,
  /** Window for the 52-week-high proximity feature, in sessions. */
  momProximityWindow: 250,
  /** Sessions for the return leg of the momentum feature. */
  momReturnWindow: 126,

  // CON — ATR% versus its own 120-session median (calibrated multiple).
  conRatio: 0.84,

  // OPF — 252-session excess return over the Nifty 50, in percentage points.
  opfMargin: 4,

  // INS — recovered family, thresholds re-derived on our bhavcopy volume
  // basis: up-close in the top two-thirds of the range on ≥9× the 50-day
  // average volume, any occurrence inside the window.
  insVolMult: 9,
  insWindow: 20,
  insClosePos: 2 / 3,

  // STX — recovered at full agreement: RSI ceiling and ATR-multiple stretch.
  stxRsi: 87,
  stxAtrMult: 5.5,

  // LTX — recovered at 99% agreement.
  ltxAboveMa50: 1.3,

  // TFA — recovered Minervini trend-template family.
  tfaFromLow: 1.3,
  tfaFromHigh: 0.75,
  tfaRisingLag: 20,

  // STG — recovered stage rule: price above a rising 40-week average (the
  // window that reproduces the reference's stage labels on our data basis).
  stgWeeks: 40,
  stgRisingLagWeeks: 5,

  // DOW — recovered primary-trend rule: close above the 40-week average.
  dowWeeks: 40,
  dowLagWeeks: 5,
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
  /** Rolling 250-session high/low of closes (52-week proximity features). */
  hi52: (number | null)[];
  lo52: (number | null)[];
  /** Most recent completed week index for each daily session (forward-filled). */
  weekAsOf: number[];
  weeklyClose: number[];
  weeklyHigh: number[];
  weeklyLow: number[];
  wma30: (number | null)[];
  wma40: (number | null)[];
}

function weekKey(date: string): string {
  const t = Date.parse(date + "T00:00:00Z");
  const d = new Date(t);
  const dow = d.getUTCDay(); // 0 Sunday..6 Saturday
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - ((dow + 6) % 7));
  return monday.toISOString().slice(0, 10);
}

/**
 * Rolling median over the trailing n sessions, ignoring gaps. Exact: each
 * window holds the values of precisely the last n indices, so a null never
 * evicts a real observation. A window needs at least 40 observations to
 * publish a median.
 */
function rollingMedian(xs: (number | null)[], n: number): (number | null)[] {
  const out: (number | null)[] = new Array(xs.length).fill(null);
  // Sorted by value (ties by index); the FIFO ring tracks expiry order.
  const sorted: Array<{ v: number; idx: number }> = [];
  const ring: Array<{ v: number; idx: number }> = [];
  for (let i = 0; i < xs.length; i++) {
    const v = xs[i];
    if (v !== null) {
      const item = { v, idx: i };
      let lo = 0;
      let hi = sorted.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        const o = sorted[mid];
        if (o.v < v || (o.v === v && o.idx < i)) lo = mid + 1;
        else hi = mid;
      }
      sorted.splice(lo, 0, item);
      ring.push(item);
    }
    while (ring.length && ring[0].idx <= i - n) {
      const dead = ring.shift()!;
      let lo = 0;
      let hi = sorted.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        const o = sorted[mid];
        if (o.v < dead.v || (o.v === dead.v && o.idx < dead.idx)) lo = mid + 1;
        else hi = mid;
      }
      sorted.splice(lo, 1);
    }
    if (ring.length >= Math.min(n, 40)) out[i] = median(sorted.map((s) => s.v));
  }
  return out;
}

export function precompute(bars: Bar[]): Pre {
  const closes = bars.map((b) => b.close);
  const atr14 = atr(bars.map((b) => b.high), bars.map((b) => b.low), closes, 14);
  const atrPct = atr14.map((a, i) => (a !== null && closes[i] > 0 ? a / closes[i] : null));
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
    hi52: rollingMax(closes, CONFIG.momProximityWindow),
    lo52: rollingMin(closes, CONFIG.momProximityWindow),
    weekAsOf,
    weeklyClose,
    weeklyHigh,
    weeklyLow,
    wma30: sma(weeklyClose, 30),
    wma40: sma(weeklyClose, CONFIG.dowWeeks),
  };
}

/** Cross-sectional context for one session: percentiles shared across names. */
export interface SessionCtx {
  /** PE percentile (0–100) per symbol; static between fundamentals refreshes. */
  pePctile: Map<string, number>;
  /**
   * Combined momentum rank (0–100) per symbol, recomputed every session: the
   * mean of the name's 52-week-high proximity percentile and its 126-session
   * return percentile.
   */
  momPctile: Map<string, number>;
}

export interface Reading {
  value: string;
  pass: boolean;
}

/**
 * Evaluate all eleven conditions for one symbol at daily index i.
 * Readings degrade to their safe value where history is insufficient, so a
 * fresh listing is scored rather than dropped.
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
  const s200 = p.sma200[i];
  const a = p.atr14[i];
  const aPct = p.atrPct[i];
  const aPctMed = p.atrPctMed120[i];
  const rsiV = p.rsi14[i];

  // ---- 1 Valuation ----
  const pePct = ctx.pePctile.get(sym);
  let val: Reading;
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

  // ---- 5 Timeframe Alignment (Minervini trend template) ----
  const hi52 = p.hi52[i];
  const lo52 = p.lo52[i];
  const s200Prev = i >= CONFIG.tfaRisingLag ? p.sma200[i - CONFIG.tfaRisingLag] : null;
  const tfa =
    s50 !== null && s150 !== null && s200 !== null && s200Prev !== null &&
    hi52 !== null && lo52 !== null && lo52 > 0 &&
    c > s50 && c > s150 && c > s200 && s50 > s150 && s200 > s200Prev &&
    c >= CONFIG.tfaFromLow * lo52 && c >= CONFIG.tfaFromHigh * hi52;

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
      if (cl > o && (cl - l) / rng >= CONFIG.insClosePos && p.volume[j] >= vRef * CONFIG.insVolMult) insCount++;
    }
  }

  // ---- 8 Short-term Extension ----
  const stxExtended =
    (rsiV !== null && rsiV >= CONFIG.stxRsi) ||
    (a !== null && s20 !== null && c >= s20 + CONFIG.stxAtrMult * a);

  // ---- 9 Long-term Extension ----
  const ltxExtended = s50 !== null && c >= s50 * CONFIG.ltxAboveMa50;

  // ---- 10 Stage Analysis (weekly) ----
  let stg: Reading = { value: "Not Confirmed", pass: false };
  const wIdx = p.weekAsOf[i];
  const wma = wIdx >= 0 ? p.wma40[wIdx] : null;
  const wmaPrev = wIdx - CONFIG.stgRisingLagWeeks >= 0 ? p.wma40[wIdx - CONFIG.stgRisingLagWeeks] : null;
  if (wma !== null && wmaPrev !== null) {
    const above = c > wma;
    const rising = wma > wmaPrev;
    if (above && rising) stg = { value: "Stage 2 - Uptrend", pass: true };
    else if (!above && !rising) stg = { value: "Stage 4 - Downtrend", pass: false };
  }

  // ---- 11 Dow Theory (weekly primary trend) ----
  let dow: Reading = { value: "Sideways", pass: false };
  const wma40 = wIdx >= 0 ? p.wma40[wIdx] : null;
  const wma40Prev = wIdx - CONFIG.dowLagWeeks >= 0 ? p.wma40[wIdx - CONFIG.dowLagWeeks] : null;
  if (wma40 !== null && wma40Prev !== null) {
    if (c > wma40) dow = { value: "Uptrend", pass: true };
    else if (wma40 < wma40Prev) dow = { value: "Downtrend", pass: false };
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
 * session excess returns vs the index, in percent. Null until both windows
 * fit. Retained as a research feature for the recovery harnesses.
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
