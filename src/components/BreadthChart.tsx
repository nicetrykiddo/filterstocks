"use client";

import { useMemo, useRef, useState } from "react";
import { fmtDateShort } from "@/lib/format";
import type { BreadthPoint } from "@/lib/types";

/**
 * Breadth history: one primary series at a time on a data-fitted y-domain —
 * a zero-based axis would flatten a 4.8–5.6 mean into a straight line. The
 * dashed companion is the 20-session average.
 */
export function BreadthChart({ hist, read, themeKey }: { hist: BreadthPoint[]; read: string; themeKey: number }) {
  const [key, setKey] = useState<"n9" | "mean">("n9");
  const [hoverI, setHoverI] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const W = 1000;
  const HT = 190;
  const PAD = 34;

  const vals = hist.map((h) => (key === "n9" ? h.n9 : h.mean));
  const ma = useMemo(() => {
    const out: Array<number | null> = [];
    const vs = hist.map((h) => (key === "n9" ? h.n9 : h.mean));
    for (let i = 0; i < vs.length; i++) {
      if (i < 19) {
        out.push(null);
        continue;
      }
      let s = 0;
      for (let j = i - 19; j <= i; j++) s += vs[j];
      out.push(s / 20);
    }
    return out;
  }, [hist, key]);

  const lo = Math.min(...vals.filter((v) => Number.isFinite(v)));
  const hi = Math.max(...vals.filter((v) => Number.isFinite(v)));
  const span = hi - lo || 1;
  const X = (i: number) => PAD + (i * (W - PAD * 2)) / Math.max(1, hist.length - 1);
  const Y = (v: number) => HT - 26 - ((v - lo) / span) * (HT - 52);

  const path = vals.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join("");
  const maPath = ma
    .map((v, i) => (v === null ? null : `${i && ma[i - 1] !== null ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`))
    .filter(Boolean)
    .join("");

  void themeKey; // colors resolve at draw time; parent remounts us on theme change

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return;
    const i = Math.max(
      0,
      Math.min(hist.length - 1, Math.round(((e.clientX - r.left) / r.width * W - PAD) / ((W - PAD * 2) / (hist.length - 1)))),
    );
    setHoverI(i);
  }

  const hp = hoverI !== null ? hist[hoverI] : null;
  const accent = "var(--accent)";
  const maColor = "var(--text-secondary)";

  return (
    <>
      <div className="sech">
        <h2>Breadth history</h2>
        <div className="seg">
          <button className={key === "n9" ? "on" : ""} onClick={() => setKey("n9")}>NAMES AT 9+</button>
          <button className={key === "mean" ? "on" : ""} onClick={() => setKey("mean")}>MEAN SCORE</button>
        </div>
      </div>
      <p className="readline">
        {hp
          ? `${hp.d}: at 9+ ${hp.n9}, mean ${hp.mean.toFixed(3)}, scanned ${hp.n}.`
          : `${read} Hover the line for a night's detail.`}
      </p>
      <div className="panel">
        <div className="chart">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${HT}`}
            preserveAspectRatio="none"
            onMouseMove={onMove}
            onMouseLeave={() => setHoverI(null)}
            role="img"
            aria-label="Breadth history chart"
          >
            {[0.25, 0.5, 0.75].map((f) => (
              <line
                key={f}
                x1={PAD}
                x2={W - PAD}
                y1={Y(lo + span * f)}
                y2={Y(lo + span * f)}
                stroke="var(--border)"
                strokeWidth="1"
              />
            ))}
            <path d={maPath} fill="none" stroke={maColor} strokeWidth="1.4" strokeDasharray="5 4" opacity="0.75" />
            <path d={path} fill="none" stroke={accent} strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            {hp ? (
              <>
                <line x1={X(hoverI!)} x2={X(hoverI!)} y1={10} y2={HT - 26} stroke="var(--border-strong)" strokeWidth="1" />
                <circle cx={X(hoverI!)} cy={Y(vals[hoverI!])} r="3.5" fill="var(--mark)" />
              </>
            ) : (
              <circle cx={X(hist.length - 1)} cy={Y(vals[vals.length - 1])} r="3.5" fill="var(--mark)" />
            )}
          </svg>
          <div className="xr">
            <span>{fmtDateShort(hist[0]?.d ?? "")}</span>
            <span>{fmtDateShort(hist[Math.floor(hist.length / 2)]?.d ?? "")}</span>
            <span>{fmtDateShort(hist[hist.length - 1]?.d ?? "")}</span>
          </div>
        </div>
        <div className="clegend">
          <span>
            <i style={{ background: accent }} />
            {key === "mean" ? "Mean score" : "Names at 9+"}, per session
          </span>
          <span>
            <i className="dash" style={{ color: maColor }} />
            20-session average
          </span>
        </div>
        <div className="note">
          {key === "n9"
            ? `Range over ${hist.length} sessions: ${Math.min(...vals)} to ${Math.max(...vals)}.`
            : `Mean runs ${lo.toFixed(3)} to ${hi.toFixed(3)}. The y-axis fits the data; it is not zero-based.`}
        </div>
      </div>
    </>
  );
}
