/**
 * Reference fetcher.
 *
 *   tsx scripts/fetch-rpci.ts
 *
 * Fetches the public RPCI daily-scan dashboard (rpci.stratlab.in), extracts
 * the session payload it ships, and rewrites it into this app's ScanResult
 * schema under data/reference/scan-<session>.json. The file is the yardstick
 * for scripts/calibrate.ts and scripts/parity.ts — the engine's agreement
 * with the reference's published readings is measured against it. One polite
 * request per run; the payload is what any browser visitor receives.
 *
 * RPCI computes its eleven conditions server-side and does not publish the
 * formulas — this fetcher archives the published readings, it does not feed
 * the dashboard (the dashboard is computed by our own engine via
 * scripts/update.ts).
 */
import fs from "node:fs";
import path from "node:path";
import { curlText } from "../src/lib/net";
import type {
  BreadthPoint,
  CondStat,
  CondValue,
  ConditionDoc,
  Mover,
  ScanResult,
  SectorAgg,
  StockRow,
  UniverseDef,
} from "../src/lib/types";

const ROOT = path.resolve(__dirname, "..");
const REF_DIR = path.join(ROOT, "data", "reference");
const FUND_FILE = path.join(ROOT, "data", "fundamentals.json");

const RPCI_URL = "https://rpci.stratlab.in/";

/* eslint-disable @typescript-eslint/no-explicit-any */
type R = any;

function extractPayload(html: string): R {
  const marker = html.indexOf("const D");
  if (marker === -1) throw new Error("payload marker not found");
  const start = html.indexOf("{", marker);
  if (start === -1) throw new Error("payload object not found");
  // Balanced-brace scan; the payload is a plain JSON object literal.
  let depth = 0;
  let inString = false;
  let esc = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return JSON.parse(html.slice(start, i + 1));
    }
  }
  throw new Error("payload unbalanced");
}

/** Screener company page → display name, for rows missing from our cache. */
async function fetchName(sym: string): Promise<string> {
  const html = await curlText(`https://www.screener.in/company/${encodeURIComponent(sym)}/consolidated/`, 2)
    ?? await curlText(`https://www.screener.in/company/${encodeURIComponent(sym)}/`, 2);
  if (!html) return "";
  const m =
    html.match(/<h1 class="margin-0 show-from-tablet-landscape">([^<]+)<\/h1>/) ??
    html.match(/<h1[^>]*>([^<]{2,80})<\/h1>/);
  if (!m) return "";
  return m[1]
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function docs(d: R): ConditionDoc[] {
  const labels: string[] = d.labels;
  const abbrevs: string[] = d.abbrev;
  const slugs: string[] = d.slugs;
  const values: Array<Array<{ v: string; s: string; n: number }>> = d.cond_values ?? [];
  return labels.map((label, i) => {
    const vocab = (values[i] ?? [])
      .map((c) => c.v)
      .filter((v, idx, arr) => arr.indexOf(v) === idx)
      .join(" / ");
    return {
      key: slugs[i] ?? label.toLowerCase().replace(/\W+/g, "_"),
      label,
      abbrev: abbrevs[i] ?? label.slice(0, 3).toUpperCase(),
      slug: slugs[i] ?? "",
      short: vocab ? `Reads ${vocab}.` : "Pass/fail reading.",
      detail:
        "Computed by the RPCI scan pipeline from end-of-day data. RPCI does not publish the computational definition of this condition on the public dashboard; this dashboard mirrors the published reading.",
    };
  });
}

async function main() {
  const html = await curlText(RPCI_URL, 3);
  if (!html) throw new Error("RPCI fetch failed");
  const d = extractPayload(html);

  const labels: string[] = d.labels;
  if (!Array.isArray(labels) || labels.length !== 11) {
    throw new Error(`unexpected payload shape: ${labels.length} labels`);
  }

  const fundCache: Record<string, { name?: string }> = fs.existsSync(FUND_FILE)
    ? JSON.parse(fs.readFileSync(FUND_FILE, "utf8"))
    : {};
  const nameFor = async (sym: string): Promise<string> => {
    const hit = fundCache[sym];
    if (hit?.name) return hit.name;
    const name = await fetchName(sym);
    if (name) {
      fundCache[sym] = { ...(fundCache[sym] ?? {}), name };
      fs.writeFileSync(FUND_FILE, JSON.stringify(fundCache));
    }
    return name;
  };

  // Names: resolve serially with a polite delay only for the misses; the
  // cache covers the vast majority after the first run.
  const nameBySym = new Map<string, string>();
  const misses = (d.rows as R[]).filter((r) => !(fundCache[r.sym]?.name));
  let resolved = 0;
  for (const r of misses) {
    const n = await nameFor(r.sym);
    if (n) nameBySym.set(r.sym, n);
    resolved++;
    if (resolved % 25 === 0) console.log(`  names ${resolved}/${misses.length}`);
    await new Promise((res) => setTimeout(res, 250 + Math.random() * 250));
  }

  const rows: StockRow[] = (d.rows as R[]).map((r) => {
    const score = r.sc as number;
    const bits = String(r.st).split("").filter((c) => c === "1").length;
    if (score !== bits) throw new Error(`score/bits mismatch for ${r.sym}: ${score} vs ${bits}`);
    const prev = r.prev === null || r.prev === undefined ? null : (r.prev as number);
    const tv = String(r.tv ?? "");
    return {
      symbol: r.sym,
      tvSymbol: tv,
      exchange: tv.startsWith("BSE:") ? "BSE" : "NSE",
      name: fundCache[r.sym]?.name ?? nameBySym.get(r.sym) ?? "",
      sector: r.sec ?? "",
      band: r.band ?? "",
      idx: r.idx ?? [],
      close: r.px,
      chgPct: r.chg,
      volume: r.vol,
      ma20: r.ma20 ?? null,
      dmaPct: r.dma ?? 0,
      score,
      prev,
      delta: prev === null ? 0 : score - prev,
      held: r.days ?? 1,
      st: String(r.st),
      res: r.res ?? [],
      hist: r.h ?? [],
      histDates: r.hd ?? [],
    };
  });

  const breadthR = d.breadth ?? {};
  const breadth = {
    universe: breadthR.universe ?? rows.length,
    mean: breadthR.mean ?? 0,
    median: breadthR.median ?? 0,
    n9: breadthR.n9 ?? 0,
    n7: breadthR.n7 ?? 0,
    below5: breadthR.below5 ?? 0,
    aboveMa20: breadthR.above_ma20 ?? 0,
    withMa20: breadthR.with_ma20 ?? 0,
  };

  const transR = d.trans ?? {};
  const moverOf = (m: R): Mover => ({
    symbol: m.sym,
    name: fundCache[m.sym]?.name ?? nameBySym.get(m.sym) ?? "",
    sector: m.sec ?? "",
    p: m.p,
    s: m.s,
    g: m.g ?? [],
    l: m.l ?? [],
  });

  const sectors: SectorAgg[] = (d.sectors ?? []).map((s: R) => ({
    name: s.s,
    n: s.n,
    mean: s.mean,
    n9: s.n9,
    n7: s.n7,
    h: s.h ?? [],
    prevMean: s.prev_mean ?? null,
  }));

  const conds: CondStat[] = (d.conds ?? []).map((c: R) => ({
    label: c.label,
    ab: c.ab,
    i: c.i,
    pass: c.pass,
    prev: c.prev === null || c.prev === undefined ? null : c.prev,
    n: c.n,
  }));

  const condValues: CondValue[][] = (d.cond_values ?? []).map(
    (arr: Array<{ v: string; s: string; n: number }>) =>
      (arr ?? []).map((c) => ({ v: c.v, s: c.s, n: c.n })),
  );

  const universes: UniverseDef[] = (d.universes ?? []).map((u: R) => ({
    tag: u.tag,
    label: u.label,
    field: u.field ?? "idx",
    n: u.n,
  }));

  const hist = d.hist ?? {};
  const breadthHist: BreadthPoint[] = (d.breadth_hist ?? d.hist_points ?? []).length
    ? (d.breadth_hist ?? d.hist_points).map((h: R) => ({ d: h.d, mean: h.mean, n9: h.n9, n: h.n }))
    : [];

  const session = d.day as string;
  const scan: ScanResult = {
    generatedAt: new Date().toISOString(),
    session,
    prevSession: d.prev ?? null,
    sessionPretty: d.day_pretty ?? session,
    nDays: d.n_days ?? breadthHist.length,
    market: "in",
    universeNote: d.universe_note ?? "",
    run: {
      total: d.run?.total ?? rows.length,
      clean: d.run?.clean ?? rows.length,
      quar: d.run?.quar ?? 0,
    },
    labels,
    abbrevs: d.abbrev ?? [],
    slugs: d.slugs ?? [],
    conditions: docs(d),
    rows,
    breadth,
    trans: {
      ups: (transR.ups ?? []).map(moverOf),
      dns: (transR.dns ?? []).map(moverOf),
      nUp: transR.n_up ?? 0,
      nDn: transR.n_dn ?? 0,
      unchanged: transR.unchanged ?? 0,
      entered: transR.entered ?? 0,
      lost: transR.lost ?? 0,
    },
    sectors,
    conds,
    condValues,
    universes,
    industries: d.industries ?? [],
    breadthHist,
    histMeta: {
      from: hist.from ?? session,
      sessions: hist.sessions ?? breadthHist.length,
      liveFrom: hist.live_from ?? hist.from ?? session,
      fromPretty: hist.from_pretty ?? hist.from ?? session,
      liveFromPretty: hist.live_from_pretty ?? hist.live_from ?? hist.from ?? session,
    },
    lede: d.lede ?? "",
    sub: d.sub ?? "",
    reads: {
      breadth: d.reads?.breadth ?? "",
      movers: d.reads?.movers ?? "",
      cond: d.reads?.cond ?? "",
      sector: d.reads?.sector ?? "",
    },
  };

  // Mirror invariants, loudly: a malformed upstream payload must fail CI,
  // not silently publish a broken table.
  const sum = scan.trans.nUp + scan.trans.nDn + scan.trans.unchanged;
  if (rows.length && sum !== rows.length) {
    throw new Error(`transition sum mismatch: ${sum} vs ${rows.length} rows`);
  }
  if (scan.conds.length !== 11) throw new Error(`conds ${scan.conds.length}`);

  fs.mkdirSync(REF_DIR, { recursive: true });
  const outFile = path.join(REF_DIR, `scan-${scan.session}.json`);
  fs.writeFileSync(outFile, JSON.stringify(scan));
  console.log(
    `archived ${outFile}: ${scan.run.clean} scanned, ${scan.run.quar} quarantined, ` +
      `n9 ${scan.breadth.n9}, mean ${scan.breadth.mean}, movers ${scan.trans.nUp}+${scan.trans.nDn}`,
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
