"use client";

import { useEffect } from "react";
import { ArrowSquareOut, X } from "@phosphor-icons/react";
import { fmtPct, fmtPrice, fmtVolume } from "@/lib/format";
import type { ScanResult, StockRow } from "@/lib/types";
import { CondStrip } from "./CondStrip";
import { Sparkline } from "./charts";
import { BandChip, DeltaText } from "./ui";

/**
 * Full reading for one name: every condition with its current measurement,
 * plus score and price traces. Desktop gets a right sheet, mobile a bottom
 * sheet.
 */
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
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const groups = ["trend", "momentum", "contraction"] as const;
  const groupLabels = { trend: "Trend", momentum: "Momentum", contraction: "Contraction" } as const;

  return (
    <div
      className="fixed inset-0 z-40 bg-ink/25 backdrop-blur-[1px]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${stock.symbol} reading`}
    >
      <div
        className="sheet absolute inset-x-0 bottom-0 flex max-h-[92vh] flex-col rounded-t-[10px] border border-rule bg-surface sm:inset-y-0 sm:left-auto sm:right-0 sm:max-h-none sm:w-[440px] sm:rounded-none sm:border-l"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-rule px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <h2 className="num truncate text-[17px] font-bold tracking-tight">{stock.symbol}</h2>
              <BandChip band={stock.band} />
            </div>
            <p className="mt-0.5 truncate text-[12px] text-ink2">
              {stock.name} · {stock.sector}
              {stock.fno ? ", F&O" : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            autoFocus
            className="cursor-pointer rounded-[4px] p-1.5 text-ink2 transition-colors hover:bg-raise hover:text-ink"
          >
            <X size={18} aria-hidden />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-[10.5px] font-medium uppercase tracking-[0.14em] text-ink3">At</p>
              <p className="num text-[28px] font-semibold leading-none tracking-tight">
                {stock.score}
                <span className="text-[15px] font-normal text-ink3"> of 11</span>
              </p>
              <p className="mt-1 flex items-center gap-2 text-[12px] text-ink2">
                <DeltaText v={stock.delta} /> vs yesterday · held {stock.held}{" "}
                {stock.held === 1 ? "session" : "sessions"}
              </p>
            </div>
            <CondStrip conds={stock.conds} size="lg" />
          </div>

          <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-2.5 border-y border-rule py-3.5 text-[12.5px] sm:grid-cols-4">
            <div>
              <dt className="text-[10.5px] uppercase tracking-[0.12em] text-ink3">Close</dt>
              <dd className="num mt-0.5 font-medium">₹{fmtPrice(stock.close)}</dd>
            </div>
            <div>
              <dt className="text-[10.5px] uppercase tracking-[0.12em] text-ink3">Day chg</dt>
              <dd className={`num mt-0.5 font-medium ${stock.chgPct >= 0 ? "text-up" : "text-down"}`}>
                {fmtPct(stock.chgPct)}
              </dd>
            </div>
            <div>
              <dt className="text-[10.5px] uppercase tracking-[0.12em] text-ink3">vs 20 DMA</dt>
              <dd className={`num mt-0.5 font-medium ${stock.vs20Dma >= 0 ? "text-up" : "text-down"}`}>
                {fmtPct(stock.vs20Dma)}
              </dd>
            </div>
            <div>
              <dt className="text-[10.5px] uppercase tracking-[0.12em] text-ink3">Volume</dt>
              <dd className="num mt-0.5 font-medium">{fmtVolume(stock.volume)}</dd>
            </div>
          </dl>

          <div className="mt-5 grid grid-cols-2 gap-5">
            <figure>
              <figcaption className="mb-1 text-[10.5px] font-medium uppercase tracking-[0.14em] text-ink3">
                Score, 6 months
              </figcaption>
              <Sparkline values={stock.scoreHist} width={170} height={38} />
            </figure>
            <figure>
              <figcaption className="mb-1 text-[10.5px] font-medium uppercase tracking-[0.14em] text-ink3">
                Close, 6 months
              </figcaption>
              <Sparkline values={stock.closeHist} width={170} height={38} />
            </figure>
          </div>

          <div className="mt-6 space-y-5">
            {groups.map((g) => (
              <div key={g}>
                <h3 className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-ink3">
                  {groupLabels[g]}
                </h3>
                <ul>
                  {scan.conditions.map((doc, i) =>
                    doc.group !== g ? null : (
                      <li key={doc.key} className="flex items-start gap-3 border-b border-rule py-2 last:border-b-0">
                        <span
                          aria-hidden
                          className={`mt-[3px] h-2.5 w-2.5 shrink-0 rounded-[2px] border ${
                            stock.conds[i] ? "border-ink/40 bg-ink/70" : "border-rule bg-transparent"
                          }`}
                        />
                        <div className="min-w-0">
                          <p className="text-[12.5px] font-medium text-ink">
                            {i + 1}. {doc.label}
                            {stock.condValues[i] ? (
                              <span className="num ml-2 font-normal text-ink2">{stock.condValues[i]}</span>
                            ) : null}
                          </p>
                          <p className="mt-0.5 text-[11.5px] leading-relaxed text-ink3">{doc.short}</p>
                        </div>
                        <span className={`num ml-auto shrink-0 text-[11px] font-semibold ${stock.conds[i] ? "text-up" : "text-ink3"}`}>
                          {stock.conds[i] ? "PASS" : "FAIL"}
                        </span>
                      </li>
                    ),
                  )}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="border-t border-rule px-5 py-3">
          <a
            href={`https://www.tradingview.com/chart/?symbol=NSE:${encodeURIComponent(stock.symbol)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-[4px] border border-rule px-3 py-1.5 text-[12.5px] font-medium text-ink transition-colors hover:border-ink3"
          >
            Open chart in TradingView <ArrowSquareOut size={13} aria-hidden />
          </a>
        </div>
      </div>
    </div>
  );
}
