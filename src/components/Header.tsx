"use client";

import { BookOpenText, Moon, Sun } from "@phosphor-icons/react";
import { fmtDateHuman, relTime } from "@/lib/format";
import type { ScanResult } from "@/lib/types";

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex min-w-[132px] flex-col gap-1">
      <span className="text-[10.5px] font-medium uppercase tracking-[0.14em] text-ink3">{label}</span>
      <span className="num text-[22px] font-semibold leading-none tracking-tight text-ink">{value}</span>
      {sub ? <span className="text-[11.5px] text-ink3">{sub}</span> : null}
    </div>
  );
}

export function Header({
  scan,
  onGuide,
}: {
  scan: ScanResult;
  onGuide: () => void;
}) {
  const at9 = scan.breadth.at9[scan.breadth.at9.length - 1] ?? 0;
  const mean = scan.breadth.meanScore[scan.breadth.meanScore.length - 1] ?? 0;

  const toggleTheme = () => {
    const el = document.documentElement;
    const dark = el.classList.toggle("dark");
    try {
      localStorage.setItem("sb-theme", dark ? "dark" : "light");
    } catch {}
  };

  return (
    <header className="border-b border-rule">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-x-6 gap-y-3 px-4 py-4 sm:px-6">
        <div className="flex items-baseline gap-2.5">
          <span className="text-[19px] font-bold tracking-tight text-ink">Scorebook</span>
          <span className="hidden text-[12px] text-ink3 sm:inline">NSE daily scan</span>
        </div>
        <div className="num ml-auto hidden text-[12px] text-ink2 md:block">
          Session {fmtDateHuman(scan.session)}
          <span className="text-ink3"> · updated {relTime(scan.generatedAt)}</span>
        </div>
        <div className="ml-auto flex items-center gap-1 md:ml-0">
          <button
            type="button"
            onClick={onGuide}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-[4px] border border-rule bg-surface px-3 py-1.5 text-[12.5px] font-medium text-ink transition-colors hover:border-ink3"
          >
            <BookOpenText size={15} aria-hidden />
            How to read
          </button>
          <button
            type="button"
            onClick={toggleTheme}
            aria-label="Toggle dark mode"
            className="cursor-pointer rounded-[4px] border border-rule bg-surface p-2 text-ink2 transition-colors hover:border-ink3 hover:text-ink"
          >
            <Sun size={15} weight="bold" className="dark:hidden" aria-hidden />
            <Moon size={15} weight="bold" className="hidden dark:block" aria-hidden />
          </button>
        </div>
      </div>
      <div className="mx-auto flex max-w-[1200px] flex-wrap gap-x-10 gap-y-5 border-t border-rule px-4 py-4 sm:px-6">
        <Stat label="At 9 of 11" value={String(at9)} sub={`of ${scan.stocks.length} scored names`} />
        <Stat label="Mean score" value={mean.toFixed(2)} sub="across the universe" />
        <Stat label="Moved today" value={String(scan.movers.length)} sub="score changed this session" />
        <Stat
          label="Universe"
          value={String(scan.stocks.length)}
          sub={scan.failed.length > 0 ? `${scan.failed.length} names lack history` : "all names scored"}
        />
        <div className="num ml-auto hidden self-center text-right text-[11.5px] leading-relaxed text-ink3 lg:block">
          Nifty 200 core + liquid F&O names
          <br />
          End-of-day data · prices split-adjusted
        </div>
      </div>
    </header>
  );
}
