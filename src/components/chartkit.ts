/** Read design tokens at draw time so charts repaint correctly on theme change. */
export function cssVars(names: string[]): Record<string, string> {
  if (typeof window === "undefined") return {};
  const s = getComputedStyle(document.documentElement);
  const out: Record<string, string> = {};
  for (const n of names) out[n] = s.getPropertyValue(n).trim();
  return out;
}

export function fmtVol(x: number): string {
  if (x >= 1e7) return `${(x / 1e7).toFixed(2)}Cr`;
  if (x >= 1e5) return `${(x / 1e5).toFixed(2)}L`;
  return x.toLocaleString("en-IN");
}
