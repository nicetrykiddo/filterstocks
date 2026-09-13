/** Rolling statistics over numeric series. All return sparse arrays aligned to the input. */

export function sma(xs: number[], n: number): (number | null)[] {
  const out: (number | null)[] = new Array(xs.length).fill(null);
  let sum = 0;
  for (let i = 0; i < xs.length; i++) {
    sum += xs[i];
    if (i >= n) sum -= xs[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

/**
 * Sliding-window maximum via a monotonic deque: each index enters and leaves
 * the deque once, so the whole series costs O(length) regardless of n.
 */
export function rollingMax(xs: number[], n: number): (number | null)[] {
  const out: (number | null)[] = new Array(xs.length).fill(null);
  const dq: number[] = []; // indices, values decreasing
  for (let i = 0; i < xs.length; i++) {
    while (dq.length && xs[dq[dq.length - 1]] <= xs[i]) dq.pop();
    dq.push(i);
    if (dq[0] <= i - n) dq.shift();
    if (i >= n - 1) out[i] = xs[dq[0]];
  }
  return out;
}

/** Sliding-window minimum; the monotonic-deque mirror of rollingMax. */
export function rollingMin(xs: number[], n: number): (number | null)[] {
  const out: (number | null)[] = new Array(xs.length).fill(null);
  const dq: number[] = []; // indices, values increasing
  for (let i = 0; i < xs.length; i++) {
    while (dq.length && xs[dq[dq.length - 1]] >= xs[i]) dq.pop();
    dq.push(i);
    if (dq[0] <= i - n) dq.shift();
    if (i >= n - 1) out[i] = xs[dq[0]];
  }
  return out;
}

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** Wilder-style average true range over n sessions. */
export function atr(
  highs: number[],
  lows: number[],
  closes: number[],
  n: number,
): (number | null)[] {
  const len = closes.length;
  const tr: number[] = new Array(len).fill(0);
  for (let i = 0; i < len; i++) {
    if (i === 0) {
      tr[i] = highs[i] - lows[i];
    } else {
      tr[i] = Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1]),
      );
    }
  }
  const out: (number | null)[] = new Array(len).fill(null);
  let prev: number | null = null;
  for (let i = 0; i < len; i++) {
    if (i === n - 1) {
      let sum = 0;
      for (let j = 0; j < n; j++) sum += tr[j];
      prev = sum / n;
      out[i] = prev;
    } else if (i >= n && prev !== null) {
      prev = (prev * (n - 1) + tr[i]) / n;
      out[i] = prev;
    }
  }
  return out;
}

/** Wilder RSI over n sessions. */
export function rsi(closes: number[], n = 14): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  let avgUp = 0;
  let avgDn = 0;
  for (let i = 1; i < closes.length; i++) {
    const ch = closes[i] - closes[i - 1];
    const up = Math.max(ch, 0);
    const dn = Math.max(-ch, 0);
    if (i <= n) {
      avgUp += up / n;
      avgDn += dn / n;
      if (i === n) {
        out[i] = avgDn === 0 ? 100 : 100 - 100 / (1 + avgUp / avgDn);
      }
    } else {
      avgUp = (avgUp * (n - 1) + up) / n;
      avgDn = (avgDn * (n - 1) + dn) / n;
      out[i] = avgDn === 0 ? 100 : 100 - 100 / (1 + avgUp / avgDn);
    }
  }
  return out;
}

/** Population standard deviation over the trailing n values. */
export function rollingStdev(xs: number[], n: number): (number | null)[] {
  const out: (number | null)[] = new Array(xs.length).fill(null);
  for (let i = n - 1; i < xs.length; i++) {
    let mean = 0;
    for (let j = i - n + 1; j <= i; j++) mean += xs[j];
    mean /= n;
    let acc = 0;
    for (let j = i - n + 1; j <= i; j++) acc += (xs[j] - mean) ** 2;
    out[i] = Math.sqrt(acc / n);
  }
  return out;
}

export interface Pivot {
  idx: number;
  high: boolean;
  price: number;
}

/**
 * Swing pivots on a series using a k-bar fractal window: a pivot high is a
 * value greater than the k values either side of it. Returns pivots in order.
 */
export function fractalPivots(xs: number[], k = 3): Pivot[] {
  const out: Pivot[] = [];
  for (let i = k; i < xs.length - k; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - k; j <= i + k; j++) {
      if (j === i) continue;
      if (xs[j] > xs[i]) isHigh = false;
      if (xs[j] < xs[i]) isLow = false;
    }
    if (isHigh) out.push({ idx: i, high: true, price: xs[i] });
    else if (isLow) out.push({ idx: i, high: false, price: xs[i] });
  }
  return out;
}

export function pctChange(from: number, to: number): number {
  return from === 0 ? 0 : (to / from - 1) * 100;
}

export function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
