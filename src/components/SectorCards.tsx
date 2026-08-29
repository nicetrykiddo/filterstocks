"use client";

import { useState } from "react";
import type { SectorAgg } from "@/lib/types";

const SCALE_MAX = 11;

function sparkPath(h: number[], W: number, HT: number) {
  const X = (i: number) => (i * W) / Math.max(1, h.length - 1);
  // The scale is the score's own 0–11 domain, not the day's spread: a
  // relative axis would let a card shift without the sector changing.
  const Y = (v: number) => HT - 2 - (v / SCALE_MAX) * (HT - 4);
  return {
    d: h.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(""),
    x: X(h.length - 1),
    y: Y(h[h.length - 1]),
  };
}

/** Sectors too thin to read as a trend move to the end, dimmed. */
export function SectorCards({
  sectors,
  universeMean,
  read,
  active,
  onSelect,
}: {
  sectors: SectorAgg[];
  universeMean: number;
  read: string;
  active: string | null;
  onSelect: (name: string | null) => void;
}) {
  const [tip, setTip] = useState<{ x: number; y: number; s: SectorAgg } | null>(null);
  const ordered = [...sectors.filter((s) => s.n >= 5), ...sectors.filter((s) => s.n < 5)];

  function enter(e: React.MouseEvent, s: SectorAgg) {
    setTip({ x: e.clientX + 14, y: e.clientY + 12, s });
  }

  return (
    <>
      <div className="sech">
        <h2>Sectors</h2>
      </div>
      <p className="readline">
        {read} Click a card to filter the table.
      </p>
      <div className="scards">
        {ordered.map((s) => {
          const rel = s.mean - universeMean;
          const cls = s.n < 5 ? "thin" : rel >= 0 ? "up" : "dn";
          const d = s.prevMean === null ? null : s.mean - s.prevMean;
          return (
            <button
              key={s.name}
              className={`sc ${cls} ${active === s.name ? "on" : ""}`}
              onClick={() => onSelect(active === s.name ? null : s.name)}
              onMouseEnter={(e) => enter(e, s)}
              onMouseMove={(e) => enter(e, s)}
              onMouseLeave={() => setTip(null)}
            >
              <span className="nm">{s.name}</span>
              <div className="top">
                <div>
                  <span className="v">{s.mean.toFixed(2)}</span>
                  {d !== null && d !== 0 ? (
                    <span className={`dlt ${d > 0 ? "u" : "d"}`}>
                      {d > 0 ? "+" : "\u2212"}
                      {Math.abs(d).toFixed(2)}
                    </span>
                  ) : null}
                </div>
                <span className={`vs ${rel >= 0 ? "u" : "d"}`}>
                  {rel >= 0 ? "+" : "\u2212"}
                  {Math.abs(rel).toFixed(2)} vs univ
                </span>
              </div>
              <div className="spark">
                <svg viewBox="0 0 100 22" preserveAspectRatio="none" aria-hidden>
                  <path d={sparkPath(s.h, 100, 22).d} fill="none" stroke={rel >= 0 ? "var(--pos)" : "var(--neg)"} strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
                </svg>
              </div>
              <div className="scf">
                {s.n} names · {s.n9} at 9+ · {s.n7} at 7+
              </div>
            </button>
          );
        })}
      </div>
      {tip ? (
        <div className="tip" style={{ position: "fixed", left: tip.x, top: tip.y, opacity: 1 }}>
          <b>{tip.s.name}</b>
          <br />
          <em>mean</em> {tip.s.mean.toFixed(2)} / 11
          <br />
          <em>at 9+</em> {tip.s.n9} · <em>at 7+</em> {tip.s.n7}
          <br />
          <em>names</em> {tip.s.n}
        </div>
      ) : null}
    </>
  );
}
