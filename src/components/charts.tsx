"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { fmtDateShort } from "@/lib/format";

/**
 * Hand-drawn SVG charts. The breadth charts carry a hover crosshair on
 * pointer devices; sparklines are inert by design.
 */

export function LineChart({
  values,
  dates,
  height = 128,
  color = "var(--ink)",
  fill = true,
  formatValue,
  baseline,
}: {
  values: number[];
  dates: string[];
  height?: number;
  color?: string;
  fill?: boolean;
  formatValue: (v: number) => string;
  /** Fixed y-zero for charts where zero matters. */
  baseline?: number;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      setWidth(Math.max(0, entries[0].contentRect.width - 46));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = values.length;
  if (n < 2 || width === 0) return <div ref={wrapRef} style={{ height }} />;

  const padT = 6;
  const padB = 18;
  const h = height - padT - padB;
  let min = baseline !== undefined ? Math.min(baseline, ...values) : Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const span = max - min;
  const x = (i: number) => (i / (n - 1)) * width;
  const y = (v: number) => padT + h - ((v - min) / span) * h;

  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const line = `M${pts.join(" L")}`;
  const area = `${line} L${x(n - 1).toFixed(1)},${padT + h} L0,${padT + h} Z`;

  const last = values[n - 1];
  const hi = values.indexOf(max);
  const lo = values.indexOf(min);

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.pointerType !== "mouse") return;
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = (e.clientX - rect.left - 0) / (rect.width - 46);
    const i = Math.round(frac * (n - 1));
    setHover(i >= 0 && i < n ? i : null);
  };

  return (
    <div ref={wrapRef} className="relative">
      <svg
        width={width + 46}
        height={height}
        className="block touch-none"
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {/* y-axis labels, three quiet ticks */}
        {[max, (max + min) / 2, min].map((v, k) => (
          <text
            key={k}
            x={width + 8}
            y={k === 0 ? y(v) + 9 : k === 2 ? y(v) - 2 : y(v) + 3}
            fontSize={10}
            fill="var(--ink2)"
            className="num"
          >
            {formatValue(v)}
          </text>
        ))}
        {fill && <path d={area} fill={color} opacity={0.07} />}
        <path d={line} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
        {/* extremes markers */}
        <circle cx={x(hi)} cy={y(max)} r={2} fill="var(--ink3)" />
        <circle cx={x(lo)} cy={y(min)} r={2} fill="var(--ink3)" />
        {/* last point */}
        <circle cx={x(n - 1)} cy={y(last)} r={3} fill={color} />
        {hover !== null && (
          <g>
            <line x1={x(hover)} y1={padT} x2={x(hover)} y2={padT + h} stroke="var(--rule)" strokeWidth={1} />
            <circle cx={x(hover)} cy={y(values[hover])} r={3} fill="var(--accent)" stroke="var(--surface)" strokeWidth={1.5} />
          </g>
        )}
        {/* x-axis: first, middle, last session */}
        {[0, Math.floor((n - 1) / 2), n - 1].map((i, k) => (
          <text
            key={k}
            x={Math.min(Math.max(x(i), 18), width - 18)}
            y={height - 5}
            fontSize={10}
            textAnchor="middle"
            fill="var(--ink2)"
            className="num"
          >
            {fmtDateShort(dates[i])}
          </text>
        ))}
      </svg>
      {hover !== null && (
        <div
          className="pointer-events-none absolute top-0 left-0 -translate-x-1/2 rounded-[4px] border border-rule bg-surface px-2 py-1 text-[11px] shadow-none"
          style={{ transform: `translateX(${Math.min(Math.max(x(hover), 40), width - 40)}px)` }}
        >
          <span className="text-ink2">{fmtDateShort(dates[hover])}</span>{" "}
          <span className="num font-medium">{formatValue(values[hover])}</span>
        </div>
      )}
    </div>
  );
}

export function Sparkline({
  values,
  width = 132,
  height = 30,
  color = "var(--ink)",
  highlightLast = 8,
}: {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
  highlightLast?: number;
}) {
  const n = values.length;
  if (n < 2) return <svg width={width} height={height} />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (i: number) => (i / (n - 1)) * width;
  const y = (v: number) => 2 + (height - 4) - ((v - min) / span) * (height - 4);
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const line = `M${pts.join(" L")}`;
  const from = Math.max(0, n - highlightLast);
  const recent = values.slice(from);
  const rPts = recent.map((v, i) => `${x(from + i).toFixed(1)},${y(v).toFixed(1)}`);
  return (
    <svg width={width} height={height} className="block">
      <path d={line} fill="none" stroke={color} strokeWidth={1} opacity={0.35} />
      <path d={`M${rPts.join(" L")}`} fill="none" stroke={color} strokeWidth={1.75} />
      <circle cx={x(n - 1)} cy={y(values[n - 1])} r={2.5} fill={color} />
    </svg>
  );
}
