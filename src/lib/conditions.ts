import type { Bar, ConditionDoc } from "./types";

/**
 * The scan scores every stock against eleven conditions each session: a
 * quality-trend block, a momentum block, and a contraction block. Each pass is
 * one point; the score is the sum (0-11). Conditions are evaluated on daily
 * bars only, so the whole scan is reproducible from end-of-day data.
 */

export const COND_DOCS: ConditionDoc[] = [
  {
    key: "c1",
    label: "Above 200 DMA",
    short: "Close is above its 200-session average.",
    detail:
      "The last close is higher than the simple average of the previous 200 closes. Read it as the primary trend: stocks building bases for a breakout almost always stay on this side of the line.",
    group: "trend",
  },
  {
    key: "c2",
    label: "Above 50 DMA",
    short: "Close is above its 50-session average.",
    detail:
      "The last close is higher than the simple average of the previous 50 closes. The intermediate trend filter: a contraction that turns into distribution usually loses this first.",
    group: "trend",
  },
  {
    key: "c3",
    label: "Above 20 DMA",
    short: "Close is above its 20-session average.",
    detail:
      "The last close is higher than the simple average of the previous 20 closes. The shortest of the three trend checks; often the last to fall before a breakdown and the first to clear on a breakout.",
    group: "trend",
  },
  {
    key: "c4",
    label: "20 above 50 DMA",
    short: "The 20-session average is above the 50-session average.",
    detail:
      "The short average sits above the intermediate one, so the averages stack in rising order rather than rolling over while price consolidates.",
    group: "trend",
  },
  {
    key: "c5",
    label: "50 above 200 DMA",
    short: "The 50-session average is above the 200-session average.",
    detail:
      "The classic golden-cross structure. It filters out deep corrections: by the time this inverts, the base being scored has usually already failed.",
    group: "trend",
  },
  {
    key: "c6",
    label: "Top of 52w range",
    short: "Close sits in the top quarter of its one-year range.",
    detail:
      "Position in the 52-week range is (close minus low) divided by (high minus low) over the last 250 sessions. Passing means at least 0.75: the stock is still near its highs rather than repairing a deep drawdown.",
    group: "trend",
  },
  {
    key: "c7",
    label: "3M relative strength",
    short: "Outperformed the Nifty 50 over the last 63 sessions.",
    detail:
      "The stock's 63-session return minus the Nifty 50's return over the same window. Positive means the stock kept pace with, or beat, the index it competes with for capital.",
    group: "momentum",
  },
  {
    key: "c8",
    label: "6M return positive",
    short: "Price is up over the last 126 sessions.",
    detail:
      "The 126-session return is positive. A simple absolute-momentum floor on top of relative strength, so a weak market does not hand out points for losing less than the index.",
    group: "momentum",
  },
  {
    key: "c9",
    label: "Volatility contracting",
    short: "14-day ATR is 20%+ below its level of 30 sessions ago.",
    detail:
      "The 14-session average true range today is at least 20 per cent below the same ATR measured 30 sessions earlier. This is the contraction the scan is named around: the day ranges are physically shrinking as the base forms.",
    group: "contraction",
  },
  {
    key: "c10",
    label: "Tight five-day cluster",
    short: "The last five closes sit within 1.5% dispersion.",
    detail:
      "The standard deviation of the last five closes, divided by their mean, is at most 1.5 per cent. Tight closes mean supply and demand agree on price, which is what precedes expansion.",
    group: "contraction",
  },
  {
    key: "c11",
    label: "Volume drying up",
    short: "5-day average volume is under 80% of the 50-day average.",
    detail:
      "The 5-session average volume is below 0.8 times the 50-session average. In a healthy base, turnover bleeds out as impatient holders finish selling to patient ones.",
    group: "contraction",
  },
];

export const CONFIG = {
  /** Sessions of score history to trace (about six months). */
  trace: 130,
  rsWindow: 63,
  absWindow: 126,
  atrWindow: 14,
  atrLag: 30,
  atrDrop: 0.2,
  tightStdev: 0.015,
  volDry: 0.8,
  rangePos: 0.75,
};

export interface Precomputed {
  dates: string[];
  closes: number[];
  highs: number[];
  lows: number[];
  volumes: number[];
  sma20: (number | null)[];
  sma50: (number | null)[];
  sma200: (number | null)[];
  atr14: (number | null)[];
  max250: (number | null)[];
  min250: (number | null)[];
  smaVol5: (number | null)[];
  smaVol50: (number | null)[];
  stdev5: (number | null)[];
}

export function precompute(bars: Bar[]): Precomputed {
  const closes = bars.map((b) => b.close);
  const highs = bars.map((b) => b.high);
  const lows = bars.map((b) => b.low);
  const volumes = bars.map((b) => b.volume);
  return {
    dates: bars.map((b) => b.date),
    closes,
    highs,
    lows,
    volumes,
    sma20: smaN(closes, 20),
    sma50: smaN(closes, 50),
    sma200: smaN(closes, 200),
    atr14: atrN(highs, lows, closes, CONFIG.atrWindow),
    max250: rollMaxN(closes, 250),
    min250: rollMinN(closes, 250),
    smaVol5: smaN(volumes, 5),
    smaVol50: smaN(volumes, 50),
    stdev5: stdevN(closes, 5),
  };
}

import {
  atr as atrN,
  rollingMax as rollMaxN,
  rollingMin as rollMinN,
  rollingStdev as stdevN,
  sma as smaN,
} from "./indicators";

export interface CondReading {
  pass: boolean | null;
  /** Compact current reading, e.g. "1316 vs 1290". */
  value: string | null;
}

/** Evaluate all conditions at session index i. null means not enough history. */
export function evaluateAt(p: Precomputed, i: number, indexCloses: number[] | null, indexAt: number | null): (CondReading | null)[] {
  const c = p.closes[i];
  const s20 = p.sma20[i];
  const s50 = p.sma50[i];
  const s200 = p.sma200[i];
  const a = p.atr14[i];
  const aLag = i - CONFIG.atrLag >= 0 ? p.atr14[i - CONFIG.atrLag] : null;
  const hi = p.max250[i];
  const lo = p.min250[i];
  const sd = p.stdev5[i];

  let mean5v: number | null = null;
  if (i >= 4) {
    let s = 0;
    for (let j = i - 4; j <= i; j++) s += p.closes[j];
    mean5v = s / 5;
  }

  const v5 = p.smaVol5[i];
  const v50 = p.smaVol50[i];

  const rsIdx = indexCloses && indexAt !== null ? indexCloses[indexAt] : null;
  const rsStock = i - CONFIG.rsWindow >= 0 ? p.closes[i - CONFIG.rsWindow] : null;
  const absRef = i - CONFIG.absWindow >= 0 ? p.closes[i - CONFIG.absWindow] : null;
  const rsIndex = indexCloses && indexAt !== null && indexAt - CONFIG.rsWindow >= 0 ? indexCloses[indexAt - CONFIG.rsWindow] : null;

  const pos52 = hi !== null && lo !== null && hi > lo ? (c - lo) / (hi - lo) : null;

  const fmt = (x: number) => (Math.abs(x) >= 1000 ? Math.round(x).toLocaleString("en-IN") : round(x));

  const out: (CondReading | null)[] = [
    s200 !== null ? { pass: c > s200, value: `${fmt(c)} vs ${fmt(s200)}` } : null,
    s50 !== null ? { pass: c > s50, value: `${fmt(c)} vs ${fmt(s50)}` } : null,
    s20 !== null ? { pass: c > s20, value: `${fmt(c)} vs ${fmt(s20)}` } : null,
    s20 !== null && s50 !== null ? { pass: s20 > s50, value: `${fmt(s20)} vs ${fmt(s50)}` } : null,
    s50 !== null && s200 !== null ? { pass: s50 > s200, value: `${fmt(s50)} vs ${fmt(s200)}` } : null,
    pos52 !== null ? { pass: pos52 >= CONFIG.rangePos, value: `${Math.round(pos52 * 100)}% of range` } : null,
    rsStock !== null && rsIdx !== null && rsIndex !== null
      ? {
          pass: c / rsStock - 1 > rsIdx / rsIndex - 1,
          value: `${pct(c, rsStock)} vs ${pct(rsIdx, rsIndex)}`,
        }
      : null,
    absRef !== null ? { pass: c > absRef, value: `${pct(c, absRef)}` } : null,
    a !== null && aLag !== null
      ? { pass: a < aLag * (1 - CONFIG.atrDrop), value: `${round((a / c) * 100)}% vs ${round((aLag / c) * 100)}% of price` }
      : null,
    sd !== null && mean5v !== null && mean5v > 0
      ? { pass: sd / mean5v <= CONFIG.tightStdev, value: `${round((sd / mean5v) * 100)}% dispersion` }
      : null,
    v5 !== null && v50 !== null
      ? { pass: v5 < v50 * CONFIG.volDry, value: `${round((v5 / v50) * 100)}% of norm` }
      : null,
  ];
  return out;
}

function round(x: number): number {
  return Math.round(x * 10) / 10;
}

function pct(to: number, from: number): string {
  const v = (to / from - 1) * 100;
  return `${v >= 0 ? "+" : ""}${round(v)}%`;
}
