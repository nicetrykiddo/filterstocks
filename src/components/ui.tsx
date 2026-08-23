"use client";

import { useEffect } from "react";
import { ArrowsClockwise, Warning, X } from "@phosphor-icons/react";
import { fmtSigned } from "@/lib/format";
import type { Band } from "@/lib/types";

/** Band chip: text label with band-specific tint kept deliberately quiet. */
export function BandChip({ band }: { band: Band }) {
  const styles: Record<Band, string> = {
    "9-11": "bg-up-soft text-up",
    "7-8": "bg-accent-soft text-accent",
    "5-6": "bg-raise text-ink2",
    "<5": "bg-raise text-ink3",
  };
  return (
    <span className={`num inline-block rounded-[4px] px-1.5 py-0.5 text-[11px] font-medium ${styles[band]}`}>
      {band}
    </span>
  );
}

export function DeltaText({ v, className = "" }: { v: number; className?: string }) {
  if (v === 0) return <span className={`text-ink3 ${className}`}>·</span>;
  return (
    <span className={`num font-medium ${v > 0 ? "text-up" : "text-down"} ${className}`}>
      {fmtSigned(v)}
    </span>
  );
}

export function SectionHeading({
  title,
  note,
  right,
}: {
  title: string;
  note?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <div>
        <h2 className="text-[15px] font-semibold tracking-tight text-ink">{title}</h2>
        {note ? <p className="mt-0.5 max-w-[70ch] text-[12.5px] leading-relaxed text-ink2">{note}</p> : null}
      </div>
      {right}
    </div>
  );
}

export function Tabs<T extends string>({
  options,
  value,
  onChange,
  size = "md",
}: {
  options: Array<{ value: T; label: string; count?: number }>;
  value: T;
  onChange: (v: T) => void;
  size?: "md" | "sm";
}) {
  return (
    <div className="inline-flex flex-wrap gap-1">
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            aria-pressed={selected}
            type="button"
            onClick={() => onChange(o.value)}
            className={`num cursor-pointer rounded-[4px] border transition-colors duration-100 ${
              size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-[12px]"
            } ${
              selected
                ? "border-accent bg-accent text-surface"
                : "border-rule bg-transparent text-ink2 hover:border-ink3 hover:text-ink"
            }`}
          >
            {o.label}
            {o.count !== undefined && o.count > 0 ? (
              <span className={`ml-1.5 ${selected ? "opacity-70" : "opacity-60"}`}>{o.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function Toast({ message, onDone }: { message: string | null; onDone: () => void }) {
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(onDone, 2600);
    return () => clearTimeout(t);
  }, [message, onDone]);
  if (!message) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="fadeup fixed inset-x-0 bottom-5 z-50 mx-auto w-fit max-w-[90vw] rounded-[6px] border border-rule bg-surface px-4 py-2.5 text-[13px] text-ink"
    >
      {message}
    </div>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-[6px] border border-dashed border-rule px-6 py-12 text-center">
      <p className="text-[13.5px] font-medium text-ink2">{title}</p>
      {hint ? <p className="max-w-[46ch] text-[12.5px] leading-relaxed text-ink3">{hint}</p> : null}
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-[6px] border border-down/30 bg-down-soft/40 px-6 py-12 text-center">
      <Warning size={22} weight="duotone" className="text-down" aria-hidden />
      <div>
        <p className="text-[13.5px] font-medium text-ink">The scan could not be loaded</p>
        <p className="mt-1 max-w-[52ch] text-[12.5px] leading-relaxed text-ink2">{message}</p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-[4px] border border-rule bg-surface px-3 py-1.5 text-[12.5px] font-medium text-ink transition-colors hover:border-ink3"
      >
        <ArrowsClockwise size={14} aria-hidden /> Try again
      </button>
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-ink/20 p-0 backdrop-blur-[1px] sm:items-center sm:p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="fadeup flex max-h-[88vh] w-full max-w-[720px] flex-col overflow-hidden rounded-t-[10px] border border-rule bg-surface sm:rounded-[8px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-rule px-5 py-3.5">
          <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="cursor-pointer rounded-[4px] p-1 text-ink2 transition-colors hover:bg-raise hover:text-ink"
          >
            <X size={18} aria-hidden />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}
