export interface ConditionDoc {
  key: string;
  label: string;
  /** One-line plain-language definition shown in the UI. */
  short: string;
  /** How it is computed, exactly. Shown in the reading guide and drawer. */
  detail: string;
  group: "trend" | "momentum" | "contraction";
}

export interface Bar {
  /** Session date formatted YYYY-MM-DD in Asia/Kolkata. */
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface StockRow {
  symbol: string;
  name: string;
  sector: string;
  fno: boolean;
  close: number;
  chgPct: number;
  vs20Dma: number;
  volume: number;
  score: number;
  delta: number;
  held: number;
  band: Band;
  conds: boolean[];
  /** Human-readable current reading per condition, aligned with COND_DOCS. */
  condValues: string[];
  scoreHist: number[];
  closeHist: number[];
}

export type Band = "9-11" | "7-8" | "5-6" | "<5";

export interface Mover {
  symbol: string;
  name: string;
  sector: string;
  fno: boolean;
  from: number;
  to: number;
  /** Tier the move is listed under: the highest band touched, entering or exiting. */
  tier: Band;
}

export interface SectorAgg {
  sector: string;
  total: number;
  at9: number;
  mean: number;
}

export interface PassRate {
  key: string;
  label: string;
  short: string;
  group: ConditionDoc["group"];
  pct: number;
}

export interface ScanResult {
  generatedAt: string;
  session: string;
  universe: number;
  failed: string[];
  conditions: ConditionDoc[];
  breadth: {
    dates: string[];
    at9: number[];
    meanScore: number[];
  };
  passRates: PassRate[];
  sectors: SectorAgg[];
  movers: Mover[];
  stocks: StockRow[];
}

export function bandOf(score: number): Band {
  if (score >= 9) return "9-11";
  if (score >= 7) return "7-8";
  if (score >= 5) return "5-6";
  return "<5";
}
