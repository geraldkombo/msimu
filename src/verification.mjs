/**
 * Forecast-band verification.
 *
 * WHAT THIS MEASURES
 * ------------------
 * Our advisory is a tercile classification ("rainfall below / near / above the
 * long-run band for this month"). Those bands come from a 20-year ERA5 baseline.
 * A reviewer's first question is: are the bands an artifact of which years we
 * happened to pick? This module answers that with leave-one-out (LOO)
 * cross-validation.
 *
 * For every (calendar month, year) we rebuild the p33/p67 bands from the OTHER
 * 19 years only, classify that held-out year's observed total, and compare it to
 * the classification produced by the full 20-year baseline that the product
 * actually ships. Agreement rate + Heidke Skill Score quantify how much the
 * answer depends on the baseline sample.
 *
 * WHAT THIS DOES **NOT** MEASURE
 * ------------------------------
 * It does NOT measure ECMWF SEAS5 seasonal forecast skill. That would require
 * archived seasonal forecasts (hindcasts) issued before each season, which the
 * free Open-Meteo endpoint does not serve. We say so in the README, the docs and
 * the CLI output. Do not let any downstream text imply otherwise.
 *
 * A random three-category guess scores ~33% agreement and HSS ~0; a perfectly
 * stable band scores 100% and HSS 1.
 */
import { classify, monthCoverage, monthlyTotals, tercileBands } from './terciles.mjs';

export const CATEGORIES = ['below', 'near', 'above'];

/**
 * Turn a daily precipitation series into one row per COMPLETE calendar month.
 * Partial months are dropped: they are the same reason the forecast side never
 * classifies a partial month.
 */
export function buildRows(times, values) {
  const totals = monthlyTotals(times, values);
  const coverage = monthCoverage(times);
  const rows = [];
  for (const [key, total] of totals) {
    const cov = coverage.get(key);
    if (!cov?.complete) continue;
    rows.push({ key, year: Number(key.slice(0, 4)), month: Number(key.slice(5, 7)), total });
  }
  return rows.sort((a, b) => (a.key < b.key ? -1 : 1));
}

/** Full-sample bands per calendar month - what the product ships. */
export function fullSampleBands(rows) {
  const out = new Map();
  for (const m of monthsOf(rows)) {
    out.set(m, tercileBands(rows.filter((r) => r.month === m).map((r) => r.total)));
  }
  return out;
}

/** Bands per calendar month with one year held out (leave-one-out). */
export function leaveOneOutBands(rows, excludeYear) {
  const held = rows.filter((r) => r.year !== excludeYear);
  const out = new Map();
  for (const m of monthsOf(rows)) {
    out.set(m, tercileBands(held.filter((r) => r.month === m).map((r) => r.total)));
  }
  return out;
}

/** Bands built from only the first `n` years - a short-baseline robustness check. */
export function shortBaselineBands(rows, n) {
  const years = yearsOf(rows).slice(0, n);
  const held = rows.filter((r) => years.includes(r.year));
  const out = new Map();
  for (const m of monthsOf(rows)) {
    out.set(m, tercileBands(held.filter((r) => r.month === m).map((r) => r.total)));
  }
  return out;
}

export function yearsOf(rows) {
  return [...new Set(rows.map((r) => r.year))].sort((a, b) => a - b);
}

export function monthsOf(rows) {
  return [...new Set(rows.map((r) => r.month))].sort((a, b) => a - b);
}

export function emptyContingency() {
  return Object.fromEntries(CATEGORIES.map((a) => [a, Object.fromEntries(CATEGORIES.map((b) => [b, 0]))]));
}

/**
 * Heidke Skill Score for a k x k contingency table.
 * HSS = (Po - Pe) / (1 - Pe);  Po = observed agreement, Pe = agreement by chance.
 */
export function heidkeSkillScore(contingency) {
  const total = CATEGORIES.reduce(
    (s, a) => s + CATEGORIES.reduce((t, b) => t + (contingency[a]?.[b] ?? 0), 0),
    0,
  );
  if (!total) return null;
  const po = CATEGORIES.reduce((s, c) => s + (contingency[c]?.[c] ?? 0), 0) / total;
  let pe = 0;
  for (const c of CATEGORIES) {
    const rowSum = CATEGORIES.reduce((s, b) => s + (contingency[c]?.[b] ?? 0), 0);
    const colSum = CATEGORIES.reduce((s, a) => s + (contingency[a]?.[c] ?? 0), 0);
    pe += (rowSum * colSum) / (total * total);
  }
  if (pe === 1) return null;
  return (po - pe) / (1 - pe);
}

/**
 * Leave-one-out cross-validation of the shipped tercile bands.
 *
 * @param {Array<{key:string, year:number, month:number, total:number}>} rows
 * @returns {object} agreement, HSS, contingency table, per-month breakdown, disagreements
 */
export function crossValidateTerciles(rows) {
  if (!rows?.length) {
    return {
      n: 0,
      years: [],
      months: [],
      agreement: 0,
      agreement_rate: null,
      agreement_pct: null,
      reference_rate: 1 / 3,
      hss: null,
      contingency: emptyContingency(),
      per_month: [],
      disagreements: [],
      tercile_counts: Object.fromEntries(CATEGORIES.map((c) => [c, 0])),
      collapsed_bands: { count: 0, months: [] },
      caveat: NOT_SKILL_CAVEAT,
    };
  }

  const full = fullSampleBands(rows);
  const years = yearsOf(rows);
  const looByYear = new Map(years.map((y) => [y, leaveOneOutBands(rows, y)]));

  const contingency = emptyContingency();
  const tercile_counts = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
  const perMonth = new Map(monthsOf(rows).map((m) => [m, { month: m, n: 0, agreements: 0 }]));
  const disagreements = [];
  let agreement = 0;

  for (const row of rows) {
    const shipped = classify(row.total, full.get(row.month));
    const loo = classify(row.total, looByYear.get(row.year).get(row.month));
    if (shipped === 'unknown' || loo === 'unknown') continue;

    tercile_counts[shipped] += 1;
    contingency[loo][shipped] += 1;
    const bucket = perMonth.get(row.month);
    bucket.n += 1;
    if (loo === shipped) {
      agreement += 1;
      bucket.agreements += 1;
    } else {
      disagreements.push({
        key: row.key,
        total_mm: round2(row.total),
        shipped,
        leave_one_out: loo,
        shipped_bands: roundBands(full.get(row.month)),
        loo_bands: roundBands(looByYear.get(row.year).get(row.month)),
      });
    }
  }

  const n = [...perMonth.values()].reduce((s, b) => s + b.n, 0);

  // In very dry months most years have the same total (often 0 mm), so p33 === p67
  // and the tercile band collapses: every such year is classified "near". Surface it
  // rather than letting a 100% agreement score hide it.
  const collapsed = monthsOf(rows).filter((m) => {
    const b = full.get(m);
    return b && b.p33 !== null && b.p33 === b.p67;
  });

  return {
    n,
    years,
    baseline_years: years.length,
    months: [...perMonth.keys()],
    agreement,
    agreement_rate: n ? agreement / n : null,
    agreement_pct: n ? Math.round((agreement / n) * 1000) / 10 : null,
    reference_rate: 1 / 3,
    hss: heidkeSkillScore(contingency),
    contingency,
    tercile_counts,
    collapsed_bands: { count: collapsed.length, months: collapsed },
    per_month: [...perMonth.values()].map((b) => ({
      month: b.month,
      n: b.n,
      agreement_pct: b.n ? Math.round((b.agreements / b.n) * 1000) / 10 : null,
    })),
    disagreements,
    caveat: NOT_SKILL_CAVEAT,
  };
}

/**
 * How much does a shorter baseline change the answer? Classify every year using
 * bands built from only the first `n` years and compare to the shipped full-sample
 * classification. This is the "would 10 years be enough?" check.
 */
export function shortBaselineAgreement(rows, n = 10) {
  if (!rows?.length) return { baseline_years: n, n: 0, agreement_pct: null };
  const full = fullSampleBands(rows);
  const short = shortBaselineBands(rows, n);
  let agree = 0;
  let count = 0;
  for (const row of rows) {
    const shipped = classify(row.total, full.get(row.month));
    const candidate = classify(row.total, short.get(row.month));
    if (shipped === 'unknown' || candidate === 'unknown') continue;
    count += 1;
    if (shipped === candidate) agree += 1;
  }
  return {
    baseline_years: n,
    n: count,
    agreement_pct: count ? Math.round((agree / count) * 1000) / 10 : null,
  };
}

export const NOT_SKILL_CAVEAT =
  'Leave-one-out band stability on ERA5 2005-2024. This is NOT a measure of ECMWF SEAS5 seasonal forecast skill: ' +
  'no archived seasonal hindcasts are available from the free endpoint. A random three-way guess would score ~33%.';

function round2(v) {
  return Math.round(v * 100) / 100;
}

function roundBands(bands) {
  if (!bands) return null;
  return { p33_mm: round2(bands.p33), p67_mm: round2(bands.p67), n: bands.n };
}
