"use client";

import { LineChart } from "./charts";
import { SectionHeading } from "./ui";
import type { ScanResult } from "@/lib/types";

export function Breadth({ scan }: { scan: ScanResult }) {
  const { dates, at9, meanScore } = scan.breadth;
  const peak = Math.max(...at9);
  return (
    <section aria-label="Breadth history">
      <SectionHeading
        title="Breadth history"
        note="How many names carried nine or more conditions, and the universe's average score, over the traced six months."
      />
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="rounded-[6px] border border-rule bg-surface p-4">
          <div className="mb-1 flex items-baseline justify-between">
            <h3 className="text-[12.5px] font-semibold text-ink">Names at 9+</h3>
            <span className="num text-[12px] text-ink2">
              peak <span className="font-medium text-ink">{peak}</span>
            </span>
          </div>
          <LineChart values={at9} dates={dates} baseline={0} formatValue={(v) => String(Math.round(v))} />
        </div>
        <div className="rounded-[6px] border border-rule bg-surface p-4">
          <div className="mb-1 flex items-baseline justify-between">
            <h3 className="text-[12.5px] font-semibold text-ink">Mean score</h3>
            <span className="num text-[12px] text-ink2">
              now <span className="font-medium text-ink">{(meanScore[meanScore.length - 1] ?? 0).toFixed(2)}</span>
            </span>
          </div>
          <LineChart
            values={meanScore}
            dates={dates}
            baseline={0}
            color="var(--accent)"
            formatValue={(v) => v.toFixed(1)}
          />
        </div>
      </div>
    </section>
  );
}
