"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ScanResult, StockRow } from "@/lib/types";
import { Breadth } from "./Breadth";
import { Header } from "./Header";
import { HowToRead } from "./HowToRead";
import { Movers } from "./Movers";
import { PassRates } from "./PassRates";
import { ScanTable, type TableFilters } from "./ScanTable";
import { Sectors } from "./Sectors";
import { StockDrawer } from "./StockDrawer";
import { ErrorState, SectionHeading, Toast } from "./ui";

const defaultFilters: TableFilters = { q: "", band: "ALL", fno: "all", conds: [] };

export function Dashboard() {
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [filters, setFilters] = useState<TableFilters>(defaultFilters);
  const [openSymbol, setOpenSymbol] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch("/scan.json", { cache: "no-store", signal: ctrl.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`scan.json returned HTTP ${res.status}`);
        return (await res.json()) as ScanResult;
      })
      .then(setScan)
      .catch((e: unknown) => {
        if ((e as Error).name === "AbortError") return;
        setError(
          "The dataset could not be fetched from this deployment. If it was just published, wait a moment and retry.",
        );
        console.error(e);
      });
    return () => ctrl.abort();
  }, [reloadKey]);

  const openStock = useMemo(
    () => (scan && openSymbol ? scan.stocks.find((s) => s.symbol === openSymbol) ?? null : null),
    [scan, openSymbol],
  );

  const toggleCond = useCallback((i: number) => {
    setFilters((f) => ({
      ...f,
      conds: f.conds.includes(i) ? f.conds.filter((x) => x !== i) : [...f.conds, i],
    }));
  }, []);

  const copyTradingView = useCallback((rows: StockRow[]) => {
    const list = rows.map((r) => `NSE:${r.symbol}`).join(", ");
    const done = () => setToast(`${rows.length} symbols copied for TradingView`);
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(list).then(done, () => fallbackCopy(list, done));
    } else {
      fallbackCopy(list, done);
    }
  }, []);

  const downloadCsv = useCallback(
    (rows: StockRow[]) => {
      if (!scan) return;
      const header = [
        "symbol", "name", "sector", "fno", "score", "delta", "held", "band",
        "close", "vs_20dma_pct", "chg_pct", "volume",
        ...scan.conditions.map((_, i) => `c${i + 1}`),
      ];
      const lines = rows.map((r) =>
        [
          r.symbol, `"${r.name.replace(/"/g, '""')}"`, `"${r.sector}"`, r.fno ? 1 : 0,
          r.score, r.delta, r.held, r.band, r.close, r.vs20Dma, r.chgPct, r.volume,
          ...r.conds.map((c) => (c ? 1 : 0)),
        ].join(","),
      );
      const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `scorebook-${scan.session}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      setToast(`CSV with ${rows.length} rows downloaded`);
    },
    [scan],
  );

  if (error) {
    return (
      <main className="mx-auto flex max-w-[1200px] flex-1 flex-col justify-center px-4 py-16 sm:px-6">
        <ErrorState
          message={error}
          onRetry={() => {
            setError(null);
            setReloadKey((k) => k + 1);
          }}
        />
      </main>
    );
  }

  if (!scan) {
    return (
      <main className="mx-auto max-w-[1200px] flex-1 px-4 py-10 sm:px-6">
        <LoadingShell />
      </main>
    );
  }

  return (
    <main className="mx-auto flex max-w-[1200px] flex-1 flex-col gap-14 px-4 pb-16 sm:px-6">
      <Header scan={scan} onGuide={() => setGuideOpen(true)} />
      <Breadth scan={scan} />
      <Movers movers={scan.movers} onOpen={setOpenSymbol} />
      <PassRates scan={scan} active={filters.conds} onToggle={toggleCond} />
      <Sectors scan={scan} />
      <div className="mt-2 border-t border-rule pt-12">
        <ScanTable
          scan={scan}
          filters={filters}
          setFilters={setFilters}
          onOpen={setOpenSymbol}
          onCopyTradingView={copyTradingView}
          onDownloadCsv={downloadCsv}
        />
      </div>

      <footer className="border-t border-rule pt-6 text-[11.5px] leading-relaxed text-ink3">
        <p>
          Scorebook is an independent research tool. Data is NSE end-of-day bhavcopy, adjusted for
          splits and bonuses; scores are recomputed once per session after market close. Nothing
          here is investment advice. This is not a SEBI-registered investment adviser or research
          analyst; use it to study setups, not to receive recommendations.
        </p>
        <p className="num mt-2">
          universe {scan.stocks.length} names
          <br />
          session {scan.session}
          <br />
          data refreshed {new Date(scan.generatedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST
          {scan.failed.length > 0 ? <><br />{scan.failed.length} names skipped for short history</> : null}
        </p>
      </footer>

      {openStock && <StockDrawer stock={openStock} scan={scan} onClose={() => setOpenSymbol(null)} />}
      {guideOpen && <HowToRead scan={scan} onClose={() => setGuideOpen(false)} />}
      <Toast message={toast} onDone={() => setToast(null)} />
    </main>
  );
}

function fallbackCopy(text: string, done: () => void) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand("copy");
    done();
  } catch {
    /* clipboard unavailable */
  }
  document.body.removeChild(ta);
}

/** Skeletons mirror the real layout block for block. */
function LoadingShell() {
  return (
    <div aria-busy="true" aria-label="Loading scan" className="space-y-10">
      <div className="border-b border-rule pb-6">
        <div className="skeleton h-6 w-44" />
        <div className="mt-5 flex gap-10">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="space-y-2">
              <div className="skeleton h-3 w-16" />
              <div className="skeleton h-6 w-14" />
            </div>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="skeleton h-[168px] rounded-[6px]" />
        <div className="skeleton h-[168px] rounded-[6px]" />
      </div>
      <div className="space-y-3">
        <div className="skeleton h-4 w-32" />
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="skeleton h-6 w-full" />
        ))}
      </div>
      <div className="space-y-3">
        <div className="skeleton h-4 w-40" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton h-5 w-2/3" />
        ))}
      </div>
      <div className="border-t border-rule pt-10">
        <SectionHeading title="All stocks" note="Loading the session's scan…" />
        <div className="space-y-1.5">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <div key={i} className="skeleton h-8 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}
