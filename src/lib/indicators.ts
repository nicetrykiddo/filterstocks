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

export function rollingMax(xs: number[], n: number): (number | null)[] {
  const out: (number | null)[] = new Array(xs.length).fill(null);
  for (let i = n - 1; i < xs.length; i++) {
    let m = -Infinity;
    for (let j = i - n + 1; j <= i; j++) if (xs[j] > m) m = xs[j];
    out[i] = m;
  }
  return out;
}

export function rollingMin(xs: number[], n: number): (number | null)[] {
  const out: (number | null)[] = new Array(xs.length).fill(null);
  for (let i = n - 1; i < xs.length; i++) {
    let m = Infinity;
    for (let j = i - n + 1; j <= i; j++) if (xs[j] < m) m = xs[j];
    out[i] = m;
  }
  return out;
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

export function pctChange(from: number, to: number): number {
  return (to / from - 1) * 100;
}

export function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
