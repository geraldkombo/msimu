/**
 * Model skill scoring: the pure core behind scripts/verify-event.mjs and the
 * live /skill scoreboard route.
 *
 * Runtime-agnostic on purpose: no node:fs, no node-only globals. It runs in the
 * Cloudflare Worker, in Node tests, and in the CLI verifier. Fetching is done
 * by the caller; everything here is deterministic given the API payloads, so
 * the whole scoring stack is testable offline from recorded fixtures.
 *
 * WHAT THIS MEASURES
 * ------------------
 * Given what each numerical weather model said BEFORE the rain (reconstructed
 * from the free Open-Meteo Previous Runs API, where lead time is carried in the
 * VARIABLE NAME: `precipitation_previous_day3` is the value predicted 72 hours
 * before the valid time), score it against what fell.
 *
 * WHAT THIS DOES NOT MEASURE
 * --------------------------
 * The "observed" reference is the Open-Meteo best_match analysis blend, not a
 * rain gauge. Over data-sparse regions that distinction matters, so every
 * payload carries the caveat and a data_status label. Categorical scores
 * depend on the stated daily threshold (default 1.0 mm, the WMO wet-day
 * definition) and saturate on short all-wet windows; ranking then falls back
 * to MAE, which still discriminates.
 */

export const DEFAULT_MODELS = [
  'ecmwf_ifs025',
  'gfs_seamless',
  'icon_seamless',
  'meteofrance_seamless',
  'ukmo_seamless',
];

export const MODEL_LABEL = {
  ecmwf_ifs025: 'ECMWF IFS 0.25',
  gfs_seamless: 'NOAA GFS',
  icon_seamless: 'DWD ICON',
  meteofrance_seamless: 'MeteoFrance',
  ukmo_seamless: 'UKMO',
  jma_seamless: 'JMA',
  gem_seamless: 'MSC GEM',
  best_match: 'Open-Meteo blend',
};

export const REFERENCE_CAVEAT =
  'Reference "observed" series is the Open-Meteo best_match analysis blend, not a rain gauge. ' +
  'Over data-sparse regions this is a model analysis constrained by observations. ' +
  'All categorical scores depend on the stated daily threshold.';

export function round2(v) {
  return Math.round(v * 100) / 100;
}
export function round3(v) {
  return Math.round(v * 1000) / 1000;
}

/** Every calendar day in [start, end] as YYYY-MM-DD, inclusive. */
export function dateRange(startISO, endISO) {
  const out = [];
  const cur = new Date(`${startISO}T00:00:00Z`);
  const end = new Date(`${endISO}T00:00:00Z`);
  if (Number.isNaN(cur.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error('bad --start/--end, expected YYYY-MM-DD');
  }
  if (cur > end) throw new Error('--start must not be after --end');
  while (cur <= end) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

/**
 * The rolling verification window for the live scoreboard: `days` calendar days
 * ending yesterday (UTC). Today is excluded because the analysis blend for the
 * current day is still being constrained by observations; scoring it would
 * compare a forecast against a half-built reference.
 */
export function rollingWindow({ days = 7, now = new Date() } = {}) {
  const n = Math.max(1, Math.floor(days));
  const end = new Date(now);
  end.setUTCHours(0, 0, 0, 0);
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (n - 1));
  const iso = (d) => d.toISOString().slice(0, 10);
  return { startISO: iso(start), endISO: iso(end), days: dateRange(iso(start), iso(end)) };
}

/** Collapse an hourly series to daily totals keyed by local date. */
export function toDailyTotals(times, values) {
  const out = new Map();
  for (let i = 0; i < times.length; i += 1) {
    const day = String(times[i]).slice(0, 10);
    const v = values?.[i];
    out.set(day, (out.get(day) ?? 0) + (Number.isFinite(v) ? v : 0));
  }
  return out;
}

/**
 * Build the Previous Runs variable list.
 * Lead 0 is the bare variable; lead N>=1 is `precipitation_previous_dayN`.
 */
export function previousRunVariables(maxLead) {
  const vars = ['precipitation'];
  for (let n = 1; n <= maxLead; n += 1) vars.push(`precipitation_previous_day${n}`);
  return vars;
}

/**
 * The hourly key the API returns for a model at a lead offset.
 * Observed naming: `precipitation_<model>` at lead 0 and
 * `precipitation_previous_day<N>_<model>` at lead N.
 */
export function hourlyKey(model, lead) {
  return lead === 0 ? `precipitation_${model}` : `precipitation_previous_day${lead}_${model}`;
}

/**
 * Categorical and continuous scores for a wet-day threshold.
 * A day is a hit when both forecast and reference meet the threshold.
 */
export function categoricalScores(pairs, threshold) {
  let hits = 0;
  let falseAlarms = 0;
  let misses = 0;
  let correctNeg = 0;
  let sumAbsErr = 0;
  let sumBias = 0;
  for (const { f, o } of pairs) {
    const fw = f >= threshold;
    const ow = o >= threshold;
    if (fw && ow) hits += 1;
    else if (fw && !ow) falseAlarms += 1;
    else if (!fw && ow) misses += 1;
    else correctNeg += 1;
    sumAbsErr += Math.abs(f - o);
    sumBias += f - o;
  }
  const n = pairs.length;
  const pod = hits + misses > 0 ? hits / (hits + misses) : null;
  const far = hits + falseAlarms > 0 ? falseAlarms / (hits + falseAlarms) : null;
  const csi = hits + misses + falseAlarms > 0 ? hits / (hits + misses + falseAlarms) : null;
  let hss = null;
  if (n > 0) {
    const po = (hits + correctNeg) / n;
    const fYes = (hits + falseAlarms) / n;
    const oYes = (hits + misses) / n;
    const pe = fYes * oYes + (1 - fYes) * (1 - oYes);
    if (pe < 1) hss = (po - pe) / (1 - pe);
  }
  return {
    n,
    threshold_mm: threshold,
    hits,
    false_alarms: falseAlarms,
    misses,
    correct_negatives: correctNeg,
    pod: pod === null ? null : round3(pod),
    far: far === null ? null : round3(far),
    csi: csi === null ? null : round3(csi),
    hss: hss === null ? null : round3(hss),
    bias_mm: round2(sumBias / (n || 1)),
    mae_mm: round2(sumAbsErr / (n || 1)),
  };
}

/**
 * Score every model at every lead time against the reference series. Pure:
 * takes the two API payloads (observed daily series and the Previous Runs
 * response) and returns the full report.
 *
 * A model with a short forecast horizon leaves the longer offsets null, and
 * those are reported as unavailable rather than scored as zero, because a
 * missing forecast is not a dry forecast.
 */
export function scoreWindow({
  target,
  startISO,
  endISO,
  observed,
  previousRuns,
  models = DEFAULT_MODELS,
  leadDays = 7,
  threshold = 1.0,
  generated = new Date().toISOString(),
}) {
  const days = dateRange(startISO, endISO);

  const obsDaily = toDailyTotals(observed.times ?? [], observed.values ?? []);
  const observedTotals = days.map((d) => round2(obsDaily.get(d) ?? 0));

  const data = previousRuns ?? {};
  const times = data.hourly?.time ?? [];
  if (!times.length) throw new Error('Previous Runs API returned no hourly data for this window');

  const leads = [];
  for (let lead = 0; lead <= leadDays; lead += 1) {
    const perModel = {};
    let anyData = false;
    for (const m of models) {
      const series = data.hourly?.[hourlyKey(m, lead)];
      if (!Array.isArray(series)) continue;
      const populated = series.some((v) => Number.isFinite(v));
      if (!populated) {
        perModel[m] = { label: MODEL_LABEL[m] ?? m, available: false };
        continue;
      }
      anyData = true;
      const daily = toDailyTotals(times, series);
      const forecast = days.map((d) => round2(daily.get(d) ?? 0));
      const pairs = forecast.map((f, i) => ({ f, o: observedTotals[i] }));
      perModel[m] = {
        label: MODEL_LABEL[m] ?? m,
        available: true,
        forecast_mm: forecast,
        window_total_mm: round2(forecast.reduce((s, v) => s + v, 0)),
        scores: categoricalScores(pairs, threshold),
      };
    }
    leads.push({
      lead_days: lead,
      hours_before_valid_time: lead * 24,
      observed_mm: round2(observedTotals.reduce((s, v) => s + v, 0)),
      any_data: anyData,
      models: perModel,
    });
  }

  const lead0 = leads.find((l) => l.lead_days === 0);
  const distinctTotals = new Set(
    leads
      .filter((l) => l.any_data)
      .flatMap((l) => Object.values(l.models).filter((m) => m.available).map((m) => m.window_total_mm)),
  );
  if (leads.filter((l) => l.any_data).length > 1 && distinctTotals.size < 2) {
    throw new Error(
      'every lead time returned identical totals; the Previous Runs offsets were probably ' +
        'not parsed. Refusing to report a score that is an artifact.',
    );
  }

  return {
    event: {
      location: target?.label ?? `${target?.lat}, ${target?.lon}`,
      county: target?.county ?? null,
      ward: target?.ward ?? null,
      requested: { latitude: target?.lat ?? null, longitude: target?.lon ?? null },
      grid_point: {
        latitude: data.latitude ?? null,
        longitude: data.longitude ?? null,
        elevation_m: data.elevation ?? null,
      },
      window: { start: startISO, end: endISO, days },
      threshold_mm: threshold,
      lead_times_requested: leadDays,
      generated,
    },
    reference: {
      source: observed.source ?? 'Open-Meteo forecast API, daily precipitation_sum (best_match analysis)',
      snapped: observed.snapped ?? null,
      daily_mm: Object.fromEntries(days.map((d, i) => [d, observedTotals[i]])),
      window_total_mm: round2(observedTotals.reduce((s, v) => s + v, 0)),
      caveat: REFERENCE_CAVEAT,
    },
    leads,
    sanity: {
      lead_offsets_with_data: leads.filter((l) => l.any_data).map((l) => l.lead_days),
      distinct_window_totals: [...distinctTotals].sort((a, b) => a - b),
      note: lead0 ? 'lead 0 is the current run, equivalent to the live forecast API' : null,
    },
    caveat: REFERENCE_CAVEAT,
  };
}

/**
 * Best model at each lead time.
 *
 * Ranking metric depends on the window. Categorical scores (CSI/POD/FAR) are
 * degenerate when the window is short and the threshold low: with two days and a
 * 1 mm wet-day threshold almost any model scores CSI 1.0, which says nothing. In
 * that case rank on MAE, which still discriminates, and flag the saturation so
 * nobody quotes a meaningless 100%.
 */
export function summariseByLead(report) {
  const saturated = isCsiSaturated(report);
  return report.leads
    .filter((l) => l.any_data)
    .map((l) => {
      const entries = Object.entries(l.models)
        .filter(([, v]) => v.available)
        .map(([key, v]) => ({
          key,
          label: v.label,
          total: v.window_total_mm,
          abs_bias: Math.abs(v.scores.bias_mm),
          csi: v.scores.csi,
          pod: v.scores.pod,
          far: v.scores.far,
          bias: v.scores.bias_mm,
          mae: v.scores.mae_mm,
        }));
      const ranked = saturated
        ? [...entries].sort((a, b) => a.mae - b.mae || a.abs_bias - b.abs_bias)
        : [...entries].sort((a, b) => (b.csi ?? -1) - (a.csi ?? -1) || a.abs_bias - b.abs_bias);
      return {
        lead_days: l.lead_days,
        observed_mm: l.observed_mm,
        rank_metric: saturated ? 'mae_mm' : 'csi',
        best: ranked[0] ?? null,
        all: entries,
        unavailable: Object.entries(l.models)
          .filter(([, v]) => !v.available)
          .map(([k]) => MODEL_LABEL[k] ?? k),
      };
    });
}

/**
 * CSI saturates when every model detects every wet day. With a short window and
 * a low threshold that is the expected outcome, not a result.
 */
export function isCsiSaturated(report) {
  const rows = report.leads.filter((l) => l.any_data);
  if (!rows.length) return false;
  const csis = rows.flatMap((l) =>
    Object.values(l.models).filter((m) => m.available).map((m) => m.scores.csi),
  );
  return csis.length > 0 && csis.every((c) => c === 1);
}

/** Which models detected the wet window at each lead, in plain words. */
export function detectionNarrative(report) {
  const threshold = report.event.threshold_mm;
  const summary = summariseByLead(report);
  const out = [];
  for (const row of summary) {
    const detected = row.all.filter((m) => m.total >= threshold).map((m) => m.label);
    const missed = row.all.filter((m) => m.total < threshold).map((m) => m.label);
    out.push({
      lead_days: row.lead_days,
      observed_mm: row.observed_mm,
      detected,
      missed,
      spread_mm: row.all.length
        ? round2(Math.max(...row.all.map((m) => m.total)) - Math.min(...row.all.map((m) => m.total)))
        : null,
    });
  }
  return out;
}

/**
 * The public scoreboard: one compact, honest payload per model for the whole
 * window, ranked by mean absolute error. MAE is the ranking metric on purpose:
 * over a rolling multi-day window the categorical scores can still saturate on
 * wet stretches, and MAE never pretends a miss was a hit. CSI is reported
 * alongside so nobody has to trust the choice of metric blindly.
 *
 * `shortRangeLeads` (default 0-2) is what a farmer acting today or this week
 * should care about; the full-lead mean is reported separately.
 */
export function skillScoreboard(report, { shortRangeLeads = [0, 1, 2] } = {}) {
  const summary = summariseByLead(report);
  const models = new Map();

  for (const row of summary) {
    for (const m of row.all) {
      const entry = models.get(m.key) ?? {
        key: m.key,
        label: m.label,
        leads_scored: [],
        mae_by_lead: {},
        bias_by_lead: {},
        csi_by_lead: {},
      };
      entry.leads_scored.push(row.lead_days);
      entry.mae_by_lead[row.lead_days] = m.mae;
      entry.bias_by_lead[row.lead_days] = m.bias;
      entry.csi_by_lead[row.lead_days] = m.csi;
      models.set(m.key, entry);
    }
  }

  const mean = (obj, leads) => {
    const vals = leads.filter((l) => Number.isFinite(obj[l]));
    if (!vals.length) return null;
    return round2(vals.reduce((s, l) => s + obj[l], 0) / vals.length);
  };

  const allLeads = summary.map((r) => r.lead_days);
  const ranked = [...models.values()]
    .map((m) => ({
      ...m,
      mean_mae_short_range_mm: mean(m.mae_by_lead, shortRangeLeads),
      mean_mae_all_leads_mm: mean(m.mae_by_lead, allLeads),
      mean_bias_all_leads_mm: mean(m.bias_by_lead, allLeads),
    }))
    .sort(
      (a, b) =>
        (a.mean_mae_short_range_mm ?? Infinity) - (b.mean_mae_short_range_mm ?? Infinity) ||
        (a.mean_mae_all_leads_mm ?? Infinity) - (b.mean_mae_all_leads_mm ?? Infinity),
    );
  ranked.forEach((m, i) => {
    m.rank_short_range = m.mean_mae_short_range_mm === null ? null : i + 1;
  });

  const best = ranked.find((m) => m.mean_mae_short_range_mm !== null) ?? null;

  return {
    data_status: 'live_verification',
    rank_metric: 'mean absolute error in mm (lower is better); CSI reported alongside',
    window: report.event.window,
    threshold_mm: report.event.threshold_mm,
    grid_point: report.event.grid_point,
    observed_total_mm: report.reference.window_total_mm,
    observed_daily_mm: report.reference.daily_mm,
    wet_days: Object.values(report.reference.daily_mm).filter((v) => v >= report.event.threshold_mm).length,
    models: ranked,
    best_short_range: best
      ? { key: best.key, label: best.label, mean_mae_mm: best.mean_mae_short_range_mm }
      : null,
    csi_saturated: isCsiSaturated(report),
    per_lead_best: summary.map((r) => ({
      lead_days: r.lead_days,
      best: r.best ? { key: r.best.key, label: r.best.label, mae_mm: r.best.mae } : null,
      unavailable: r.unavailable,
    })),
    reference_source: report.reference.source,
    caveat: REFERENCE_CAVEAT,
  };
}
