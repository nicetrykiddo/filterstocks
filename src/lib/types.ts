export interface Bar {
  /** Session date formatted YYYY-MM-DD in Asia/Kolkata. */
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Static documentation for one of the eleven conditions. */
export interface ConditionDoc {
  key: string;
  label: string;
  abbrev: string;
  slug: string;
  /** One-line plain-language definition shown in the UI. */
  short: string;
  /** Exactly how it is computed, shown in the reading guide and drawer. */
  detail: string;
}

export type Band = "" | "Largecap" | "Midcap" | "Smallcap" | "Microcap";

export type Exchange = "NSE" | "BSE";

export interface UniverseEntry {
  symbol: string;
  exchange: Exchange;
  name: string;
  sector: string;
  industry: string;
  mcapCr: number;
  fno: boolean;
  aliases: string[];
}

/** One scanned name, tonight. */
export interface StockRow {
  symbol: string;
  /** TradingView-prefixed symbol; BSE-only names carry a BSE: prefix. */
  tvSymbol: string;
  exchange: Exchange;
  name: string;
  sector: string;
  band: Band;
  /** Index memberships: fno, midcap150, smallcap250, microcap250. */
  idx: string[];
  close: number;
  chgPct: number;
  volume: number;
  ma20: number;
  /** Close against its own 20-session average, percent. */
  dmaPct: number;
  score: number;
  prev: number | null;
  delta: number;
  /** Consecutive sessions at exactly this score. */
  held: number;
  /** Eleven-character pass bitstring, aligned with `labels`. */
  st: string;
  /** Eleven human-readable readings, aligned with `labels`. */
  res: string[];
  /** Score history over the breadth window. */
  hist: number[];
  histDates: string[];
}

export interface Mover {
  symbol: string;
  name: string;
  sector: string;
  p: number;
  s: number;
  /** Indexes of conditions gained and lost, highest-signal detail first. */
  g: number[];
  l: number[];
}

export interface SectorAgg {
  name: string;
  n: number;
  mean: number;
  n9: number;
  n7: number;
  /** Mean-score history over the breadth window. */
  h: number[];
  prevMean: number;
}

export interface CondStat {
  label: string;
  ab: string;
  i: number;
  pass: number;
  prev: number | null;
  n: number;
}

export interface CondValue {
  v: string;
  s: "PASS" | "FAIL";
  n: number;
}

export interface UniverseDef {
  tag: string;
  label: string;
  field: "idx";
  n: number;
}

export interface BreadthPoint {
  d: string;
  mean: number;
  n9: number;
  /** Names actually scored that session. */
  n: number;
}

export interface Reads {
  breadth: string;
  movers: string;
  cond: string;
  sector: string;
}

export interface ScanResult {
  generatedAt: string;
  session: string;
  prevSession: string | null;
  sessionPretty: string;
  nDays: number;
  market: "in";
  universeNote: string;
  run: { total: number; clean: number; quar: number };
  labels: string[];
  abbrevs: string[];
  slugs: string[];
  conditions: ConditionDoc[];
  rows: StockRow[];
  breadth: {
    universe: number;
    mean: number;
    median: number;
    n9: number;
    n7: number;
    below5: number;
    aboveMa20: number;
    withMa20: number;
  };
  trans: {
    ups: Mover[];
    dns: Mover[];
    nUp: number;
    nDn: number;
    unchanged: number;
    entered: number;
    lost: number;
  };
  sectors: SectorAgg[];
  conds: CondStat[];
  condValues: CondValue[][];
  universes: UniverseDef[];
  industries: string[];
  breadthHist: BreadthPoint[];
  histMeta: { from: string; sessions: number; liveFrom: string; fromPretty: string; liveFromPretty: string };
  lede: string;
  sub: string;
  reads: Reads;
}

export function bandOf(score: number): "9-11" | "7-8" | "5-6" | "<5" {
  if (score >= 9) return "9-11";
  if (score >= 7) return "7-8";
  if (score >= 5) return "5-6";
  return "<5";
}
