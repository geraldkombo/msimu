import {
  monthlyTotals,
  groupHistoryByCalendarMonth,
  tercileBands,
  classify,
  anomalyPercent,
  confidenceFromSampleSize,
  calendarMonth,
  monthCoverage,
  daysInMonth,
  quantile,
} from './terciles.mjs';

export const SEASONAL_URL = 'https://seasonal-api.open-meteo.com/v1/forecast';
export const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';

export const MODELS = {
  seasonal: 'ecmwf_seas5',
  subseasonal: 'ecmwf_ec46',
};

async function getJson(url, params) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${url}?${qs}`, { headers: { accept: 'application/json' } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${url} -> HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

export async function fetchDaily(url, site, params) {
  const data = await getJson(url, {
    latitude: site.latitude,
    longitude: site.longitude,
    daily: 'precipitation_sum',
    timezone: 'Africa/Nairobi',
    ...params,
  });
  return { times: data.daily.time, precip: data.daily.precipitation_sum, elevation: data.elevation };
}

export async function fetchSeasonal(site, { model = MODELS.seasonal, days = 210 } = {}) {
  return fetchDaily(SEASONAL_URL, site, { models: model, forecast_days: String(days) });
}

export async function fetchArchive(site, { start = '2005-01-01', end = '2024-12-31' } = {}) {
  return fetchDaily(ARCHIVE_URL, site, { start_date: start, end_date: end });
}

/**
 * One seasonal request for many points. Open-Meteo accepts comma-separated coordinates and
 * returns an array, so a whole county (typically 5-20 distinct ERA5 cells) costs one call
 * instead of one call per ward.
 */
export async function fetchSeasonalMulti(coords, { model = MODELS.seasonal, days = 210 } = {}) {
  const qs = new URLSearchParams({
    latitude: coords.map((c) => Number(c.lat).toFixed(4)).join(','),
    longitude: coords.map((c) => Number(c.lon).toFixed(4)).join(','),
    daily: 'precipitation_sum',
    models: model,
    forecast_days: String(days),
    timezone: 'Africa/Nairobi',
  }).toString();
  const res = await fetch(`${SEASONAL_URL}?${qs}`, { headers: { accept: 'application/json' } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${SEASONAL_URL} -> HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const list = Array.isArray(data) ? data : [data];
  return list.map((d) => ({ times: d.daily.time, precip: d.daily.precipitation_sum, elevation: d.elevation }));
}

export function buildBaseline(archive) {
  const byMonth = groupHistoryByCalendarMonth(archive.times, archive.precip);
  const bands = new Map();
  for (const [m, values] of byMonth) {
    bands.set(m, tercileBands(values));
  }
  return bands;
}

export function buildNormals(archive) {
  const byMonth = groupHistoryByCalendarMonth(archive.times, archive.precip);
  const normals = new Map();
  for (const [m, values] of byMonth) {
    const sorted = [...values].sort((a, b) => a - b);
    normals.set(m, {
      mean: sorted.reduce((a, b) => a + b, 0) / sorted.length,
      median: quantile(sorted, 0.5),
      n: sorted.length,
    });
  }
  return normals;
}

function normalParts(n) {
  if (n == null) return { median: null, mean: null };
  if (typeof n === 'number') return { median: n, mean: n };
  return { median: n.median ?? null, mean: n.mean ?? null };
}

export function outlookFromRaw({ forecast, baseline, normals }) {
  const totals = monthlyTotals(forecast.times, forecast.precip);
  const coverage = monthCoverage(forecast.times);
  const rows = [];
  for (const [key, value] of [...totals].sort()) {
    const m = calendarMonth(key);
    const bands = baseline.get(m);
    const { median, mean } = normalParts(normals.get(m));
    const cov = coverage.get(key) ?? { days_covered: 0, days_expected: daysInMonth(key), complete: false };
    rows.push({
      month: key,
      calendar_month: m,
      forecast_mm: Math.round(value),
      median_mm: median == null ? null : Math.round(median),
      mean_mm: mean == null ? null : Math.round(mean),
      anomaly_pct: median == null ? null : anomalyPercent(value, median),
      tercile: cov.complete && bands ? classify(value, bands) : 'unknown',
      tercile_reason: cov.complete ? (bands ? 'classified' : 'no_baseline') : 'partial_month',
      days_covered: cov.days_covered,
      days_expected: cov.days_expected,
      complete: cov.complete,
      confidence: !cov.complete ? 'none' : bands ? confidenceFromSampleSize(bands.n) : 'none',
      sample_years: bands ? bands.n : 0,
    });
  }
  return rows;
}

/**
 * Precomputed baseline path: a ward site carries its own ERA5 2005-2024 tercile bands and normals
 * (see src/wards.mjs), so an outlook costs one seasonal forecast request instead of also pulling
 * twenty years of daily history. Same classify() rules, same partial-month guard.
 */
export function baselineFromCell(cellLike) {
  const bands = new Map();
  for (let m = 1; m <= 12; m++) {
    const p33 = cellLike.p33_mm?.[m - 1];
    const p67 = cellLike.p67_mm?.[m - 1];
    if (p33 == null || p67 == null) continue;
    bands.set(m, { p33, p67, n: cellLike.sample_years ?? 0 });
  }
  return bands;
}

export function normalsFromCell(cellLike) {
  const normals = new Map();
  for (let m = 1; m <= 12; m++) {
    const mean = cellLike.rain_mm?.[m - 1] ?? cellLike.normals_2005_2024?.rain_mm?.[m - 1];
    const median = cellLike.rain_median_mm?.[m - 1] ?? cellLike.normals_2005_2024?.rain_median_mm?.[m - 1];
    if (mean == null && median == null) continue;
    normals.set(m, { mean, median, n: cellLike.sample_years ?? 0 });
  }
  return normals;
}

export function hasPrecomputedBaseline(site) {
  return Boolean(site?.p33_mm && site?.p67_mm);
}

export async function computeOutlook(site, { archive, forecast } = {}) {
  if (hasPrecomputedBaseline(site) && !archive) {
    const f = forecast ?? (await fetchSeasonal(site));
    return {
      site: site.name,
      elevation_m: site.elevation_m ?? f.elevation,
      retrieved_at: new Date().toISOString(),
      models: MODELS,
      baseline_years: site.sample_years ?? 0,
      baseline_source: 'era5_2005_2024_precomputed',
      months: outlookFromRaw({ forecast: f, baseline: baselineFromCell(site), normals: normalsFromCell(site) }),
    };
  }

  const [a, f] = await Promise.all([
    archive ?? fetchArchive(site),
    forecast ?? fetchSeasonal(site),
  ]);
  const baseline = buildBaseline(a);
  const normals = buildNormals(a);
  return {
    site: site.name,
    elevation_m: f.elevation,
    retrieved_at: new Date().toISOString(),
    models: MODELS,
    baseline_years: [...baseline.values()][0]?.n ?? 0,
    baseline_source: 'era5_archive_fetched',
    months: outlookFromRaw({ forecast: f, baseline, normals }),
  };
}
