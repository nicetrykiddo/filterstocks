"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ScanResult, StockRow } from "@/lib/types";
import { BreadthChart } from "./BreadthChart";
import { CondGrid } from "./CondGrid";
import { MoversPanel } from "./MoversPanel";
import { ScanTable, type TableFilters } from "./ScanTable";
import { SectorCards } from "./SectorCards";
import { GuideModal, StockDrawer } from "./StockDrawer";
import { ErrorState, Toast } from "./ui";

const defaultFilters: TableFilters = {
  q: "",
  tier: "all",
  univ: "",
  sec: "",
  ind: "",
  exfno: false,
  conds: {},
};

export function Dashboard() {
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [filters, setFilters] = useState<TableFilters>(defaultFilters);
  const [openSymbol, setOpenSymbol] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [theme, setThemeState] = useState<"light" | "dark">(() => {
    if (typeof document === "undefined") return "light";
    return (document.documentElement.getAttribute("data-theme") as "light" | "dark") ?? "light";
  });
  const [sort, setSort] = useState<{ key: "sym" | "sc" | "dl" | "sec" | "band" | "px" | "dma" | "chg" | "vol" | "days"; dir: 1 | -1 }>({
    key: "sc",
    dir: -1,
  });

  const setTheme = (t: "light" | "dark") => {
    document.documentElement.setAttribute("data-theme", t);
    try {
      localStorage.setItem("sb-theme", t);
    } catch {
      /* private mode */
    }
    setThemeState(t);
  };

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
        setError("The dataset could not be fetched from this deployment. If it was just published, wait a moment and retry.");
        console.error(e);
      });
    return () => ctrl.abort();
  }, [reloadKey]);

  const openStock = useMemo(
    () => (scan && openSymbol ? scan.rows.find((s) => s.symbol === openSymbol) ?? null : null),
    [scan, openSymbol],
  );

  const toggleCond = useCallback((i: number) => {
    setFilters((f) => {
      const cur = f.conds[i];
      const next = { ...f.conds };
      if (cur === "p") delete next[i];
      else next[i] = "p";
      return { ...f, conds: next };
    });
    document.querySelector("details.cfp")?.setAttribute("open", "");
  }, []);

  const copyTradingView = useCallback((rows: StockRow[]) => {
    // Exchange-aware prefixes: a blanket NSE: would point BSE-only tapes at
    // the wrong listing.
    const list = rows.map((r) => r.tvSymbol).join(", ");
    const done = () => setToast(`${rows.length} symbols copied for TradingView`);
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(list).then(done, () => fallbackCopy(list, done));
    } else fallbackCopy(list, done);
  }, []);

  const downloadCsv = useCallback(
    (rows: StockRow[]) => {
      if (!scan) return;
      const head = [
        "symbol", "score", "prev_score", "sector", "size_band", "close", "chg_pct", "volume",
        "sessions_at_score", "vs20dma_pct", "exchange",
        ...scan.labels,
      ];
      const lines = rows.map((r) =>
        [
          r.symbol, r.score, r.prev ?? "", `"${r.sector}"`, r.band || "", r.close, r.chgPct, r.volume,
          r.held, r.dmaPct, r.exchange,
          ...r.res.map((v) => `"${v.replace(/"/g, '""')}"`),
        ].join(","),
      );
      const blob = new Blob([[head.join(","), ...lines].join("\n")], { type: "text/csv" });
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
    return <ErrorState message={error} onRetry={() => { setError(null); setReloadKey((k) => k + 1); }} />;
  }
  if (!scan) return <LoadingShell />;

  const b = scan.breadth;
  const share = (n: number) => `${((n / b.universe) * 100).toFixed(2)}% univ`;
  const enteredTxt = scan.trans.entered;

  return (
    <main className="wrap">
      <header className="topbar">
        <div className="logo">
          <i />
          SCOREBOOK
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)", marginLeft: "auto", flexWrap: "wrap" }}>
          <button className="lnk" onClick={() => setGuideOpen(true)}>▸ How to read</button>
          <div className="barmeta">
            SESSION <em>{scan.session}</em> · <span className="live" /> <em>{scan.run.clean}/{scan.run.total}</em> SCANNED
            {" "}· <em>{scan.run.quar}</em> QUARANTINED · DAY <em>{scan.nDays}</em>
          </div>
          <button
            className="lnk"
            onClick={() => setTheme(theme === "light" ? "dark" : "light")}
            aria-label="Switch theme"
          >
            {theme === "light" ? "dark mode" : "light mode"}
          </button>
        </div>
      </header>

      {/* The read */}
      <section className="read">
        <div className="readgrid">
          <div>
            <span className="eyebrow">The read</span>
            {/* Server-generated narrative; built from counts only. */}
            <p className="lede" dangerouslySetInnerHTML={{ __html: scan.lede }} />
            <p className="readsub">{scan.sub}</p>
          </div>
          <div>
            <button className="guidecard" onClick={() => setGuideOpen(true)} aria-label="How to read this dashboard">
              <span className="guidethumb">
                <svg viewBox="0 0 640 360" preserveAspectRatio="xMidYMid slice" role="img" aria-label="How to read this dashboard">
                  <rect width="640" height="360" fill="var(--surface-2)" />
                  <rect x="40" y="44" width="13" height="13" fill="var(--mark)" />
                  <text x="64" y="56" fontFamily="var(--font-sans)" fontSize="18" fontWeight="500" letterSpacing="3" fill="var(--text)">SCOREBOOK</text>
                  <rect x="40" y="44" width="0" height="0" fill="none" />
                  <text x="40" y="182" fontFamily="var(--font-serif)" fontSize="42" fill="var(--text)">How to read</text>
                  <text x="40" y="232" fontFamily="var(--font-serif)" fontSize="42" fill="var(--text)">this dashboard</text>
                  <line x1="40" y1="272" x2="600" y2="272" stroke="var(--border)" strokeWidth="1" />
                  <text x="40" y="304" fontFamily="var(--font-mono)" fontSize="14" letterSpacing="1" fill="var(--muted)">ELEVEN CONDITIONS · WHAT THE SCORES MEAN</text>
                  <circle cx="548" cy="150" r="42" fill="var(--mark)" />
                  <path d="M535 129 L573 150 L535 171 Z" fill="#fff" />
                </svg>
              </span>
            </button>
          </div>
          <div className="hero">
            <span className="eyebrow">At 9 of 11</span>
            <div className="v">
              {b.n9}
              <s> / {b.universe}</s>
            </div>
            <div className="d">
              {((b.n9 / b.universe) * 100).toFixed(1)}% of the universe · median score {b.median}
            </div>
            <div className="split">
              <div className="p">
                <b>+{enteredTxt}</b>entered 9+
              </div>
              <div className="n">
                <b>{"\u2212"}{scan.trans.lost}</b>lost 9+
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="kpis">
        {[
          ["Mean", b.mean.toFixed(3), `median ${b.median}`],
          ["At 7+", String(b.n7), share(b.n7)],
          ["Below 5", String(b.below5), share(b.below5)],
          [
            "Above 20 DMA",
            b.withMa20 ? String(b.aboveMa20) : "—",
            b.withMa20 ? `${((b.aboveMa20 / b.withMa20) * 100).toFixed(1)}% of ${b.withMa20}` : "needs price history",
          ],
          ["Upgraded", String(scan.trans.nUp), "gained a condition"],
          ["Downgraded", String(scan.trans.nDn), "lost a condition"],
          ["Unchanged", String(scan.trans.unchanged), share(scan.trans.unchanged)],
        ].map(([l, v, d]) => (
          <div className="k" key={l}>
            <span className="eyebrow">{l}</span>
            <div className="v">{v}</div>
            <div className="d">{d}</div>
          </div>
        ))}
      </section>

      <section className="sec">
        <BreadthChart key={`bc-${theme}`} hist={scan.breadthHist} read={scan.reads.breadth} themeKey={theme === "dark" ? 0 : 1} />
      </section>

      <section className="sec">
        <MoversPanel
          ups={scan.trans.ups}
          dns={scan.trans.dns}
          nUp={scan.trans.nUp}
          nDn={scan.trans.nDn}
          abbrevs={scan.abbrevs}
          read={scan.reads.movers}
          onOpen={setOpenSymbol}
        />
      </section>

      <section className="sec">
        <CondGrid conds={scan.conds} read={scan.reads.cond} active={Object.keys(filters.conds).filter((k) => filters.conds[Number(k)] === "p").map(Number)} onToggle={toggleCond} />
      </section>

      <section className="sec">
        <SectorCards
          sectors={scan.sectors}
          universeMean={b.mean}
          read={scan.reads.sector}
          active={filters.sec || null}
          onSelect={(name) => setFilters({ ...filters, sec: name ?? "" })}
        />
      </section>

      <section className="sec">
        <ScanTable
          scan={scan}
          filters={filters}
          setFilters={setFilters}
          sort={sort}
          setSort={setSort}
          onOpen={setOpenSymbol}
          onCopyTradingView={copyTradingView}
          onDownloadCsv={downloadCsv}
        />
      </section>

      <footer className="foot">
        <div className="leg">{scan.labels.map((l, i) => `${i + 1} ${scan.abbrevs[i]} ${l}`).join("  ·  ")}</div>
        <div>
          Mirrors the published readings of{" "}
          <a
            href="https://rpci.stratlab.in/"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "var(--text-secondary)", textDecoration: "underline" }}
          >
            RPCI&rsquo;s eleven-condition scan
          </a>{" "}
          ({scan.universeNote}). Scanned {scan.run.clean} of {scan.run.total}, {scan.run.quar} quarantined. Conditions are
          computed by the RPCI pipeline; the formulas are not published, so the values are mirrored as published.
        </div>
        <div className="dis">
          Scorebook is a mirror of RPCI&rsquo;s published eleven-condition readings, presented for research and
          educational use. It is not investment advice and not a recommendation to buy or sell any security. Scorebook
          is not a SEBI-registered investment adviser or research analyst.
        </div>
        <div className="num" style={{ marginTop: 8 }}>
          session {scan.session} · mirrored{" "}
          {new Date(scan.generatedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST · history since{" "}
          {scan.histMeta.fromPretty}
        </div>
      </footer>

      {openStock ? <StockDrawer stock={openStock} scan={scan} onClose={() => setOpenSymbol(null)} /> : null}
      {guideOpen ? <GuideModal scan={scan} onClose={() => setGuideOpen(false)} /> : null}
      <Toast message={toast} onDone={() => setToast(null)} />
    </main>
  );

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
}

/** Skeletons mirror the real layout block for block. */
function LoadingShell() {
  return (
    <main className="wrap" aria-busy="true" aria-label="Loading scan">
      <div className="topbar">
        <div className="skeleton" style={{ height: 20, width: 140 }} />
        <div className="skeleton" style={{ height: 14, width: 260 }} />
      </div>
      <div className="read">
        <div className="readgrid">
          <div>
            <div className="skeleton" style={{ height: 12, width: 70, marginBottom: 12 }} />
            <div className="skeleton" style={{ height: 56, width: "80%", marginBottom: 12 }} />
            <div className="skeleton" style={{ height: 14, width: "65%" }} />
          </div>
          <div className="skeleton" style={{ height: 190, borderRadius: 12 }} />
          <div className="skeleton" style={{ height: 170, borderRadius: 12 }} />
        </div>
      </div>
      <div className="kpis">
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="k">
            <div className="skeleton" style={{ height: 10, width: 60 }} />
            <div className="skeleton" style={{ height: 22, width: 70, marginTop: 10 }} />
          </div>
        ))}
      </div>
      <div className="sec">
        <div className="panel">
          <div className="skeleton" style={{ height: 190 }} />
        </div>
      </div>
      <div className="sec">
        <div>
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <div key={i} className="skeleton" style={{ height: 30, marginBottom: 8 }} />
          ))}
        </div>
      </div>
    </main>
  );
}
