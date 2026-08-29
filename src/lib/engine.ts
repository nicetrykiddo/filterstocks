import {
  CONFIG,
  COND_DOCS,
  LABELS,
  ABBREVS,
  SLUGS,
  evaluateAt,
  momentumScore,
  precompute,
  type Pre,
  type SessionCtx,
  type StockFundamentals,
} from "./conditions";
import { median } from "./indicators";
import type {
  Bar,
  BreadthPoint,
  CondStat,
  CondValue,
  Mover,
  ScanResult,
  SectorAgg,
  StockRow,
  UniverseDef,
} from "./types";
import type { UniverseEntry } from "./universe";

/** Joined fundamentals for one symbol; everything optional. */
export interface FundEntry {
  pe?: number | null;
  roe?: number | null;
  profitGrowthTtm?: number | null;
  name?: string;
  broadSector?: string;
  sector?: string;
  industry?: string;
  mcapCr?: number;
}

export type FundamentalsMap = Record<string, FundEntry>;

/**
 * Screener.in broad sectors folded into the dashboard's twelve buckets.
 * Screener's own labels are already close to canonical, so most entries pass
 * through; a few GICS names and gaps get redirected. Unknown maps to
 * Diversified.
 */
const SECTOR_MAP: Record<string, string> = {
  // canonical passthrough
  Energy: "Energy",
  Commodities: "Commodities",
  Industrials: "Industrials",
  "Consumer Discretionary": "Consumer Discretionary",
  "Fast Moving Consumer Goods": "Fast Moving Consumer Goods",
  Healthcare: "Healthcare",
  "Financial Services": "Financial Services",
  "Information Technology": "Information Technology",
  Services: "Services",
  Utilities: "Utilities",
  Telecommunication: "Telecommunication",
  // GICS aliases
  Materials: "Commodities",
  "Consumer Staples": "Fast Moving Consumer Goods",
  "Health Care": "Healthcare",
  Financials: "Financial Services",
  "Communication Services": "Telecommunication",
  "Real Estate": "Services",
};

/** Narrow the loose cache entry to what condition evaluation reads. */
function toFund(f: FundEntry): StockFundamentals {
  return {
    pe: typeof f.pe === "number" ? f.pe : null,
    roe: typeof f.roe === "number" ? f.roe : null,
    profitGrowthTtm: typeof f.profitGrowthTtm === "number" ? f.profitGrowthTtm : null,
  };
}

function prettyDate(ymd: string): string {
  const d = new Date(ymd + "T00:00:00Z");
  return `${d.getUTCDate()} ${d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" })} ${d.getUTCFullYear()}`;
}

function percentileRank(sorted: number[], v: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return (lo / Math.max(1, sorted.length)) * 100;
}

/**
 * Turns raw bars into the scan dataset. Everything the dashboard shows is
 * derived here once, server-side, so the client only filters and sorts.
 *
 * Bars must be sorted oldest-first and adjusted for splits. The index series
 * anchors the shared calendar; a name whose tape lags the index by more than
 * three sessions is quarantined rather than scored on stale bars.
 */
export function runScan(
  universe: UniverseEntry[],
  barsBySymbol: Map<string, Bar[]>,
  indexBars: Bar[],
  fundamentals: FundamentalsMap,
  snapshotNote: string,
): ScanResult {
  const indexDates = new Map<string, number>();
  indexBars.forEach((b, i) => indexDates.set(b.date, i));
  const indexCloses = indexBars.map((b) => b.close);

  const traceLen = Math.min(CONFIG.trace, indexBars.length);
  const traceStart = indexBars.length - traceLen;
  const traceDates = indexBars.slice(traceStart).map((b) => b.date);

  // ---- per-symbol preparation ----
  interface Prepared {
    u: UniverseEntry;
    p: Pre;
    localOfDate: Map<string, number>;
    fund: FundEntry;
    tv: string;
    sector: string;
  }
  const prepared: Prepared[] = [];
  let quarantined = 0;
  for (const u of universe) {
    const bars = barsBySymbol.get(u.symbol);
    if (!bars || bars.length < CONFIG.minSessions) {
      // Thin or absent history: counted as quarantined so "clean + quar"
      // always reconciles to the universe, matching the reference's
      // header arithmetic.
      quarantined++;
      continue;
    }
    const f = fundamentals[u.symbol] ?? {};
    const p = precompute(bars);
    const localOfDate = new Map<string, number>();
    bars.forEach((b, i) => localOfDate.set(b.date, i));
    prepared.push({
      u,
      p,
      localOfDate,
      fund: f,
      tv: u.exchange === "NSE" ? `NSE:${u.symbol}` : `BSE:${u.symbol}`,
      sector: SECTOR_MAP[f.broadSector ?? ""] ?? "Diversified",
    });
  }

  // ---- valuation percentiles (static between fundamentals refreshes) ----
  const pes = prepared.map((pr) => pr.fund.pe).filter((x): x is number => typeof x === "number" && x > 0 && isFinite(x));
  pes.sort((a, b) => a - b);
  const pePctile = new Map<string, number>();
  for (const pr of prepared) {
    if (typeof pr.fund.pe === "number" && pr.fund.pe > 0) {
      pePctile.set(pr.u.symbol, percentileRank(pes, pr.fund.pe));
    }
  }

  // ---- sweep 1: blended momentum scores per trace session ----
  const momScores: Map<string, (number | null)[]> = new Map();
  for (const pr of prepared) {
    const arr: (number | null)[] = new Array(traceLen).fill(null);
    for (let t = 0; t < traceLen; t++) {
      const li = pr.localOfDate.get(traceDates[t]);
      if (li === undefined) continue;
      const idxAt = indexDates.get(traceDates[t])!;
      arr[t] = momentumScore(pr.p, li, indexCloses, idxAt);
    }
    momScores.set(pr.u.symbol, arr);
  }

  // ---- sweep 2: eleven-condition evaluation per trace session ----
  const scoreMatrix = new Map<string, (number | null)[]>();
  const bitMatrix = new Map<string, (number | null)[]>();

  for (let t = 0; t < traceLen; t++) {
    const ctx: SessionCtx = { pePctile, momPctile: new Map() };
    const spread: Array<{ sym: string; v: number }> = [];
    for (const pr of prepared) {
      const v = momScores.get(pr.u.symbol)![t];
      if (v !== null) spread.push({ sym: pr.u.symbol, v });
    }
    // Percentile rank binary-searches, so the reference array must be sorted.
    const sortedSpread = spread.map((x) => x.v).sort((a, b) => a - b);
    for (const { sym, v } of spread) ctx.momPctile.set(sym, percentileRank(sortedSpread, v));

    for (const pr of prepared) {
      const li = pr.localOfDate.get(traceDates[t]);
      if (li === undefined) continue;
      const idxAt = indexDates.get(traceDates[t])!;
      const readings = evaluateAt(pr.p, li, pr.u.symbol, ctx, toFund(pr.fund), indexCloses, idxAt);
      let sc = 0;
      let bits = 0;
      readings.forEach((r, ci) => {
        if (r.pass) { sc++; bits |= 1 << ci; }
      });
      const sArr = scoreMatrix.get(pr.u.symbol) ?? new Array(traceLen).fill(null);
      const bArr = bitMatrix.get(pr.u.symbol) ?? new Array(traceLen).fill(null);
      sArr[t] = sc;
      bArr[t] = bits;
      scoreMatrix.set(pr.u.symbol, sArr);
      bitMatrix.set(pr.u.symbol, bArr);
    }
  }

  // ---- size bands + index tags ----
  // Bands ride the actual NSE index tags (Midcap = NIFTY Midcap 150,
  // Smallcap = NIFTY Smallcap 250) where membership is known; Largecap and
  // Microcap fall back to market-cap rank, the only public proxy for the
  // Nifty 100 / Microcap 250 rolls.
  const byMcap = [...prepared].sort(
    (a, b) => (b.fund.mcapCr ?? 0) - (a.fund.mcapCr ?? 0),
  );
  const bandOfSym = new Map<string, string>();
  byMcap.forEach((pr, rank) => {
    const tags = new Set(pr.u.idx ?? []);
    let band = "";
    if (tags.has("midcap150")) band = "Midcap";
    else if (tags.has("smallcap250")) band = "Smallcap";
    else if (rank >= 500 && rank < 750) band = "Microcap";
    else if (rank < 100) band = "Largecap";
    bandOfSym.set(pr.u.symbol, band);
  });

  // ---- tonight's rows ----
  const lastT = traceLen - 1;
  const rows: StockRow[] = [];
  const bitsBySym = new Map<string, number>();
  const prevBitsBySym = new Map<string, number>();

  for (const pr of prepared) {
    const scores = scoreMatrix.get(pr.u.symbol)!;
    const sc = scores[lastT];
    if (sc === null || sc === undefined) {
      quarantined++;
      continue;
    }
    const li = pr.localOfDate.get(traceDates[lastT])!;
    const p = pr.p;
    const idxAt = indexDates.get(traceDates[lastT])!;

    // Rebuild today's momentum percentile for this name from stored raw
    // scores — identical to the sweep-2 context, computed locally.
    const todaysSpread: number[] = [];
    for (const other of prepared) {
      const v = momScores.get(other.u.symbol)![lastT];
      if (v !== null) todaysSpread.push(v);
    }
    todaysSpread.sort((a, b) => a - b);
    const mine = momScores.get(pr.u.symbol)![lastT]!;
    const mp = percentileRank(todaysSpread, mine);
    const ctx: SessionCtx = { pePctile, momPctile: new Map([[pr.u.symbol, mp]]) };

    const readings = evaluateAt(p, li, pr.u.symbol, ctx, toFund(pr.fund), indexCloses, idxAt);
    let bits = 0;
    let score = 0;
    readings.forEach((r, ci) => {
      if (r.pass) { score++; bits |= 1 << ci; }
    });

    const prevBits = bitMatrix.get(pr.u.symbol)![lastT - 1] ?? 0;
    bitsBySym.set(pr.u.symbol, bits);
    prevBitsBySym.set(pr.u.symbol, prevBits);
    const prevScore = scores[lastT - 1];

    let held = 1;
    for (let t = lastT - 1; t >= 0 && scores[t] === score; t--) held++;

    const close = p.close[li];
    const prevClose = p.close[li - 1];
    const s20 = p.sma20[li];
    const band = (bandOfSym.get(pr.u.symbol) ?? "") as StockRow["band"];
    const idx = [...(pr.u.idx ?? [])];
    if (band === "Microcap") idx.push("microcap250");

    rows.push({
      symbol: pr.u.symbol,
      tvSymbol: pr.tv,
      exchange: pr.u.exchange,
      name: pr.fund.name || pr.u.name || pr.u.symbol,
      sector: pr.sector,
      band,
      idx,
      close,
      chgPct: Math.round(((close / prevClose - 1) * 100) * 100) / 100,
      volume: p.volume[li],
      ma20: s20 ?? close,
      dmaPct: s20 ? Math.round(((close / s20 - 1) * 100) * 100) / 100 : 0,
      score,
      prev: prevScore === null || prevScore === undefined ? null : prevScore,
      delta: prevScore === null || prevScore === undefined ? 0 : score - prevScore,
      held: Math.min(held, 99),
      st: readings.map((r) => (r!.pass ? "1" : "0")).join(""),
      res: readings.map((r) => r!.value),
      hist: scores.slice(lastT - Math.min(traceLen, 120) + 1).map((s) => s ?? 0),
      histDates: traceDates.slice(lastT - Math.min(traceLen, 120) + 1),
    });
  }
  rows.sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol));

  // ---- breadth history ----
  const breadthHist: BreadthPoint[] = [];
  for (let t = 0; t < traceLen; t++) {
    let sum = 0;
    let n9 = 0;
    let n = 0;
    for (const pr of prepared) {
      const sc = scoreMatrix.get(pr.u.symbol)![t];
      if (sc === null || sc === undefined) continue;
      n++;
      sum += sc;
      if (sc >= 9) n9++;
    }
    breadthHist.push({
      d: traceDates[t],
      mean: n ? Math.round((sum / n) * 1000) / 1000 : 0,
      n9,
      n,
    });
  }

  const todayScores = rows.map((r) => r.score);
  const mean3 = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  const breadth = {
    universe: rows.length,
    mean: Math.round(mean3(todayScores) * 1000) / 1000,
    median: median(todayScores),
    n9: todayScores.filter((s) => s >= 9).length,
    n7: todayScores.filter((s) => s >= 7).length,
    below5: todayScores.filter((s) => s < 5).length,
    aboveMa20: rows.filter((r) => r.dmaPct > 0).length,
    withMa20: rows.length,
  };

  // ---- transitions ----
  const ups: Mover[] = [];
  const dns: Mover[] = [];
  let entered = 0;
  let lost = 0;
  for (const r of rows) {
    if (r.prev === null) continue;
    const gained: number[] = [];
    const lostC: number[] = [];
    const bits = bitsBySym.get(r.symbol) ?? 0;
    const prevBits = prevBitsBySym.get(r.symbol) ?? 0;
    for (let ci = 0; ci < 11; ci++) {
      const now = (bits >> ci) & 1;
      const before = (prevBits >> ci) & 1;
      if (now && !before) gained.push(ci);
      if (!now && before) lostC.push(ci);
    }
    // A name is a mover only when its score actually changed; an equal swap of
    // conditions that nets zero is a non-event and stays in "unchanged".
    if (!gained.length && !lostC.length) continue;
    if (r.score === r.prev) continue;
    const mover: Mover = {
      symbol: r.symbol,
      name: r.name,
      sector: r.sector,
      p: r.prev,
      s: r.score,
      g: gained,
      l: lostC,
    };
    if (r.score > r.prev) ups.push(mover);
    else dns.push(mover);
    if (r.prev < 9 && r.score >= 9) entered++;
    if (r.prev >= 9 && r.score < 9) lost++;
  }
  ups.sort((a, b) => Math.abs(b.s - b.p) - Math.abs(a.s - a.p) || a.symbol.localeCompare(b.symbol));
  dns.sort((a, b) => Math.abs(b.s - b.p) - Math.abs(a.s - a.p) || a.symbol.localeCompare(b.symbol));
  const nUp = ups.length;
  const nDn = dns.length;
  // Upgraded + downgraded + unchanged sums to the universe exactly.
  const unchanged = rows.length - nUp - nDn;

  // ---- per-condition stats and value distributions ----
  const conds: CondStat[] = COND_DOCS.map((doc, ci) => ({
    label: doc.label,
    ab: doc.abbrev,
    i: ci,
    pass: rows.filter((r) => r.st[ci] === "1").length,
    prev:
      traceLen >= 2
        ? prepared.reduce((acc, pr) => {
            const b = bitMatrix.get(pr.u.symbol)![lastT - 1];
            return acc + (b !== null && (b >> ci) & 1 ? 1 : 0);
          }, 0)
        : null,
    n: rows.length,
  }));

  const condValues: CondValue[][] = LABELS.map(() => []);
  for (let ci = 0; ci < 11; ci++) {
    const m = new Map<string, CondValue>();
    for (const r of rows) {
      const v = r.res[ci];
      const s: "PASS" | "FAIL" = r.st[ci] === "1" ? "PASS" : "FAIL";
      const key = `${s}|${v}`;
      const e = m.get(key) ?? { v, s, n: 0 };
      e.n++;
      m.set(key, e);
    }
    condValues[ci] = [...m.values()].sort((a, b) => b.n - a.n);
  }

  // ---- sectors ----
  const sectorNames = new Map<string, string>();
  for (const r of rows) sectorNames.set(r.symbol, r.sector);
  const secMap = new Map<string, StockRow[]>();
  for (const r of rows) {
    const list = secMap.get(r.sector) ?? [];
    list.push(r);
    secMap.set(r.sector, list);
  }
  const sectors: SectorAgg[] = [...secMap.entries()].map(([name, list]) => {
    const h: number[] = [];
    for (let t = 0; t < traceLen; t++) {
      let sum = 0;
      let n = 0;
      for (const r of list) {
        const sc = scoreMatrix.get(r.symbol)![t];
        if (sc === null || sc === undefined) continue;
        sum += sc;
        n++;
      }
      h.push(n ? Math.round((sum / n) * 100) / 100 : 0);
    }
    return {
      name,
      n: list.length,
      mean: Math.round(mean3(list.map((r) => r.score)) * 100) / 100,
      n9: list.filter((r) => r.score >= 9).length,
      n7: list.filter((r) => r.score >= 7).length,
      h,
      prevMean: h.length >= 2 ? h[h.length - 2] : h[h.length - 1],
    };
  }).sort((a, b) => b.mean - a.mean || b.n - a.n);

  // ---- universes filter definitions ----
  const universes: UniverseDef[] = ([
    { tag: "fno", label: "F&O", field: "idx" as const, n: rows.filter((r) => r.idx.includes("fno")).length },
    { tag: "largecap", label: "Largecap", field: "idx" as const, n: rows.filter((r) => r.band === "Largecap").length },
    { tag: "midcap150", label: "Midcap", field: "idx" as const, n: rows.filter((r) => r.idx.includes("midcap150")).length },
    { tag: "smallcap250", label: "Smallcap", field: "idx" as const, n: rows.filter((r) => r.idx.includes("smallcap250")).length },
    { tag: "microcap250", label: "Microcap", field: "idx" as const, n: rows.filter((r) => r.idx.includes("microcap250")).length },
  ] satisfies UniverseDef[]).filter((u) => u.n > 0);

  const industries = [
    ...new Set(prepared.map((p) => p.fund.industry).filter((x): x is string => !!x)),
  ].sort();

  const session = indexBars[indexBars.length - 1].date;
  const prevSession = indexBars.length >= 2 ? indexBars[indexBars.length - 2].date : null;

  // ---- narratives ----
  const narratives = buildReads({
    rows,
    breadth,
    ups,
    dns,
    nUp,
    nDn,
    unchanged,
    entered,
    lost,
    breadthHist,
    sectors,
    conds,
    traceLen,
  });

  return {
    generatedAt: new Date().toISOString(),
    session,
    prevSession,
    sessionPretty: prettyDate(session),
    nDays: traceLen,
    market: "in",
    universeNote: snapshotNote,
    run: { total: universe.length, clean: rows.length, quar: quarantined },
    labels: LABELS,
    abbrevs: ABBREVS,
    slugs: SLUGS,
    conditions: COND_DOCS,
    rows,
    breadth,
    trans: {
      ups,
      dns,
      nUp,
      nDn,
      unchanged,
      entered,
      lost,
    },
    sectors,
    conds,
    condValues,
    universes,
    industries,
    breadthHist,
    histMeta: {
      from: breadthHist[0]?.d ?? session,
      sessions: breadthHist.length,
      liveFrom: breadthHist[0]?.d ?? session,
      fromPretty: prettyDate(breadthHist[0]?.d ?? session),
      liveFromPretty: prettyDate(breadthHist[0]?.d ?? session),
    },
    lede: narratives.lede,
    sub: narratives.sub,
    reads: narratives.reads,
  };
}

interface NarrativeInput {
  rows: StockRow[];
  breadth: ScanResult["breadth"];
  ups: Mover[];
  dns: Mover[];
  nUp: number;
  nDn: number;
  unchanged: number;
  entered: number;
  lost: number;
  breadthHist: BreadthPoint[];
  sectors: SectorAgg[];
  conds: CondStat[];
  traceLen: number;
}

function buildReads(x: NarrativeInput): { lede: string; sub: string; reads: ScanResult["reads"] } {
  const { breadth, breadthHist } = x;
  const prevPoint = breadthHist[breadthHist.length - 2];
  const d9 = prevPoint ? breadth.n9 - prevPoint.n9 : 0;

  const dir =
    d9 > 0 ? "improved into the close" : d9 < 0 ? "thinned into the close" : "was flat into the close";
  const deltaTxt =
    d9 === 0 ? "" : ` — ${Math.abs(d9)} ${d9 > 0 ? "more" : "fewer"} than yesterday`;
  const lede = `Breadth ${dir}: <b>${breadth.n9} names</b> now clear nine of eleven conditions${deltaTxt}.`;

  const tierDir =
    x.entered > x.lost ? "the top tier gained ground" : x.entered < x.lost ? "the top tier ceded ground" : "the top tier held steady";
  const secMoves = new Map<string, number>();
  for (const m of x.ups) secMoves.set(m.sector, (secMoves.get(m.sector) ?? 0) + 1);
  for (const m of x.dns) secMoves.set(m.sector, (secMoves.get(m.sector) ?? 0) - 1);
  const topSecs = [...secMoves.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => k);
  const conc = topSecs.length ? `, concentrated in ${topSecs.join(" and ")}` : "";
  const sub = `${x.nUp} stocks upgraded against ${x.nDn} downgraded and ${x.unchanged} did not move. ${x.entered} crossed into 9+ versus ${x.lost} that left, so ${tierDir}${conc}.`;

  const n9s = breadthHist.map((h) => h.n9);
  const minN9 = Math.min(...n9s, breadth.n9);
  const maxN9 = Math.max(...n9s, breadth.n9);
  const aboveCount = n9s.filter((v) => v <= breadth.n9).length;
  const pctile = Math.round((aboveCount / Math.max(1, n9s.length)) * 100);
  const readsBreadth = `Over ${breadthHist.length} sessions the count at 9+ has ranged from ${minN9} to ${maxN9}. Today's ${breadth.n9} sits in the ${ordinal(pctile)} percentile of that range.`;

  const readsMovers = `${x.nUp} stocks gained at least one condition and ${x.nDn} lost at least one. Of those, ${x.entered} crossed into the top tier and ${x.lost} dropped out of it.`;

  let worstBreak: { label: string; n: number } | null = null;
  let bestRegain: { label: string; n: number } | null = null;
  for (const c of x.conds) {
    if (c.prev === null) continue;
    const d = c.pass - c.prev;
    if (d < 0 && (!worstBreak || d < -worstBreak.n)) worstBreak = { label: c.label, n: -d };
    if (d > 0 && (!bestRegain || d > bestRegain.n)) bestRegain = { label: c.label, n: d };
  }
  const parts: string[] = [];
  if (worstBreak) parts.push(`${worstBreak.label} broke on ${worstBreak.n} name${worstBreak.n === 1 ? "" : "s"} — the single biggest driver of today's ${x.nDn} downgrades`);
  if (bestRegain) parts.push(`${bestRegain.label} was regained on ${bestRegain.n}, behind part of the ${x.nUp} upgrades`);
  const flat = x.conds.filter((c) => c.n > 0 && (c.pass / c.n >= 0.985 || c.pass / c.n <= 0.015));
  const flatTxt = flat.length
    ? ` ${flat.map((c) => c.label).join(", ")} passed almost every stock, so tonight's score really separates on the other ${11 - flat.length}.`
    : "";
  const readsCond = (parts.join(". ") || "Every condition moved roughly in step today.") + "." + flatTxt;

  const big = x.sectors.filter((s) => s.n >= 5);
  const thin = x.sectors.filter((s) => s.n < 5);
  const lead = big[0];
  const trail = big[big.length - 1];
  const readsSector = lead && trail
    ? `${lead.name} leads on mean score at ${lead.mean.toFixed(2)}; ${trail.name} trails at ${trail.mean.toFixed(2)}.` +
      (thin.length ? ` Sectors with fewer than five names are shown dimmed — too small to read as a trend.` : "")
    : "";

  return { lede, sub, reads: { breadth: readsBreadth, movers: readsMovers, cond: readsCond, sector: readsSector } };
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}
