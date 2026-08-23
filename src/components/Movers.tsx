"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp } from "@phosphor-icons/react";
import { fmtSigned } from "@/lib/format";
import type { Band, Mover } from "@/lib/types";
import { BandChip, EmptyState, SectionHeading, Tabs } from "./ui";

type TierFilter = "ALL" | Band;

const tierOrder: Band[] = ["9-11", "7-8", "5-6", "<5"];

export function Movers({ movers, onOpen }: { movers: Mover[]; onOpen: (symbol: string) => void }) {
  const [tier, setTier] = useState<TierFilter>("ALL");

  const counts = new Map<Band, number>(tierOrder.map((t) => [t, 0]));
  for (const m of movers) counts.set(m.tier, (counts.get(m.tier) ?? 0) + 1);

  const shown = movers
    .filter((m) => tier === "ALL" || m.tier === tier)
    .sort((a, b) => Math.abs(b.to - b.from) - Math.abs(a.to - a.from) || a.symbol.localeCompare(b.symbol));

  return (
    <section aria-label="What moved">
      <SectionHeading
        title="What moved"
        note="Names whose score changed this session. A move is listed under the highest tier it touched, so an exit from 9+ still appears under 9-11."
        right={
          <Tabs
            value={tier}
            onChange={setTier}
            options={[
              { value: "ALL", label: "All", count: movers.length },
              ...tierOrder.map((t) => ({ value: t as TierFilter, label: t, count: counts.get(t) ?? 0 })),
            ]}
          />
        }
      />
      {shown.length === 0 ? (
        <EmptyState
          title="No score changes this session"
          hint="Every name closed on the same score as yesterday. A quiet day for the checklist."
        />
      ) : (
        <ul className="grid grid-cols-1 gap-x-8 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((m) => {
            const up = m.to > m.from;
            return (
              <li key={m.symbol}>
                <button
                  type="button"
                  onClick={() => onOpen(m.symbol)}
                  className="group flex w-full cursor-pointer items-center gap-3 border-b border-rule py-2 text-left transition-colors hover:bg-raise/60"
                >
                  {up ? (
                    <ArrowUp weight="bold" size={13} className="shrink-0 text-up" aria-hidden />
                  ) : (
                    <ArrowDown weight="bold" size={13} className="shrink-0 text-down" aria-hidden />
                  )}
                  <span className="num w-[104px] shrink-0 truncate text-[12.5px] font-semibold text-ink group-hover:underline group-hover:decoration-rule group-hover:underline-offset-[3px]">
                    {m.symbol}
                  </span>
                  <span className="hidden min-w-0 flex-1 truncate text-[12px] text-ink3 md:block">{m.name}</span>
                  <span className="num ml-auto flex shrink-0 items-center gap-1.5 text-[12px] text-ink2">
                    {m.from} <span className="text-ink3">→</span>{" "}
                    <span className={`font-semibold ${up ? "text-up" : "text-down"}`}>{m.to}</span>
                    <span className={`num w-[26px] text-right text-[11px] ${up ? "text-up" : "text-down"}`}>
                      {fmtSigned(m.to - m.from)}
                    </span>
                  </span>
                  <BandChip band={m.tier} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
