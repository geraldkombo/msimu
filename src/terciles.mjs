export function quantile(sortedValues, q) {
  if (sortedValues.length === 0) return null;
  if (sortedValues.length === 1) return sortedValues[0];
  const pos = (sortedValues.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sortedValues[lo];
  return sortedValues[lo] + (sortedValues[hi] - sortedValues[lo]) * (pos - lo);
}

export function tercileBands(history) {
  const sorted = [...history].sort((a, b) => a - b);
  return {
    p33: quantile(sorted, 1 / 3),
    p67: quantile(sorted, 2 / 3),
    n: sorted.length,
  };
}

export function classify(value, bands) {
  if (value === null || value === undefined) return 'unknown';
  if (bands.p33 === null || bands.p67 === null) return 'unknown';
  if (value < bands.p33) return 'below';
  if (value > bands.p67) return 'above';
  return 'near';
}

export function classifyByRatio(value, normal, tolerance = 0.2) {
  if (!normal) return 'unknown';
  const ratio = value / normal;
  if (ratio < 1 - tolerance) return 'below';
  if (ratio > 1 + tolerance) return 'above';
  return 'near';
}

export function anomalyPercent(value, normal) {
  if (!normal) return null;
  return Math.round(((value - normal) / normal) * 100);
}

export function monthlyTotals(times, values) {
  const out = new Map();
  for (let i = 0; i < times.length; i++) {
    const v = values[i];
    if (v === null || v === undefined) continue;
    const key = times[i].slice(0, 7);
    out.set(key, (out.get(key) ?? 0) + v);
  }
  return out;
}

export function monthKey(dateLike) {
  return String(dateLike).slice(0, 7);
}

export function daysInMonth(key) {
  const [y, m] = String(key).split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function monthCoverage(times) {
  const seen = new Map();
  for (const t of times) {
    const k = String(t).slice(0, 7);
    const d = Number(String(t).slice(8, 10));
    if (!seen.has(k)) seen.set(k, new Set());
    seen.get(k).add(d);
  }
  const out = new Map();
  for (const [k, days] of seen) {
    out.set(k, { days_covered: days.size, days_expected: daysInMonth(k), complete: days.size >= daysInMonth(k) });
  }
  return out;
}

export function calendarMonth(key) {
  return Number(key.slice(5, 7));
}

export function groupHistoryByCalendarMonth(times, values) {
  const totals = monthlyTotals(times, values);
  const byMonth = new Map();
  for (const [key, total] of totals) {
    const m = calendarMonth(key);
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m).push(total);
  }
  return byMonth;
}

export function confidenceFromSampleSize(n) {
  if (n >= 15) return 'high';
  if (n >= 8) return 'medium';
  if (n >= 3) return 'low';
  return 'none';
}
