/**
 * Universe builder: merged NSE + BSE liquid equities, ranked by rupee
 * turnover, frozen into a committed snapshot.
 *
 *   tsx scripts/build-universe.ts [--sessions 25] [--target 1150]
 *
 * 1. Walks back over recent sessions, pulling the whole-market bhavcopy from
 *    each exchange (one request per tape per day).
 * 2. Ranks every cash-equity symbol by trailing median turnover; NSE wins for
 *    cross-listed names because that is the tape most Indian volume prints on.
 * 3. Keeps the top NSE names plus enough BSE-only names to reach the target.
 * 4. Tags F&O membership from NSE's market-lots file and writes both the JSON
 *    snapshot (data/universe.json) and the typed module (src/lib/universe.ts)
 *    the scan imports.
 */
import fs from "node:fs";
import path from "node:path";
import { toYmd, curlText } from "../src/lib/nse";
import { fetchBhavday, fetchBseDay } from "../src/lib/nse";

const ROOT = path.resolve(__dirname, "..");
const OUT_JSON = path.join(ROOT, "data", "universe.json");
const OUT_TS = path.join(ROOT, "src", "lib", "universe.ts");

interface Args {
  sessions: number;
  target: number;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (k: string, d: number) => {
    const i = argv.indexOf(`--${k}`);
    return i !== -1 && argv[i + 1] ? Number(argv[i + 1]) : d;
  };
  return { sessions: get("sessions", 25), target: get("target", 1150) };
}

/** Known predecessor tickers inside the data window; merged at scan time. */
const ALIASES: Record<string, string[]> = {
  TMCV: ["TATAMOTORS"],
  LTM: ["LTIM"],
};

async function recentSessionDates(n: number): Promise<string[]> {
  const out: string[] = [];
  const probe = new Date();
  probe.setUTCHours(12);
  while (out.length < n && probe.getTime() > Date.now() - 100 * 86400_000) {
    const dow = probe.getUTCDay();
    const d = new Date(probe);
    if (dow !== 0 && dow !== 6) {
      // Probe with the index file: tiny, and present exactly on trading days.
      const ymd = toYmd(d);
      const [y, m, dd] = ymd.split("-");
      const txt = await curlText(
        `https://nsearchives.nseindia.com/content/indices/ind_close_all_${dd}${m}${y}.csv`,
        1,
      );
      if (txt && txt.includes("Nifty 50")) out.push(ymd);
    }
    probe.setUTCDate(probe.getUTCDate() - 1);
  }
  return out.reverse();
}

interface SymbolStat {
  turns: number[];
  name?: string;
}

/**
 * ETFs, gold bonds and other non-company instruments trade with the same
 * series code as equities but have no fundamentals to scan; they would sit
 * in the table as permanent N/A rows and drag the breadth stats. Names are
 * the only field both tapes populate, so the cut is name-based.
 */
function isJunkInstrument(sym: string, name?: string): boolean {
  if (/^SGB/i.test(sym)) return true; // sovereign gold bonds
  if (/^0MSA/i.test(sym)) return true;
  const n = (name ?? "").toUpperCase();
  if (!n) return false;
  return /\bETF\b/.test(n) || /BEES\b/.test(n) || /\bINVIT\b/.test(n);
}

async function main() {
  const args = parseArgs();
  console.log(`probing ${args.sessions} recent sessions…`);
  const days = await recentSessionDates(args.sessions);
  console.log(`sessions: ${days[0]} … ${days[days.length - 1]} (${days.length})`);

  const nseStats = new Map<string, SymbolStat>();
  const bseStats = new Map<string, SymbolStat>();

  for (const ymd of days) {
    const nse = await fetchBhavday(ymd);
    if (nse) {
      for (const [sym, r] of nse.rows) {
        if (!r.turnover) continue;
        if (isJunkInstrument(sym, r.name)) continue;
        const s = nseStats.get(sym) ?? { turns: [] };
        s.turns.push(r.turnover);
        if (!s.name && r.name) s.name = r.name;
        nseStats.set(sym, s);
      }
      console.log(`  nse ${ymd}: ${nse.rows.size} rows`);
    } else console.log(`  nse ${ymd}: unavailable`);
    await new Promise((r) => setTimeout(r, 400));

    const bse = await fetchBseDay(ymd);
    if (bse) {
      for (const [sym, r] of bse.rows) {
        if (!r.turnover) continue;
        if (isJunkInstrument(sym, r.name)) continue;
        const s = bseStats.get(sym) ?? { turns: [], name: r.name };
        if (!s.name && r.name) s.name = r.name;
        s.turns.push(r.turnover);
        bseStats.set(sym, s);
      }
      console.log(`  bse ${ymd}: ${bse.rows.size} rows`);
    } else console.log(`  bse ${ymd}: unavailable`);
    await new Promise((r) => setTimeout(r, 400));
  }

  const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)] ?? 0;
  };

  // Liquidity floor: present on at least 60% of sampled sessions.
  const minSessions = Math.ceil(days.length * 0.6);
  const nseRanked = [...nseStats.entries()]
    .filter(([, s]) => s.turns.length >= minSessions)
    .map(([sym, s]) => ({ sym, med: median(s.turns) }))
    .sort((a, b) => b.med - a.med);
  const nseSet = new Set(nseRanked.map((x) => x.sym));

  const bseOnlyRanked = [...bseStats.entries()]
    .filter(([sym, s]) => s.turns.length >= minSessions && !nseSet.has(sym))
    .map(([sym, s]) => ({ sym, med: median(s.turns), name: s.name }))
    .sort((a, b) => b.med - a.med);

  const nseKeep = Math.min(nseRanked.length, Math.round(args.target * 0.82));
  const bseKeep = Math.max(0, args.target - nseKeep);
  console.log(`keeping ${nseKeep} NSE + ${bseKeep} BSE-only of ${nseRanked.length}/${bseOnlyRanked.length}`);

  // F&O membership from NSE's published market lots. The file lists index
  // derivatives first; individual securities begin below their own header,
  // and the ticker lives in the second column.
  const fno = new Set<string>();
  const fnoTxt = await curlText("https://nsearchives.nseindia.com/content/fo/fo_mktlots.csv");
  if (fnoTxt) {
    let inStocks = false;
    for (const line of fnoTxt.split("\n")) {
      if (/Individual Securities/i.test(line)) {
        inStocks = true;
        continue;
      }
      if (!inStocks) continue;
      const sym = line.split(",")[1]?.trim().toUpperCase();
      if (sym && /^[A-Z0-9&-]+$/.test(sym)) fno.add(sym);
    }
  }
  console.log(`F&O list: ${fno.size} symbols`);

  // Index membership from NSE's published constituent lists. The size-band
  // labels ride the actual index tags (Midcap = NIFTY Midcap 150, Smallcap =
  // NIFTY Smallcap 250) exactly like the reference dashboard's bands.
  const indexMembers: Record<string, Set<string>> = { midcap150: new Set(), smallcap250: new Set() };
  for (const [tag, file] of [
    ["midcap150", "ind_niftymidcap150list.csv"],
    ["smallcap250", "ind_niftysmallcap250list.csv"],
  ] as const) {
    const txt = await curlText(`https://nsearchives.nseindia.com/content/indices/${file}`);
    if (!txt) continue;
    const rows = txt.split("\n");
    const header = rows[0].split(",");
    const iSym = header.indexOf("Symbol");
    if (iSym === -1) continue;
    for (let r = 1; r < rows.length; r++) {
      const sym = rows[r].split(",")[iSym]?.trim().toUpperCase();
      if (sym && /^[A-Z0-9&-]+$/.test(sym)) indexMembers[tag].add(sym);
    }
    console.log(`${tag}: ${indexMembers[tag].size} symbols`);
  }

  const entries = [];
  const memberTags = (sym: string) => {
    const tags: string[] = [];
    if (fno.has(sym)) tags.push("fno");
    if (indexMembers.midcap150.has(sym)) tags.push("midcap150");
    if (indexMembers.smallcap250.has(sym)) tags.push("smallcap250");
    return tags;
  };
  for (const { sym } of nseRanked.slice(0, nseKeep)) {
    entries.push({
      symbol: sym,
      exchange: "NSE",
      name: nseStats.get(sym)?.name ?? "",
      sector: "",
      industry: "",
      mcapCr: 0,
      fno: fno.has(sym),
      idx: memberTags(sym),
      aliases: ALIASES[sym] ?? [],
    });
  }
  for (const { sym, name } of bseOnlyRanked.slice(0, bseKeep)) {
    entries.push({
      symbol: sym,
      exchange: "BSE",
      name: name ?? "",
      sector: "",
      industry: "",
      mcapCr: 0,
      fno: false,
      idx: [],
      aliases: [],
    });
  }

  const snapshot = {
    snapshotDate: days[days.length - 1],
    note: `Merged NSE+BSE liquidity cut, ${entries.length} symbols, built ${new Date().toISOString()}`,
    entries,
  };
  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(snapshot, null, 1));
  writeTsModule(snapshot);
  console.log(`wrote ${OUT_JSON} and ${OUT_TS}`);
}

function writeTsModule(snapshot: unknown) {
  const snap = snapshot as { snapshotDate: string; entries: unknown[] };
  const ts = `/**
 * Frozen scan universe: merged NSE + BSE liquid equities ranked by turnover.
 * Generated by scripts/build-universe.ts on ${snap.snapshotDate}; refresh by
 * rerunning that script rather than editing here. Fundamentals enrichment
 * (name, sector, size band) lands in data/fundamentals.json and is joined at
 * scan time, so this list stays a pure ticker/exchange snapshot.
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

main();
