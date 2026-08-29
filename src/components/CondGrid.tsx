"use client";

import type { CondStat } from "@/lib/types";

/**
 * Condition pass rates. Clicking a bar drives the same dropdown the filter
 * panel uses — one source of truth, no parallel filter state.
 */
export function CondGrid({
  conds,
  read,
  active,
  onToggle,
}: {
  conds: CondStat[];
  read: string;
  active: number[];
  onToggle: (i: number) => void;
}) {
  const flat = conds.filter((c) => c.n > 0 && (c.pass / c.n >= 0.985 || c.pass / c.n <= 0.015));
  return (
    <>
      <div className="sech">
        <h2>Condition pass rates</h2>
      </div>
      <p className="readline">{read} Click a bar to filter the table to names that pass it.</p>
      <div className="panel">
        <div className="cgrid">
          {conds.map((c) => {
            const p = c.n ? c.pass / c.n : 0;
            const d = c.prev === null ? null : c.pass - c.prev;
            const isFlat = p >= 0.985 || p <= 0.015;
            return (
              <button
                key={c.i}
                className={`cc ${isFlat ? "flat" : ""} ${active.includes(c.i) ? "on" : ""}`}
                title={`${c.label} — ${c.pass} of ${c.n} passing`}
                onClick={() => onToggle(c.i)}
              >
                <div className="pc">{Math.round(p * 100)}%</div>
                <div className="bar" style={{ height: Math.max(3, p * 104) }} />
                <div className="ab">{c.ab}</div>
                <div className={`dl ${d !== null && d > 0 ? "u" : d !== null && d < 0 ? "d" : ""}`}>
                  {d ? `${d > 0 ? "+" : "\u2212"}${Math.abs(d)}` : ""}
                </div>
              </button>
            );
          })}
        </div>
        <div className="note">
          {flat.length
            ? `${flat.map((c) => `${c.label} ${c.pass >= c.n / 2 ? "passed" : "failed"} ${c.pass >= c.n / 2 ? c.pass : c.n - c.pass} of ${c.n}`).join("; ")} — effectively no variance today, so the score separates on the remaining ${conds.length - flat.length}.`
            : "Every condition showed variance today."}
        </div>
      </div>
    </>
  );
}
