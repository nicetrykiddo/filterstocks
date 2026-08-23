/** Indian-market formatting conventions. */

export function fmtDateHuman(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${days[dt.getUTCDay()]} ${d} ${months[m - 1]} ${y}`;
}

export function fmtDateShort(iso: string): string {
  const [, m, d] = iso.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d} ${months[Number(m) - 1]}`;
}

export function fmtPrice(x: number): string {
  return x.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Volume in Indian units: lakh (1e5) and crore (1e7). */
export function fmtVolume(x: number): string {
  if (x >= 1e7) return `${(x / 1e7).toFixed(2)} Cr`;
  if (x >= 1e5) return `${(x / 1e5).toFixed(2)} L`;
  if (x >= 1e3) return `${(x / 1e3).toFixed(1)} K`;
  return String(Math.round(x));
}

export function fmtPct(x: number, digits = 1): string {
  return `${x >= 0 ? "+" : ""}${x.toFixed(digits)}%`;
}

export function fmtSigned(x: number): string {
  return `${x >= 0 ? "+" : ""}${x}`;
}

export function relTime(iso: string): string {
  const then = new Date(iso).getTime();
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 36) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}
