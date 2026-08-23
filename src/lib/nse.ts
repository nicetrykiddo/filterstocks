/**
 * NSE end-of-day data access.
 *
 * Source: NSE's UDiS common bhavcopy (one zip per session, whole market) and
 * the all-indices closing file. Both are public, unauthenticated, and cached
 * by NSE's CDN, which makes them safe to fetch politely at a daily cadence.
 *
 *   Bhavcopy: https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_YYYYMMDD_F_0000.csv.zip
 *   Indices:  https://nsearchives.nseindia.com/content/indices/ind_close_all_DDMMYYYY.csv
 */

import type { Bar } from "./types";

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

export function bhavUrl(ymd: string): string {
  return `https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_${ymd.replaceAll("-", "")}_F_0000.csv.zip`;
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

/**
 * NSE's CDN (Akamai) fingerprints TLS clients and 403s Node's fetch, while
 * curl passes. All network access therefore goes through curl via child
 * processes. This file only ever runs in the update script and CI, where
 * curl is available.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileP = promisify(execFile);

async function curl(url: string): Promise<Buffer | null> {
  try {
    const { stdout } = await execFileP(
      "curl",
      ["-s", "--fail", "--max-time", "30", "--compressed", "-A", UA, url],
      { maxBuffer: 80 * 1024 * 1024, timeout: 35000, encoding: "buffer" },
    );
    return stdout;
  } catch {
    return null;
  }
}

async function fetchText(url: string): Promise<string | null> {
  const buf = await curl(url);
  return buf ? buf.toString("utf8") : null;
}

async function fetchZipCsv(url: string): Promise<string | null> {
  const buf = await curl(url);
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
  rows: Map<string, { open: number; high: number; low: number; close: number; prevClose: number; volume: number }>;
}

/** Returns null for holidays/failed downloads (caller skips the date). */
export async function fetchBhavday(ymd: string): Promise<DayRow | null> {
  const text = await fetchZipCsv(bhavUrl(ymd));
  if (!text) return null;
  const parsed = parseCsv(text);
  if (parsed.length < 2) return null;
  const header = parsed[0];
  const col = (name: string) => header.indexOf(name);
  const iSym = col("TckrSymb");
  const iSeries = col("SctySrs");
  const iType = col("FinInstrmTp");
  const iDate = col("TradDt");
  const iO = col("OpnPric"), iH = col("HghPric"), iL = col("LwPric"), iC = col("ClsPric");
  const iP = col("PrvsClsgPric");
  const iV = col("TtlTradgVol");
  const rows = new Map<string, { open: number; high: number; low: number; close: number; prevClose: number; volume: number }>();
  let date = ymd;
  for (let r = 1; r < parsed.length; r++) {
    const t = parsed[r];
    if (t.length < header.length) continue;
    if (t[iType] !== "STK" || t[iSeries] !== "EQ") continue;
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
    });
  }
  if (rows.size < 50) return null; // not a real session
  return { date, rows };
}

/** Nifty 50 closes as pseudo-bars (only the close is meaningful). */
export async function fetchIndexDay(ymd: string): Promise<Bar | null> {
  const text = await fetchText(indexUrl(ymd));
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
