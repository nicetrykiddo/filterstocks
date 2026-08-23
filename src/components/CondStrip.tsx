"use client";

/**
 * The punch strip: eleven cells, one per condition. This is the product's
 * signature view of a stock, compact enough to sit in a table row and
 * readable as a tally at a glance.
 */
export function CondStrip({
  conds,
  active,
  onToggle,
  size = "md",
}: {
  conds: boolean[];
  /** Cells the user has pinned as filters (pass-rate panel usage). */
  active?: number[];
  onToggle?: (i: number) => void;
  size?: "sm" | "md" | "lg";
}) {
  const dim = size === "sm" ? "h-3 w-[7px]" : size === "lg" ? "h-7 w-4" : "h-4.5 w-2.5";
  return (
    <span className="inline-flex items-end gap-[2px]" role="img" aria-hidden={!onToggle ? undefined : false}>
      {conds.map((pass, i) => {
        const isActive = active?.includes(i);
        const base = `${dim} rounded-[2px] border transition-colors duration-100`;
        if (onToggle) {
          return (
            <button
              key={i}
              type="button"
              onClick={() => onToggle(i)}
              aria-pressed={isActive}
              title={`Condition ${i + 1}`}
              className={`${base} ${
                isActive
                  ? "border-accent bg-accent"
                  : pass
                    ? "border-ink/40 bg-ink/70 hover:border-accent"
                    : "border-rule bg-transparent hover:border-accent"
              } cursor-pointer`}
            />
          );
        }
        return (
          <span
            key={i}
            className={`${base} ${
              pass ? "border-ink/40 bg-ink/70 dark:border-ink/50 dark:bg-ink/70" : "border-rule bg-transparent"
            }`}
          />
        );
      })}
    </span>
  );
}
