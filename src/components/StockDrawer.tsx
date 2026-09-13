"use client";

import { useEffect, useState } from "react";
import type { ScanResult, StockRow } from "@/lib/types";

function Spark({ r }: { r: StockRow }) {
  const W = 500;
  const HT = 120;
  const PAD = 8;
  const h = r.hist;
  const lo = Math.min(...h);
  const hi = Math.max(...h);
  const span = hi - lo || 1;
  // The dashed line is the 9-of-11 threshold; draw it only when in range.
  const Y = (v: number) => HT - 6 - ((v - lo) / span) * (HT - 12);
  const X = (i: number) => PAD + (i * (W - PAD * 2)) / Math.max(1, h.length - 1);
  const path = h.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join("");
  return (
    <svg viewBox={`0 0 ${W} ${HT}`} style={{ width: "100%", display: "block" }} role="img" aria-label="Score history">
      {9 >= lo && 9 <= hi ? (
        <line x1={PAD} x2={W - PAD} y1={Y(9)} y2={Y(9)} stroke="var(--text-secondary)" strokeWidth="1" strokeDasharray="4 4" opacity="0.7" />
      ) : null}
      <path d={path} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" />
      <circle cx={X(h.length - 1)} cy={Y(h[h.length - 1])} r="3.5" fill="var(--mark)" />
    </svg>
  );
}

export function StockDrawer({
  stock,
  scan,
  onClose,
}: {
  stock: StockRow;
  scan: ScanResult;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const d = stock.prev === null ? null : stock.score - stock.prev;
  const meta = [stock.sector, stock.band, ...stock.idx].filter(Boolean).join(" · ");

  return (
    <>
      <div className="scrim on" onClick={onClose} />
      <aside className="drw on" aria-label={`Stock detail: ${stock.symbol}`}>
        <div className="drwh">
          <div>
            <h2>{stock.symbol}</h2>
            <div className="m">{meta}</div>
            <div className="m">{stock.name}</div>
          </div>
          <button className="x" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="dstat">
          <div>
            <span className="eyebrow">Score</span>
            <div className="v">
              {stock.score}
              <s>/11</s>
            </div>
            <div className="d">
              {d === null
                ? "no prior session"
                : d === 0
                  ? `unchanged vs ${scan.prevSession ?? ""}`
                  : `${d > 0 ? "+" : "\u2212"}${Math.abs(d)} vs ${scan.prevSession ?? ""}`}
            </div>
          </div>
          <div>
            <span className="eyebrow">Held</span>
            <div className="v">{stock.held}</div>
            <div className="d">session{stock.held === 1 ? "" : "s"} at this score</div>
          </div>
          <div>
            <span className="eyebrow">Close</span>
            <div className="v">{stock.close.toLocaleString("en-IN")}</div>
            <div className="d" style={{ color: stock.chgPct > 0 ? "var(--pos)" : stock.chgPct < 0 ? "var(--neg)" : "var(--muted)" }}>
              {stock.chgPct > 0 ? "+" : ""}
              {stock.chgPct.toFixed(2)}%
            </div>
          </div>
        </div>
        <div className="dsec">
          <span className="eyebrow">Score, last {stock.hist.length} sessions</span>
          <p className="cap" style={{ margin: "0 0 var(--sp-3)" }}>
            The dashed line is the 9-of-11 threshold.
          </p>
          <Spark r={stock} />
        </div>
        <div className="dsec">
          <span className="eyebrow">Tonight{"\u2019"}s eleven conditions</span>
          <div style={{ marginTop: "var(--sp-3)" }}>
            {scan.labels.map((l, i) => (
              <div key={i} className="crow">
                <div className="i">{i + 1}</div>
                <div className="nm">
                  {l}
                  <b>{stock.res[i] ?? ""}</b>
                </div>
                <div className={`st ${stock.st[i] === "1" ? "p" : "f"}`}>{stock.st[i] === "1" ? "PASS" : "FAIL"}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="dsec">
          <span className="eyebrow">Chart</span>
          <div style={{ marginTop: "var(--sp-3)" }}>
            <a
              className="tvb"
              target="_blank"
              rel="noopener noreferrer"
              href={`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(stock.tvSymbol)}`}
            >
              Open {stock.tvSymbol} on TradingView ↗
            </a>
          </div>
          <div className="cap">Scores are computed from end-of-day data; the intraday chart is external.</div>
        </div>
      </aside>
    </>
  );
}

export function GuideModal({ scan, onClose }: { scan: ScanResult; onClose: () => void }) {
  const [mounted] = useState(true);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!mounted) return null;
  return (
    <>
      <div className="guide-scrim on" onClick={onClose} />
      <div className="guide on" role="dialog" aria-modal="true" aria-label="How to read this dashboard">
        <div className="guide-box" onClick={(e) => e.stopPropagation()}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 8 }}>
            <h2>How to read this dashboard</h2>
            <button className="x" aria-label="Close" onClick={onClose} style={{ marginLeft: "auto" }}>
              ✕
            </button>
          </div>
          <p className="readline">
            Each session every scanned name is read against eleven technical and fundamental conditions — the same
            parameters the RPCI reference scan publishes. One pass is one point; a stock&rsquo;s score is how many of
            the eleven it clears tonight. Nine or more marks the strongest tape. Every condition is computed by
            Scorebook&rsquo;s own engine from exchange end-of-day data, and its formula is documented below; the
            reference keeps its formulas private, so where they could not be recovered exactly the thresholds were
            calibrated against its published pass rates.
          </p>
          {scan.conditions.map((c, i) => (
            <div key={c.key} className="gcond">
              <div className="gi">
                {i + 1}.
              </div>
              <div>
                <span className="gn">
                  {c.label} ({c.abbrev}) —{" "}
                  <span style={{ color: "var(--text-secondary)", fontWeight: 400 }}>{c.short}</span>
                </span>
                <p className="gd">{c.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
