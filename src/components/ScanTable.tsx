"use client";

import { useMemo } from "react";
import { fmtVol } from "./chartkit";
import type { ScanResult, StockRow } from "@/lib/types";

export interface TableFilters {
  q: string;
  tier: "all" | "9" | "7" | "5" | "0";
  univ: string;
  sec: string;
  ind: string;
  exfno: boolean;
  /** condition index -> 'p' | 'f' | 'v:<value>|<PASS|FAIL>' */
  conds: Record<number, string>;
}

export const TIER_OK: Record<TableFilters["tier"], (sc: number) => boolean> = {
  all: () => true,
  "9": (sc) => sc >= 9,
  "7": (sc) => sc >= 7 && sc < 9,
  "5": (sc) => sc >= 5 && sc < 7,
  "0": (sc) => sc < 5,
};

export function condMatch(r: StockRow, raw: string): boolean {
  // raw is '<condIndex>:<sel>'; sel is one of
  //   p            any passing reading
  //   f            any failing reading
  //   p:<value>    this reading, which must be passing
  //   v:<value>|<STATUS>  this reading with an explicit status
  const colon = raw.indexOf(":");
  if (colon === -1) return true;
  const i = Number(raw.slice(0, colon));
  const sel = raw.slice(colon + 1);
  if (!sel) return true;
  if (sel === "p") return r.st[i] === "1";
  if (sel === "f") return r.st[i] === "0";
  let val: string;
  let wantPass: boolean;
  if (sel.startsWith("p:")) {
    val = sel.slice(2);
    wantPass = true;
  } else {
    const body = sel.startsWith("v:") ? sel.slice(2) : sel;
    const cut = body.lastIndexOf("|");
    val = body.slice(0, cut);
    wantPass = body.slice(cut + 1) === "PASS";
  }
  return r.res[i] === val && (r.st[i] === "1") === wantPass;
}

const TIERS = [
  ["all", "ALL"],
  ["9", "9–11"],
  ["7", "7–8"],
  ["5", "5–6"],
  ["0", "<5"],
] as const;

type SortKey =
  | "sym" | "sc" | "dl" | "sec" | "band" | "px" | "dma" | "chg" | "vol" | "days";

function sortVal(r: StockRow, k: SortKey): number | string {
  switch (k) {
    case "sym": return r.symbol;
    case "sec": return r.sector;
    case "band": return r.band;
    case "sc": return r.score;
    case "dl": return r.delta;
    case "px": return r.close;
    case "dma": return r.dmaPct;
    case "chg": return r.chgPct;
    case "vol": return r.volume;
    case "days": return r.held;
  }
}

export function ScanTable({
  scan,
  filters,
  setFilters,
  sort,
  setSort,
  onOpen,
  onCopyTradingView,
  onDownloadCsv,
}: {
  scan: ScanResult;
  filters: TableFilters;
  setFilters: (f: TableFilters) => void;
  sort: { key: SortKey; dir: 1 | -1 };
  setSort: (s: { key: SortKey; dir: 1 | -1 }) => void;
  onOpen: (sym: string) => void;
  onCopyTradingView: (rows: StockRow[]) => void;
  onDownloadCsv: (rows: StockRow[]) => void;
}) {
  const condActive = Object.values(filters.conds).filter(Boolean).length;

  const current = useMemo(() => {
    const q = filters.q.trim().toUpperCase();
    let out = scan.rows.filter((r) => {
      if (q && !r.symbol.includes(q)) return false;
      if (!TIER_OK[filters.tier](r.score)) return false;
      if (filters.univ && !r.idx.includes(filters.univ)) return false;
      if (filters.sec && r.sector !== filters.sec) return false;
      if (filters.ind) {
        // Industry rides the payload rows only when present; the option list
        // is empty otherwise, so this never fires without data.
        return true;
      }
      if (filters.exfno && r.idx.includes("fno")) return false;
      for (const [ci, v] of Object.entries(filters.conds)) {
        if (!v) continue;
        if (!condMatch(r, `${ci}:${v}`)) return false;
      }      return true;
    });
    out = [...out].sort((a, b) => {
      const va = sortVal(a, sort.key);
      const vb = sortVal(b, sort.key);
      const c = va < vb ? -1 : va > vb ? 1 : 0;
      return c * sort.dir || a.symbol.localeCompare(b.symbol);
    });
    return out;
  }, [scan, filters, sort]);

  const sectors = useMemo(() => [...new Set(scan.rows.map((r) => r.sector))].sort(), [scan]);
  const header = (
    key: SortKey,
    label: string,
    cls = "",
    title?: string,
  ) => (
    <div
      data-s={key}
      className={`${cls} ${sort.key === key ? "sorted" : ""}`}
      title={title}
      onClick={() =>
        setSort(sort.key === key ? { key, dir: (sort.dir * -1) as 1 | -1 } : { key, dir: key === "sym" || key === "sec" || key === "band" ? 1 : -1 })
      }
      role="columnheader"
      aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
    >
      {label}
    </div>
  );

  return (
    <>
      <div className="sech">
        <h2>All stocks</h2>
      </div>
      <p className="readline">
        Every scanned name with its score and the eleven conditions behind it.
        <b> Held</b> is how many consecutive sessions the stock has sat on exactly this score — a 1 means it moved
        today. <b>vs 20 DMA</b> is the close against its own 20-session average. Click a row for the full reading;
        click a column header to sort.
      </p>
      <div className="panel">
        <div className="tbar">
          <input
            className="inp"
            placeholder="ticker…"
            autoComplete="off"
            aria-label="Search ticker"
            value={filters.q}
            onChange={(e) => setFilters({ ...filters, q: e.target.value })}
          />
          <div className="seg">
            {TIERS.map(([t, label]) => (
              <button key={t} className={filters.tier === t ? "on" : ""} onClick={() => setFilters({ ...filters, tier: t as TableFilters["tier"] })}>
                {label}
              </button>
            ))}
          </div>
          <select
            className="sel"
            aria-label="Universe"
            value={filters.univ}
            onChange={(e) => setFilters({ ...filters, univ: e.target.value })}
          >
            <option value="">universe</option>
            {scan.universes.map((u) => (
              <option key={u.tag} value={u.tag}>
                {u.label} ({u.n})
              </option>
            ))}
          </select>
          <select
            className="sel"
            aria-label="Sector"
            value={filters.sec}
            onChange={(e) => setFilters({ ...filters, sec: e.target.value })}
          >
            <option value="">sector</option>
            {sectors.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <label className={`chk ${scan.universes.some((u) => u.tag === "fno") ? "" : ""}`}>
            <input
              type="checkbox"
              checked={filters.exfno}
              onChange={(e) => setFilters({ ...filters, exfno: e.target.checked })}
            />
            exclude F&amp;O
          </label>
          <button
            className="lnk"
            onClick={() =>
              setFilters({ q: "", tier: "all", univ: "", sec: "", ind: "", exfno: false, conds: {} })
            }
          >
            reset all
          </button>
          <div className="tacts">
            <div className="tcount">
              <b>{current.length}</b> of {scan.rows.length}
            </div>
            <button
              className="lnk"
              disabled={!current.length}
              onClick={() => onCopyTradingView(current)}
              title="Copy the filtered list, ready to paste into TradingView's add-symbol box"
            >
              copy for tradingview
            </button>
            <button className="lnk" disabled={!current.length} onClick={() => onDownloadCsv(current)}>
              download csv
            </button>
          </div>
        </div>

        <details className="cfp">
          <summary>
            Filter by condition <s>{condActive ? `${condActive} active` : ""}</s>
          </summary>
          <div className="cfg">
            {scan.labels.map((l, i) => {
              const vals = scan.condValues[i] ?? [];
              const nPass = vals.filter((v) => v.s === "PASS").reduce((a, v) => a + v.n, 0);
              const nFail = vals.filter((v) => v.s === "FAIL").reduce((a, v) => a + v.n, 0);
              return (
                <label key={i}>
                  <span className="eyebrow cl">
                    {i + 1}. {l}
                  </span>
                  <select
                    className="sel"
                    aria-label={`${l} filter`}
                    value={filters.conds[i] ?? ""}
                    onChange={(e) => setFilters({ ...filters, conds: { ...filters.conds, [i]: e.target.value } })}
                  >
                    <option value="">Any</option>
                    {nPass ? <option value="p">Any PASS ({nPass})</option> : null}
                    {nFail ? <option value="f">Any FAIL ({nFail})</option> : null}
                    {vals.map((v) => (
                      <option key={`${v.s}|${v.v}`} value={`${v.s === "PASS" ? "p:" : "v:"}${v.v}|${v.s}`}>
                        {`${v.v} — ${v.s} (${v.n})`}
                      </option>
                    ))}
                  </select>
                </label>
              );
            })}
          </div>
          <div className="cfa">
            <button className="lnk" onClick={() => setFilters({ ...filters, conds: {} })}>
              clear condition filters
            </button>
          </div>
        </details>

        <div className="thead">
          {header("sym", "Ticker")}
          {header("sc", "Score", "r")}
          {header("dl", "Δ", "r h-dl")}
          {header("sec", "Sector", "h-sec")}
          {header("band", "Band", "h-bd")}
          <div>Conditions 1—11</div>
          {header("px", "Close", "r h-px")}
          {header("dma", "vs 20 DMA", "r h-dma")}
          {header("chg", "Chg %", "r")}
          {header("vol", "Volume", "r h-vol")}
          {header("days", "Held", "r h-days", "Consecutive sessions at exactly this score")}
        </div>
        <div id="tb">
          {current.length === 0 ? (
            <div className="empty">No names match these filters.</div>
          ) : (
            current.map((r) => (
              <div
                key={r.symbol}
                className={`tr ${r.score >= 9 ? "top" : ""}`}
                data-sym={r.symbol}
                onClick={() => onOpen(r.symbol)}
              >
                <div className="tk">{r.symbol}</div>
                <div className="sc9 r">{r.score}</div>
                <div className={`dl r h-dl ${r.delta > 0 ? "u" : r.delta < 0 ? "d" : ""}`}>
                  {r.delta === 0 ? "·" : `${r.delta > 0 ? "+" : "\u2212"}${Math.abs(r.delta)}`}
                </div>
                <div className="tsec h-sec">{r.sector}</div>
                <div className="bd h-bd">{r.band || "—"}</div>
                <div className="strip" aria-label={`Conditions passing: ${r.st.split("").filter((x) => x === "1").length} of 11`}>
                  {r.st.split("").map((b, i) => (
                    <i key={i} className={b === "1" ? "" : "off"} />
                  ))}
                </div>
                <div className="num r h-px">{r.close.toLocaleString("en-IN")}</div>
                <div className={`num r h-dma ${r.dmaPct >= 0 ? "u" : "d"}`}>
                  {r.dmaPct >= 0 ? "+" : ""}
                  {r.dmaPct.toFixed(2)}%
                </div>
                <div className={`num r ${r.chgPct > 0 ? "u" : r.chgPct < 0 ? "d" : ""}`}>
                  {r.chgPct > 0 ? "+" : ""}
                  {r.chgPct.toFixed(2)}%
                </div>
                <div className="dd r h-vol">{fmtVol(r.volume)}</div>
                <div className="dd r h-days">{r.held}</div>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
