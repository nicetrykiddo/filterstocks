"use client";

import type { ScanResult } from "@/lib/types";
import { SectionHeading } from "./ui";

const groupLabels: Record<string, string> = {
  trend: "Trend",
  momentum: "Momentum",
  contraction: "Contraction",
};

/**
 * Today's pass rates. Clicking a condition pins it as a filter on the scan
 * table below, which is the fastest way to find names failing one specific
 * check.
 */
export function PassRates({
  scan,
  active,
  onToggle,
}: {
  scan: ScanResult;
  active: number[];
  onToggle: (i: number) => void;
}) {
  const groups = ["trend", "momentum", "contraction"] as const;

  return (
    <section aria-label="Condition pass rates">
      <SectionHeading
        title="Condition pass rates"
        note="Share of the universe passing each check today. Select a condition to filter the scan table by it."
      />
      <div className="grid grid-cols-1 gap-x-10 gap-y-5 md:grid-cols-2 xl:grid-cols-3">
        {groups.map((g) => (
          <div key={g}>
            <h3 className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-ink3">
              {groupLabels[g]}
            </h3>
            <ul>
              {scan.passRates.map((p, i) =>
                scan.conditions[i].group !== g ? null : (
                  <li key={p.key}>
                    <button
                      type="button"
                      onClick={() => onToggle(i)}
                      aria-pressed={active.includes(i)}
                      className={`group flex w-full cursor-pointer items-center gap-3 border-b border-rule py-1.5 text-left transition-colors hover:bg-raise/60 ${
                        active.includes(i) ? "bg-accent-soft/50" : ""
                      }`}
                    >
                      <span className="num w-4 shrink-0 text-[10.5px] text-ink3">{i + 1}</span>
                      <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink" title={p.short}>
                        {p.label}
                      </span>
                      <span className="relative h-[6px] w-20 shrink-0 self-center overflow-hidden rounded-[2px] bg-raise">
                        <span
                          className={`absolute inset-y-0 left-0 ${active.includes(i) ? "bg-accent" : "bg-ink/60"}`}
                          style={{ width: `${p.pct}%` }}
                        />
                      </span>
                      <span className="num w-[34px] shrink-0 text-right text-[12px] text-ink2">{p.pct}%</span>
                    </button>
                  </li>
                ),
              )}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
