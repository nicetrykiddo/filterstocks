"use client";

import type { ScanResult } from "@/lib/types";
import { SectionHeading } from "./ui";

export function Sectors({ scan }: { scan: ScanResult }) {
  const maxMean = Math.max(...scan.sectors.map((s) => s.mean), 1);
  return (
    <section aria-label="Sectors">
      <SectionHeading
        title="Sectors"
        note="Average score and 9+ count per sector today, ranked strongest first."
      />
      <ul className="grid grid-cols-1 gap-x-12 lg:grid-cols-2">
        {scan.sectors.map((s) => (
          <li
            key={s.sector}
            className="flex items-center gap-3 border-b border-rule py-[7px] text-[12.5px]"
          >
            <span className="w-[104px] shrink-0 truncate text-ink" title={s.sector}>
              {s.sector}
            </span>
            <span className="relative h-[6px] min-w-0 flex-1 overflow-hidden rounded-[2px] bg-raise">
              <span
                className="absolute inset-y-0 left-0 bg-ink/60"
                style={{ width: `${(s.mean / maxMean) * 100}%` }}
              />
            </span>
            <span className="num w-[38px] shrink-0 text-right font-medium text-ink">{s.mean.toFixed(1)}</span>
            <span className="num w-[58px] shrink-0 text-right text-[11.5px] text-ink3">
              {s.at9}/{s.total} at 9+
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
