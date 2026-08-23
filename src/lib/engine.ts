import { CONFIG, COND_DOCS, evaluateAt, precompute } from "./conditions";
import { pctChange, round2 } from "./indicators";
import type { Bar, Mover, PassRate, ScanResult, SectorAgg, StockRow } from "./types";
import { bandOf } from "./types";
import type { UniverseEntry } from "./universe";

/**
 * Turns raw bars into the scan dataset. Everything the dashboard shows is
 * derived here once, server-side, so the client only filters and sorts.
 *
 * Bars must be sorted oldest-first, adjusted for splits, and at least ~260
 * sessions long per symbol (the index series needs to cover the same dates).
 */
export function runScan(
  universe: UniverseEntry[],
  barsBySymbol: Map<string, Bar[]>,
  indexBars: Bar[],
): ScanResult {
  const indexDates = new Map<string, number>();
  indexBars.forEach((b, i) => indexDates.set(b.date, i));
  const indexCloses = indexBars.map((b) => b.close);

  // Trace window: the last `trace` sessions of the index.
  const traceStart = Math.max(0, indexBars.length - CONFIG.trace);
  const dates = indexBars.slice(traceStart).map((b) => b.date);
  const nTrace = dates.length;

  const stocks: StockRow[] = [];
  const failed: string[] = [];
  const scoreMatrix: Map<string, (number | null)[]> = new Map();

  for (const entry of universe) {
    const bars = barsBySymbol.get(entry.symbol);
    if (!bars || bars.length < 210) {
      failed.push(entry.symbol);
      continue;
    }
    // A name whose last bar trails the index has been renamed away or
    // suspended; scoring it on stale bars would be a lie.
    const lastIdx = indexDates.get(bars[bars.length - 1].date);
    if (lastIdx === undefined || lastIdx < indexBars.length - 3) {
      failed.push(entry.symbol);
      continue;
    }
    const p = precompute(bars);
    const scores: (number | null)[] = p.dates.map((_, i) => {
      const idx = indexDates.get(bars[i].date);
      if (idx === undefined) return null;
      const readings = evaluateAt(p, i, indexCloses, idx);
      if (readings.some((r) => r === null)) return null;
      let s = 0;
      for (const r of readings) if (r!.pass) s++;
      return s;
    });
    scoreMatrix.set(entry.symbol, scores);

    const last = bars.length - 1;
    const idx = indexDates.get(bars[last].date);
    const readings =
      idx !== undefined ? evaluateAt(p, last, indexCloses, idx) : evaluateAt(p, last, null, null);
    if (readings.some((r) => r === null)) {
      failed.push(entry.symbol);
      continue;
    }

    const score = scores[last] as number;
    const prevScore = scores[last - 1];

    // Held: consecutive sessions ending today with exactly this score.
    let held = 1;
    for (let i = last - 1; i >= 0 && scores[i] === score; i--) held++;

    const close = p.closes[last];
    const prevClose = p.closes[last - 1];
    const s20 = p.sma20[last]!;

    const hist = scores.slice(traceStart);
    stocks.push({
      symbol: entry.symbol,
      name: entry.name,
      sector: entry.sector,
      fno: entry.fno,
      close: round2(close),
      chgPct: round2(pctChange(prevClose, close)),
      vs20Dma: round2(pctChange(s20, close)),
      volume: p.volumes[last],
      score,
      delta: prevScore === null || prevScore === undefined ? 0 : score - (prevScore as number),
      held: Math.min(held, 99),
      band: bandOf(score),
      conds: readings.map((r) => r!.pass as boolean),
      condValues: readings.map((r) => r!.value ?? ""),
      scoreHist: hist.map((s) => s ?? 0),
      closeHist: p.closes.slice(traceStart).map((c) => round2(c)),
    });
  }

  // ---- Breadth history over the trace window ----
  const at9: number[] = [];
  const meanScore: number[] = [];
  const passCounts: number[][] = Array.from({ length: 11 }, () => new Array(nTrace).fill(0));
  const validPerDay: number[] = new Array(nTrace).fill(0);

  for (const s of stocks) {
    const scores = scoreMatrix.get(s.symbol)!;
    for (let t = 0; t < nTrace; t++) {
      const sc = scores[traceStart + t];
      if (sc === null || sc === undefined) continue;
      validPerDay[t]++;
      if (sc >= 9) at9[t] = (at9[t] ?? 0) + 1;
      meanScore[t] = (meanScore[t] ?? 0) + sc;
    }
    // Today's per-condition counts.
    s.conds.forEach((pass, ci) => {
      if (pass) passCounts[ci][nTrace - 1]++;
    });
  }
  for (let t = 0; t < nTrace; t++) {
    if (!meanScore[t]) meanScore[t] = 0;
    meanScore[t] = round2(meanScore[t] / Math.max(1, validPerDay[t] || 1));
  }

  // ---- Movers: score changed today, listed under the highest tier touched ----
  const movers: Mover[] = stocks
    .filter((s) => s.delta !== 0)
    .map((s) => {
      const to = s.score;
      const from = s.score - s.delta;
      return {
        symbol: s.symbol,
        name: s.name,
        sector: s.sector,
        fno: s.fno,
        from,
        to,
        tier: bandOf(Math.max(from, to)),
      };
    });

  // ---- Pass rates ----
  const passRates: PassRate[] = COND_DOCS.map((doc, ci) => ({
    key: doc.key,
    label: doc.label,
    short: doc.short,
    group: doc.group,
    pct: Math.round((passCounts[ci][nTrace - 1] / Math.max(1, stocks.length)) * 100),
  }));

  // ---- Sectors ----
  const bySector = new Map<string, StockRow[]>();
  for (const s of stocks) {
    const list = bySector.get(s.sector) ?? [];
    list.push(s);
    bySector.set(s.sector, list);
  }
  const sectors: SectorAgg[] = [...bySector.entries()]
    .map(([sector, list]) => ({
      sector,
      total: list.length,
      at9: list.filter((s) => s.score >= 9).length,
      mean: round2(list.reduce((a, s) => a + s.score, 0) / list.length),
    }))
    .sort((a, b) => b.mean - a.mean || b.total - a.total);

  const session = indexBars[indexBars.length - 1].date;

  return {
    generatedAt: new Date().toISOString(),
    session,
    universe: universe.length,
    failed,
    conditions: COND_DOCS,
    breadth: { dates, at9, meanScore },
    passRates,
    sectors,
    movers,
    stocks: stocks.sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol)),
  };
}
