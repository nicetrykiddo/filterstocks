/**
 * Fundamentals fetcher: company numbers the price tape cannot provide.
 *
 *   tsx scripts/fetch-fundamentals.ts [--force] [--delay 350]
 *
 * For every universe symbol it reads the Screener.in company page and pulls
 * display name, broad sector, industry, market cap, trailing P/E, ROE and
 * TTM profit growth — the inputs for the Valuation and Earnings Power
 * conditions plus sector/size metadata. Results cache in
 * data/fundamentals.json; entries younger than seven days are skipped unless
 * --force. Requests run serially with a jittered delay: this is a polite,
 * low-volume crawl of pages any visitor could read, not an attempt at scale.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { curlText, UA } from "../src/lib/net";
import { UNIVERSE } from "../src/lib/universe";

const execFileP = promisify(execFile);

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "data", "fundamentals.json");
const BSE_LIST = path.join(ROOT, "data", "bse-list.json");
const STALE_MS = 7 * 86400_000;

interface Fundamentals {
  name: string;
  broadSector: string;
  sector: string;
  industry: string;
  mcapCr: number;
  pe: number | null;
  roe: number | null;
  profitGrowthTtm: number | null;
  fetchedAt: string;
}

type Cache = Record<string, Fundamentals>;

function loadCache(): Cache {
  if (fs.existsSync(OUT)) return JSON.parse(fs.readFileSync(OUT, "utf8"));
  return {};
}

interface BseEntry {
  name: string;
  mcapCr: number;
}

/**
 * BSE's full scrip list — company names and market caps for the BSE-only
 * tail that Screener does not carry. One request with a cookie jar; the API
 * redirects to the marketing site without it. Cached for a week like the
 * fundamentals themselves.
 */
async function loadBseList(): Promise<Map<string, BseEntry>> {
  const fresh =
    fs.existsSync(BSE_LIST) &&
    Date.now() - fs.statSync(BSE_LIST).mtimeMs < STALE_MS;
  if (fresh) {
    const raw = JSON.parse(fs.readFileSync(BSE_LIST, "utf8"));
    return new Map(Object.entries(raw as Record<string, BseEntry>));
  }
  const jar = path.join(os.tmpdir(), `bse-jar-${process.pid}.txt`);
  try {
    const { stdout } = await execFileP(
      "curl",
      ["-sL", "--max-time", "60", "-A", UA, "-c", jar, "-b", jar, "-e", "https://www.bseindia.com/",
        "https://api.bseindia.com/BseIndiaAPI/api/ListofScripData/w?Group=&Scripcode=&industry=&segment=Equity&status=Active"],
      { maxBuffer: 64 * 1024 * 1024, timeout: 70_000, encoding: "buffer" },
    );
    const list = JSON.parse(stdout.toString("utf8")) as Array<{
      scrip_id?: string;
      Scrip_Name?: string;
      Mktcap?: string;
    }>;
    const out = new Map<string, BseEntry>();
    for (const r of list) {
      if (!r.scrip_id || !r.Scrip_Name) continue;
      const mcapCr = Number(String(r.Mktcap ?? "").replaceAll(",", "")) || 0;
      out.set(r.scrip_id, { name: r.Scrip_Name, mcapCr });
    }
    fs.mkdirSync(path.dirname(BSE_LIST), { recursive: true });
    fs.writeFileSync(BSE_LIST, JSON.stringify(Object.fromEntries(out)));
    console.log(`BSE scrip list cached: ${out.size} symbols`);
    return out;
  } catch (e) {
    console.error("BSE scrip list unavailable:", (e as Error).message);
    return new Map();
  } finally {
    fs.unlink(jar, () => {});
  }
}

/** Screener company-search API: symbol page misses are resolved by name. */
async function searchCompany(query: string): Promise<string | null> {
  const txt = await curlText(
    `https://www.screener.in/api/company/search/?q=${encodeURIComponent(query)}`,
    2,
  );
  if (!txt) return null;
  try {
    const hits = JSON.parse(txt) as Array<{ url?: string }>;
    const url = hits.find((h) => h.url)?.url;
    if (!url) return null;
    return url.startsWith("/") ? `https://www.screener.in${url}` : url;
  } catch {
    return null;
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** First <li> whose .name label matches `label`, then its .number text. */
function topRatio(html: string, label: string): string | null {
  const re = new RegExp(
    `<span class="name">\\s*${label}\\s*</span>[\\s\\S]{0,400}?<span class="number">([\\d.,]+)`,
  );
  const m = html.match(re);
  return m ? m[1] : null;
}

function parsePage(html: string): Omit<Fundamentals, "fetchedAt"> | null {
  const nameMatch =
    html.match(/<h1 class="margin-0 show-from-tablet-landscape">([^<]+)<\/h1>/) ??
    html.match(/<h1[^>]*>([^<]{2,80})<\/h1>/);
  const num = (s: string | null) => (s ? Number(s.replaceAll(",", "")) || null : null);

  const title = (t: string) => {
    const m = html.match(new RegExp(`title="${t}">([^<]+)</a>`));
    return m ? decodeEntities(m[1]) : "";
  };

  // Compounded Profit Growth table → TTM row.
  let growth: number | null = null;
  const gIdx = html.indexOf("Compounded Profit Growth");
  if (gIdx !== -1) {
    const seg = html.slice(gIdx, gIdx + 900);
    const ttm = seg.match(/TTM:\s*<\/td>\s*<td>\s*(-?[\d.]+)%/);
    if (ttm) growth = Number(ttm[1]);
  }

  const name = nameMatch ? decodeEntities(nameMatch[1]) : "";
  if (!name) return null;
  return {
    name,
    broadSector: title("Broad Sector"),
    sector: title("Sector"),
    industry: title("Industry"),
    mcapCr: num(topRatio(html, "Market Cap")) ?? 0,
    pe: num(topRatio(html, "Stock P/E")),
    roe: num(topRatio(html, "ROE")) ?? num(topRatio(html, "ROCE")),
    profitGrowthTtm: growth,
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const force = argv.includes("--force");
  const delayIdx = argv.indexOf("--delay");
  const delay = delayIdx !== -1 ? Number(argv[delayIdx + 1]) : 350;

  const cache = loadCache();
  const todo = UNIVERSE.filter((u) => {
    const hit = cache[u.symbol];
    if (!hit) return true;
    if (force || Date.now() - new Date(hit.fetchedAt).getTime() > STALE_MS) return true;
    // Retry once for entries that came back empty.
    return !hit.name;
  });
  console.log(`${todo.length} of ${UNIVERSE.length} symbols need fundamentals`);

  let bse: Map<string, BseEntry> | null = null;
  const bseFor = async (sym: string) => {
    bse ??= await loadBseList();
    return bse.get(sym) ?? null;
  };

  let done = 0;
  let failed = 0;
  for (const u of todo) {
    const slug = encodeURIComponent(u.symbol);
    let html = await curlText(`https://www.screener.in/company/${slug}/consolidated/`, 2);
    if (!html || !html.includes("<h1"))
      html = await curlText(`https://www.screener.in/company/${slug}/`, 2);
    let parsed = html ? parsePage(html) : null;

    // BSE-only tail: Screener's symbol page often 404s, but the company is
    // searchable by name once the BSE scrip list supplies it.
    const be = parsed ? null : await bseFor(u.symbol);
    if (!parsed && be) {
      const url = await searchCompany(be.name);
      if (url) {
        const h2 = await curlText(url, 2);
        if (h2) parsed = parsePage(h2);
      }
    }
    if (parsed && be && !parsed.mcapCr) parsed.mcapCr = be.mcapCr;
    if (!parsed && be) {
      // Last resort: name and size from BSE; sector/industry stay empty and
      // the scan reads them as Diversified rather than inventing a bucket.
      parsed = {
        name: be.name,
        broadSector: "",
        sector: "",
        industry: "",
        mcapCr: be.mcapCr,
        pe: null,
        roe: null,
        profitGrowthTtm: null,
      };
    }

    if (parsed) {
      cache[u.symbol] = { ...parsed, fetchedAt: new Date().toISOString() };
      done++;
    } else {
      failed++;
      // Keep the miss so reruns do not hammer a dead page every day.
      cache[u.symbol] ??= {
        name: "",
        broadSector: "",
        sector: "",
        industry: "",
        mcapCr: 0,
        pe: null,
        roe: null,
        profitGrowthTtm: null,
        fetchedAt: new Date().toISOString(),
      };
    }
    if ((done + failed) % 25 === 0) {
      fs.writeFileSync(OUT, JSON.stringify(cache));
      console.log(`  ${done + failed}/${todo.length} processed (${done} ok, ${failed} failed)`);
    }
    await new Promise((r) => setTimeout(r, delay + Math.random() * delay));
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(cache));
  console.log(`fundamentals cached: ${Object.keys(cache).length} entries (${done} fresh, ${failed} misses)`);
}

main();
