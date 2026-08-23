"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowsCounterClockwise, CopySimple, DownloadSimple, MagnifyingGlass } from "@phosphor-icons/react";
import { fmtPct, fmtPrice, fmtVolume } from "@/lib/format";
import type { Band, ScanResult, StockRow } from "@/lib/types";
import { CondStrip } from "./CondStrip";
import { BandChip, DeltaText, EmptyState, Tabs } from "./ui";

export type SortKey = "score" | "delta" | "symbol" | "sector" | "close" | "vs20Dma" | "chgPct" | "volume" | "held";
type BandFilter = "ALL" | Band;
type FnoFilter = "all" | "only" | "exclude";

export interface TableFilters {
  q: string;
  band: BandFilter;
  fno: FnoFilter;
  conds: number[];
}

const defaultFilters: TableFilters = { q: "", band: "ALL", fno: "all", conds: [] };

export function ScanTable({
  scan,
  filters,
  setFilters,
  onOpen,
  onCopyTradingView,
  onDownloadCsv,
}: {
  scan: ScanResult;
  filters: TableFilters;
  setFilters: (f: TableFilters) => void;
  onOpen: (symbol: string) => void;
  onCopyTradingView: (rows: StockRow[]) => void;
  onDownloadCsv: (rows: StockRow[]) => void;
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "score", dir: "desc" });

  const counts = useMemo(() => {
    const c = { "9-11": 0, "7-8": 0, "5-6": 0, "<5": 0 } as Record<Band, number>;
    for (const s of scan.stocks) c[s.band]++;
    return c;
  }, [scan]);

  const rows = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    const out = scan.stocks.filter((s) => {
      if (q && !s.symbol.toLowerCase().includes(q) && !s.name.toLowerCase().includes(q)) return false;
      if (filters.band !== "ALL" && s.band !== filters.band) return false;
      if (filters.fno === "only" && !s.fno) return false;
      if (filters.fno === "exclude" && s.fno) return false;
      for (const ci of filters.conds) if (!s.conds[ci]) return false;
      return true;
    });
    const dir = sort.dir === "asc" ? 1 : -1;
    out.sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (typeof av === "string" || typeof bv === "string") {
        return String(av).localeCompare(String(bv)) * dir;
      }
      return ((av as number) - (bv as number)) * dir || a.symbol.localeCompare(b.symbol);
    });
    return out;
  }, [scan, filters, sort]);

  const dirty =
    filters.q !== "" || filters.band !== "ALL" || filters.fno !== "all" || filters.conds.length > 0;

  const toggleSort = (key: SortKey) => {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" }));
  };

  const toggleCond = (i: number) => {
    setFilters({
      ...filters,
      conds: filters.conds.includes(i) ? filters.conds.filter((x) => x !== i) : [...filters.conds, i],
    });
  };

  return (
    <section aria-label="All stocks">
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-3">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight text-ink">All stocks</h2>
          <p className="num mt-0.5 text-[11.5px] text-ink3">
            showing {rows.length} of {scan.stocks.length} names · sorted by {labelOf(sort.key)}{" "}
            {sort.dir === "desc" ? "high to low" : "low to high"}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label className="relative">
            <span className="sr-only">Search ticker or company</span>
            <MagnifyingGlass size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink3" aria-hidden />
            <input
              type="search"
              value={filters.q}
              onChange={(e) => setFilters({ ...filters, q: e.target.value })}
              placeholder="Ticker or company"
              className="num w-[190px] rounded-[4px] border border-rule bg-surface py-1.5 pl-8 pr-2.5 text-[12.5px] text-ink placeholder:text-ink3 focus:border-accent focus:outline-none"
            />
          </label>
          <label className="sr-only" htmlFor="fno-filter">Derivatives filter</label>
          <select
            id="fno-filter"
            value={filters.fno}
            onChange={(e) => setFilters({ ...filters, fno: e.target.value as FnoFilter })}
            className="num cursor-pointer rounded-[4px] border border-rule bg-surface px-2 py-1.5 text-[12.5px] text-ink2 focus:border-accent focus:outline-none"
          >
            <option value="all">F&O: all</option>
            <option value="only">F&O only</option>
            <option value="exclude">Exclude F&O</option>
          </select>
          <button
            type="button"
            onClick={() => onCopyTradingView(rows)}
            disabled={rows.length === 0}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-[4px] border border-rule bg-surface px-2.5 py-1.5 text-[12.5px] font-medium text-ink transition-colors hover:border-ink3 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <CopySimple size={14} aria-hidden /> TradingView
          </button>
          <button
            type="button"
            onClick={() => onDownloadCsv(rows)}
            disabled={rows.length === 0}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-[4px] border border-rule bg-surface px-2.5 py-1.5 text-[12.5px] font-medium text-ink transition-colors hover:border-ink3 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <DownloadSimple size={14} aria-hidden /> CSV
          </button>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Tabs
          value={filters.band}
          onChange={(band) => setFilters({ ...filters, band })}
          options={[
            { value: "ALL" as BandFilter, label: "All", count: scan.stocks.length },
            { value: "9-11" as BandFilter, label: "9-11", count: counts["9-11"] },
            { value: "7-8" as BandFilter, label: "7-8", count: counts["7-8"] },
            { value: "5-6" as BandFilter, label: "5-6", count: counts["5-6"] },
            { value: "<5" as BandFilter, label: "<5", count: counts["<5"] },
          ]}
        />
        {filters.conds.length > 0 && (
          <span className="inline-flex flex-wrap items-center gap-1.5 rounded-[4px] border border-accent/40 bg-accent-soft/50 px-2 py-1 text-[11.5px] text-ink2">
            must pass
            {filters.conds.map((ci) => (
              <button
                key={ci}
                type="button"
                onClick={() => toggleCond(ci)}
                className="num cursor-pointer font-medium text-accent underline decoration-accent/40 underline-offset-2"
                title={`Remove filter: ${scan.conditions[ci].label}`}
              >
                {ci + 1}·{scan.conditions[ci].label} ✕
              </button>
            ))}
          </span>
        )}
        {dirty && (
          <button
            type="button"
            onClick={() => setFilters(defaultFilters)}
            className="inline-flex cursor-pointer items-center gap-1 rounded-[4px] px-2 py-1 text-[11.5px] font-medium text-ink2 underline decoration-rule underline-offset-2 transition-colors hover:text-ink"
          >
            <ArrowsCounterClockwise size={12} aria-hidden /> Reset all
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="No stocks match these filters"
          hint="Loosen the band, clear the condition filters, or reset everything."
          action={
            <button
              type="button"
              onClick={() => setFilters(defaultFilters)}
              className="mt-1 cursor-pointer rounded-[4px] border border-rule bg-surface px-3 py-1.5 text-[12.5px] font-medium text-ink transition-colors hover:border-ink3"
            >
              Reset all
            </button>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-[6px] border border-rule bg-surface">
          <table className="w-full min-w-[640px] border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b border-rule text-left">
                <Th sort={sort} k="symbol" onSort={toggleSort} className="sticky left-0 z-10 bg-surface pr-3">Ticker</Th>
                <Th sort={sort} k="score" onSort={toggleSort} className="text-right">Score</Th>
                <Th sort={sort} k="delta" onSort={toggleSort} className="text-right">Δ</Th>
                <Th sortable={false} className="w-[130px]">Conditions</Th>
                <Th sort={sort} k="sector" onSort={toggleSort} className="hidden lg:table-cell">Sector</Th>
                <Th sort={sort} k="close" onSort={toggleSort} className="hidden text-right sm:table-cell">Close ₹</Th>
                <Th sort={sort} k="vs20Dma" onSort={toggleSort} className="hidden text-right md:table-cell">vs 20 DMA</Th>
                <Th sort={sort} k="chgPct" onSort={toggleSort} className="hidden text-right sm:table-cell">Chg %</Th>
                <Th sort={sort} k="volume" onSort={toggleSort} className="hidden text-right xl:table-cell">Volume</Th>
                <Th sort={sort} k="held" onSort={toggleSort} className="hidden text-right md:table-cell">Held</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr
                  key={s.symbol}
                  onClick={() => onOpen(s.symbol)}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") onOpen(s.symbol);
                  }}
                  className="group cursor-pointer border-b border-rule/60 transition-colors last:border-b-0 hover:bg-raise/60 focus-visible:bg-raise active:bg-raise"
                >
                  <td className="sticky left-0 z-10 max-w-[180px] truncate bg-surface py-[7px] pr-3 transition-colors group-hover:bg-raise/60 group-focus-visible:bg-raise">
                    <span className="num font-semibold text-ink">{s.symbol}</span>
                    {!s.fno && <span className="ml-1.5 align-middle text-[9.5px] uppercase tracking-wide text-ink3">cash</span>}
                  </td>
                  <td className="py-[7px] text-right">
                    <span className="num inline-flex items-center gap-1.5 font-semibold text-ink">
                      {s.score}
                      <BandChip band={s.band} />
                    </span>
                  </td>
                  <td className="py-[7px] text-right">
                    <DeltaText v={s.delta} />
                  </td>
                  <td className="py-[7px]">
                    <CondStrip conds={s.conds} size="sm" />
                  </td>
                  <td className="hidden max-w-[150px] truncate py-[7px] text-ink2 lg:table-cell">{s.sector}</td>
                  <td className="num hidden py-[7px] text-right text-ink sm:table-cell">{fmtPrice(s.close)}</td>
                  <td className={`num hidden py-[7px] text-right md:table-cell ${s.vs20Dma >= 0 ? "text-up" : "text-down"}`}>
                    {fmtPct(s.vs20Dma)}
                  </td>
                  <td className={`num hidden py-[7px] text-right sm:table-cell ${s.chgPct >= 0 ? "text-up" : "text-down"}`}>
                    {fmtPct(s.chgPct)}
                  </td>
                  <td className="num hidden py-[7px] text-right text-ink2 xl:table-cell">{fmtVolume(s.volume)}</td>
                  <td className="num hidden py-[7px] text-right text-ink2 md:table-cell">{s.held}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function labelOf(k: SortKey): string {
  const names: Record<SortKey, string> = {
    symbol: "ticker",
    score: "score",
    delta: "change",
    sector: "sector",
    close: "close",
    vs20Dma: "vs 20 DMA",
    chgPct: "day change",
    volume: "volume",
    held: "held",
  };
  return names[k];
}

function Th({
  sort,
  k,
  onSort,
  className = "",
  children,
  sortable = true,
}: {
  sort?: { key: SortKey; dir: "asc" | "desc" };
  k?: SortKey;
  onSort?: (k: SortKey) => void;
  className?: string;
  children: React.ReactNode;
  sortable?: boolean;
}) {
  const active = sort?.key === k;
  return (
    <th
      scope="col"
      aria-sort={active ? (sort?.dir === "desc" ? "descending" : "ascending") : undefined}
      className={`px-3 py-2 text-[11px] font-medium uppercase tracking-[0.08em] text-ink3 ${className}`}
    >
      {sortable && onSort && k ? (
        <button
          type="button"
          onClick={() => onSort(k)}
          className={`inline-flex cursor-pointer items-center gap-1 transition-colors hover:text-ink ${
            active ? "text-ink" : ""
          }`}
        >
          {children}
          {active ? (
            sort?.dir === "desc" ? (
              <ArrowDown size={11} weight="bold" aria-hidden />
            ) : (
              <ArrowUp size={11} weight="bold" aria-hidden />
            )
          ) : null}
        </button>
      ) : (
        children
      )}
    </th>
  );
}
