/**
 * NSE + BSE end-of-day data access.
 *
 * Both exchanges publish a UDiS-format bhavcopy per session covering the whole
 * market — public, unauthenticated, CDN-cached, safe to fetch politely at a
 * daily cadence:
 *
 *   NSE: https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_YYYYMMDD_F_0000.csv.zip (series EQ)
 *   BSE: https://www.bseindia.com/download/BhavCopy/Equity/BhavCopy_BSE_CM_0_0_0_YYYYMMDD_F_0000.CSV   (series A)
 *
 * One request per session covers every listed name on that tape.
 */

import type { Bar } from "./types";
export { curlBin, curlText } from "./net";
import { curlBin, curlText } from "./net";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

export function bhavUrl(ymd: string): string {
  return `https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_${ymd.replaceAll("-", "")}_F_0000.csv.zip`;
}

export function bseBhavUrl(ymd: string): string {
  return `https://www.bseindia.com/download/BhavCopy/Equity/BhavCopy_BSE_CM_0_0_0_${ymd.replaceAll("-", "")}_F_0000.CSV`;
}

export function indexUrl(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  return `https://nsearchives.nseindia.com/content/indices/ind_close_all_${d}${m}${y}.csv`;
}

/** Minimal CSV reader that honours quoted fields. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}

async function fetchZipCsv(url: string): Promise<string | null> {
  const buf = await curlBin(url);
  if (!buf) return null;
  const { writeFile, readFile, unlink, rm, readdir } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const zipPath = path.join(tmpdir(), `bhav-${stamp}.zip`);
  const outDir = path.join(tmpdir(), `bhav-out-${stamp}`);
  await writeFile(zipPath, buf);
  try {
    await execFileP("unzip", ["-o", zipPath, "-d", outDir]);
    const files = await readdir(outDir);
    const csv = files.find((f) => f.toLowerCase().endsWith(".csv"));
    if (!csv) return null;
    return await readFile(path.join(outDir, csv), "utf8");
  } catch {
    return null;
  } finally {
    await unlink(zipPath).catch(() => {});
    await rm(outDir, { recursive: true, force: true }).catch(() => {});
  }
}

export interface DayRow {
  date: string;
  /** Keyed by exchange ticker; carries the day's OHLCV plus prev close and rupee turnover. */
  rows: Map<
    string,
    {
      open: number;
      high: number;
      low: number;
      close: number;
      prevClose: number;
      volume: number;
      turnover?: number;
      name?: string;
    }
  >;
}

/**
 * Whole-market equity rows for one session from either exchange. Cash equities
 * are STK rows in series EQ (NSE) or A (BSE). Returns null for holidays and
 * failed downloads; the caller skips the date either way.
 */
async function fetchUdisDay(ymd: string, exchange: "NSE" | "BSE"): Promise<DayRow | null> {
  const url = exchange === "NSE" ? bhavUrl(ymd) : bseBhavUrl(ymd);
  const minRows = 50;
  const text = url.endsWith(".zip") ? await fetchZipCsv(url) : await curlText(url);
  if (!text) return null;
  const parsed = parseCsv(text);
  if (parsed.length < 2) return null;
  const header = parsed[0];
  const col = (name: string) => header.indexOf(name);
  const iSym = col("TckrSymb");
  const iSeries = col("SctySrs");
  const iType = col("FinInstrmTp");
  const iName = col("FinInstrmNm");
  const iDate = col("TradDt");
  const iO = col("OpnPric"), iH = col("HghPric"), iL = col("LwPric"), iC = col("ClsPric");
  const iP = col("PrvsClsgPric");
  const iV = col("TtlTradgVol");
  const iTurnover = col("TtlTrfVal");
  const rows = new Map<
    string,
    { open: number; high: number; low: number; close: number; prevClose: number; volume: number; turnover?: number; name?: string }
  >();
  let date = ymd;
  for (let r = 1; r < parsed.length; r++) {
    const t = parsed[r];
    if (t.length < header.length) continue;
    if (t[iType] !== "STK") continue;
    // NSE cash equities sit in series EQ; BSE spreads them across groups
    // (A/B/T/X/…). BSE groups that are not companies at all — gold bonds (G,
    // GB), ETFs (E), InvITs and funds (IF, IP) — are excluded so the scan
    // only ever sees instruments with real fundamentals.
    const BSE_NON_EQUITY = new Set(["GB", "G", "F", "IF", "IP", "Y", "E"]);
    if (exchange === "NSE" ? t[iSeries] !== "EQ" : BSE_NON_EQUITY.has(t[iSeries])) continue;
    const sym = t[iSym];
    if (!sym) continue;
    const num = (s: string) => Number(s) || 0;
    if (num(t[iC]) <= 0) continue;
    if (t[iDate]) date = t[iDate];
    rows.set(sym, {
      open: num(t[iO]),
      high: num(t[iH]),
      low: num(t[iL]),
      close: num(t[iC]),
      prevClose: num(t[iP]),
      volume: num(t[iV]),
      turnover: iTurnover >= 0 ? num(t[iTurnover]) : undefined,
      name: iName >= 0 && t[iName] ? t[iName] : undefined,
    });
  }
  if (rows.size < minRows) return null; // not a real session
  return { date, rows };
}

/** Whole-market NSE equity rows for one session. */
export async function fetchBhavday(ymd: string): Promise<DayRow | null> {
  return fetchUdisDay(ymd, "NSE");
}

/** Whole-market BSE equity rows for one session. */
export async function fetchBseDay(ymd: string): Promise<DayRow | null> {
  return fetchUdisDay(ymd, "BSE");
}

/** Nifty 50 closes as pseudo-bars (only the close is meaningful). */
export async function fetchIndexDay(ymd: string): Promise<Bar | null> {
  const text = await curlText(indexUrl(ymd));
  if (!text) return null;
  const parsed = parseCsv(text);
  if (parsed.length < 2) return null;
  const header = parsed[0];
  const iName = header.indexOf("Index Name");
  const iClose = header.indexOf("Closing Index Value");
  for (let r = 1; r < parsed.length; r++) {
    if (parsed[r][iName] === "Nifty 50") {
      const close = Number(parsed[r][iClose]);
      if (close > 0) return { date: ymd, open: close, high: close, low: close, close, volume: 0 };
    }
  }
  return null;
}

export function toYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
