/**
 * Universe freeze: fuses RPCI's published scanned set (the BSE 1000 core,
 * taken from the last mirrored session) with the standing NSE+BSE liquidity
 * cut, so the scan covers every name the reference scans plus enough extra
 * liquid names to clear 1000 scored stocks.
 *
 *   tsx scripts/freeze-universe.ts
 *
 * Writes data/universe.json and regenerates src/lib/universe.ts. Run once
 * per reference-universe refresh (the mirror payload changes ~monthly with
 * BSE's index snapshot); the scan reads the frozen module, never the live
 * payload, so day-to-day output stays reproducible.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const SCAN_FILE = path.join(ROOT, "public", "scan.json");
const BARS_FILE = path.join(ROOT, "data", "bars.json");
const OLD_UNIVERSE = path.join(ROOT, "data", "universe.json");
const OUT_JSON = path.join(ROOT, "data", "universe.json");
const OUT_TS = path.join(ROOT, "src", "lib", "universe.ts");

interface Entry {
  symbol: string;
  exchange: "NSE" | "BSE";
  name: string;
  sector: string;
  industry: string;
  mcapCr: number;
  fno: boolean;
  idx: string[];
  aliases: string[];
}

async function main() {
  const scan = JSON.parse(fs.readFileSync(SCAN_FILE, "utf8")) as {
    session: string;
    rows: Array<{ symbol: string; name: string; sector: string; exchange: string }>;
  };
  const old = JSON.parse(fs.readFileSync(OLD_UNIVERSE, "utf8")) as {
    entries: Entry[];
  };
  const store = JSON.parse(fs.readFileSync(BARS_FILE, "utf8")) as {
    meta: Record<string, { ex: "NSE" | "BSE" }>;
  };

  const bySymbol = new Map<string, Entry>();
  for (const e of old.entries) {
    bySymbol.set(e.symbol, {
      ...e,
      aliases: e.aliases ?? [],
      idx: e.idx ?? [],
    });
  }

  let added = 0;
  for (const r of scan.rows) {
    if (bySymbol.has(r.symbol)) {
      // Prefer the reference's own display name/sector when ours is blank.
      const e = bySymbol.get(r.symbol)!;
      if (!e.name && r.name) e.name = r.name;
      continue;
    }
    const meta = store.meta?.[r.symbol];
    bySymbol.set(r.symbol, {
      symbol: r.symbol,
      exchange: meta?.ex ?? (r.exchange === "BSE" ? "BSE" : "NSE"),
      name: r.name || r.symbol,
      sector: r.sector || "",
      industry: "",
      mcapCr: 0,
      fno: false,
      idx: [],
      aliases: [],
    });
    added++;
  }

  const entries = [...bySymbol.values()];
  const snapshot = {
    snapshotDate: scan.session,
    note: `BSE 1000 core (reference scanned set) + NSE/BSE liquidity extension, ${entries.length} symbols`,
    entries,
  };
  fs.writeFileSync(OUT_JSON, JSON.stringify(snapshot, null, 1));
  writeTsModule(snapshot);
  console.log(
    `froze ${entries.length} symbols (${added} added from the reference set) -> data/universe.json + src/lib/universe.ts`,
  );
}

function writeTsModule(snapshot: unknown) {
  const snap = snapshot as { snapshotDate: string; note: string; entries: unknown[] };
  const ts = `/**
 * Frozen scan universe: the reference dashboard's scanned set (BSE 1000 core)
 * fused with the standing NSE + BSE liquidity cut, ranked by turnover.
 * Frozen ${snap.snapshotDate}; regenerate with scripts/freeze-universe.ts
 * after a reference-universe refresh rather than editing here. Fundamentals
 * enrichment (name, sector, size band) lands in data/fundamentals.json and
 * is joined at scan time, so this list stays a pure ticker/exchange snapshot.
 */
export interface UniverseEntry {
  symbol: string;
  /** Primary tape for this name; cross-listed names sit on NSE. */
  exchange: "NSE" | "BSE";
  name: string;
  sector: string;
  industry: string;
  /** Market cap in ₹ crore, filled by the fundamentals pass. */
  mcapCr: number;
  fno: boolean;
  /** Index memberships known at snapshot time: fno, midcap150, smallcap250. */
  idx: string[];
  /** Predecessor tickers this name traded under inside the data window. */
  aliases: string[];
}

export interface UniverseSnapshot {
  snapshotDate: string;
  note: string;
  entries: UniverseEntry[];
}

const RAW = ${JSON.stringify(snapshot)} as unknown as UniverseSnapshot;

export const UNIVERSE_SNAPSHOT: UniverseSnapshot = RAW;
export const UNIVERSE: UniverseEntry[] = RAW.entries.map((e) => ({
  ...e,
  aliases: e.aliases ?? [],
  idx: e.idx ?? [],
}));
`;
  fs.writeFileSync(OUT_TS, ts);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
