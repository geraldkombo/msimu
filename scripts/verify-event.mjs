/**
 * Point forecast verification for one weather event.
 *
 * WHAT THIS MEASURES
 * ------------------
 * Given a location and a date window, this reconstructs what each numerical
 * weather model said BEFORE the event, and scores it against what fell.
 *
 * The reconstruction uses the free Open-Meteo Previous Runs API. Lead time is
 * carried in the VARIABLE NAME, not a query parameter: requesting
 * `precipitation_previous_day3` returns the value the model predicted 72 hours
 * before the valid time. `_previous_day0` (the bare variable) is the current run.
 * Getting this wrong silently returns the latest run for every lead time and
 * produces an impossible perfect score, so the parsing is asserted, not assumed.
 *
 * Models scored by default: ECMWF IFS 0.25, NOAA GFS, DWD ICON, MeteoFrance,
 * UKMO. All free, all keyless, all archived from January 2024.
 *
 * WHAT THIS DOES **NOT** MEASURE
 * ------------------------------
 * The "observed" series is the Open-Meteo best_match analysis blend, not a rain
 * gauge. It is a model analysis constrained by observations, and over
 * data-sparse Africa that distinction matters. Every result is labelled with its
 * reference source and the caveat is always printed. For a gauge truth, pass
 * --observed-file with a CSV of `time,mm` rows.
 *
 * Categorical scores depend entirely on the daily threshold, so it is printed
 * with every result. Default 1.0 mm is the WMO wet-day definition.
 *
 * Usage:
 *   node scripts/verify-event.mjs --lat -1.4275 --lon 36.6865 --start 2026-10-30 --end 2026-10-31
 *   node scripts/verify-event.mjs --site gataka --start 2026-10-30 --end 2026-10-31 --lead-days 7
 *   node scripts/verify-event.mjs --lat -1.28 --lon 36.83 --start 2026-10-30 --end 2026-10-31 --threshold 10 --json
 *
 * Costs nothing but bandwidth: no API key, no paid service, no dependencies.
 */
import { readFile } from 'node:fs/promises';
import { getSite } from '../src/packs.mjs';

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
};
const has = (name) => argv.includes(`--${name}`);
const asJSON = has('json');

const DEFAULT_MODELS = [
  'ecmwf_ifs025',
  'gfs_seamless',
  'icon_seamless',
  'meteofrance_seamless',
  'ukmo_seamless',
];

const MODEL_LABEL = {
  ecmwf_ifs025: 'ECMWF IFS 0.25',
  gfs_seamless: 'NOAA GFS',
  icon_seamless: 'DWD ICON',
  meteofrance_seamless: 'MeteoFrance',
  ukmo_seamless: 'UKMO',
  jma_seamless: 'JMA',
  gem_seamless: 'MSC GEM',
  best_match: 'Open-Meteo blend',
};

const REFERENCE_CAVEAT =
  'Reference "observed" series is the Open-Meteo best_match analysis blend, not a rain gauge. ' +
  'Over data-sparse regions this is a model analysis constrained by observations. ' +
  'All categorical scores depend on the stated daily threshold.';

/** Resolve the target point from --lat/--lon or --site. */
export function resolveTarget({ lat, lon, label, siteId } = {}) {
  if (siteId) {
    const site = getSite(siteId);
    if (!site) throw new Error(`unknown site "${siteId}"`);
    return {
      lat: site.latitude,
      lon: site.longitude,
      label: site.name,
      county: site.county ?? null,
      ward: site.ward ?? null,
      elevation_m: site.elevation_m ?? null,
      source: `packs/sites.json#${siteId}`,
    };
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error('pass --lat and --lon, or --site <id>');
  }
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    throw new Error('latitude must be within -90..90 and longitude within -180..180');
  }
  return {
    lat,
    lon,
    label: label ?? `${lat}, ${lon}`,
    county: null,
    ward: null,
    elevation_m: null,
    source: 'cli',
  };
}

async function getJSON(url, attempt = 1) {
  const res = await fetch(url, { headers: { 'user-agent': 'msimu/1.0 (verify-event)' } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const msg = `HTTP ${res.status} for ${url}${body ? ` :: ${body.slice(0, 200)}` : ''}`;
    // Open-Meteo sheds load under bursts. Back off rather than failing the run.
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await new Promise((r) => setTimeout(r, 800 * attempt * attempt));
      return getJSON(url, attempt + 1);
    }
    throw new Error(msg);
  }
  return res.json();
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

/** Fetch the reference (analysis) series for the window. */
async function fetchObserved(target, startISO, endISO) {
  const qs = new URLSearchParams({
    latitude: String(target.lat),
    longitude: String(target.lon),
    daily: 'precipitation_sum',
    start_date: startISO,
    end_date: endISO,
    timezone: 'auto',
  });
  const data = await getJSON(`https://api.open-meteo.com/v1/forecast?${qs}`);
  return {
    times: data.daily?.time ?? [],
    values: data.daily?.precipitation_sum ?? [],
    snapped: {
      latitude: data.latitude,
      longitude: data.longitude,
      elevation_m: data.elevation,
    },
    source: 'Open-Meteo forecast API, daily precipitation_sum (best_match analysis)',
  };
}

/** Load a user-supplied gauge CSV of `time,mm` rows. */
export async function loadObservedFile(path) {
  const text = await readFile(path, 'utf8');
  const times = [];
  const values = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [a, b] = trimmed.split(',');
    if (!a || b === undefined || !/^\d/.test(a)) continue; // skip header rows
    times.push(a.trim());
    values.push(Number(b));
  }
  if (!times.length) throw new Error(`--observed-file ${path} produced no rows (expected time,mm)`);
  return { times, values, source: `user-supplied gauge file ${path}` };
}

function round2(v) {
  return Math.round(v * 100) / 100;
}
function round3(v) {
  return Math.round(v * 1000) / 1000;
}
function pct(v) {
  return v === null ? 'n/a' : `${Math.round(v * 100)}%`;
}

/**
 * Score every model at every lead time against the reference series.
 *
 * Lead semantics come from Open-Meteo: `_previous_dayN` is the value predicted
 * N x 24 h before the valid time. A model with a short forecast horizon leaves
 * the longer offsets null, and those are reported as unavailable rather than
 * scored as zero, because a missing forecast is not a dry forecast.
 */
export async function verifyEvent(opts) {
  const {
    target,
    startISO,
    endISO,
    models = DEFAULT_MODELS,
    leadDays = 7,
    threshold = 1.0,
    observedFile = null,
  } = opts;

  const days = dateRange(startISO, endISO);

  const obs = observedFile
    ? await loadObservedFile(observedFile)
    : await fetchObserved(target, startISO, endISO);
  const obsDaily = toDailyTotals(obs.times, obs.values);
  const observedTotals = days.map((d) => round2(obsDaily.get(d) ?? 0));

  const qs = new URLSearchParams({
    latitude: String(target.lat),
    longitude: String(target.lon),
    hourly: previousRunVariables(leadDays).join(','),
    models: models.join(','),
    start_date: startISO,
    end_date: endISO,
    timezone: 'auto',
  });
  const data = await getJSON(`https://previous-runs-api.open-meteo.com/v1/forecast?${qs}`);
  const times = data.hourly?.time ?? [];
  if (!times.length) throw new Error('Previous Runs API returned no hourly data for this window');

  const leads = [];
  for (let lead = 0; lead <= leadDays; lead += 1) {
    const perModel = {};
    let anyData = false;
    for (const m of models) {
      const series = data.hourly?.[hourlyKey(m, lead)];
      if (!Array.isArray(series)) continue;
      // A model with a shorter horizon returns all-null at long offsets. Report
      // that as unavailable; scoring nulls as 0 mm would fake a dry forecast.
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
      location: target.label,
      county: target.county,
      ward: target.ward,
      requested: { latitude: target.lat, longitude: target.lon },
      grid_point: {
        latitude: data.latitude,
        longitude: data.longitude,
        elevation_m: data.elevation,
      },
      window: { start: startISO, end: endISO, days },
      threshold_mm: threshold,
      lead_times_requested: leadDays,
      generated: new Date().toISOString(),
    },
    reference: {
      source: obs.source,
      snapped: obs.snapped ?? null,
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

function printHuman(report) {
  const e = report.event;
  console.log(`Msimu event verification - ${e.location}`);
  if (e.county) console.log(`county: ${e.county}${e.ward ? ` | ward: ${e.ward}` : ''}`);
  console.log(`point : ${e.requested.latitude}, ${e.requested.longitude}`);
  console.log(
    `grid  : ${e.grid_point.latitude}, ${e.grid_point.longitude}` +
      `${e.grid_point.elevation_m ? ` | ${e.grid_point.elevation_m} m` : ''}`,
  );
  console.log(`window: ${e.window.start} to ${e.window.end} (${e.window.days.length} day(s))`);
  console.log(`wet-day threshold: ${e.threshold_mm} mm`);
  console.log('');

  console.log('reference (what fell):');
  for (const [d, v] of Object.entries(report.reference.daily_mm)) {
    console.log(`  ${d}  ${String(v).padStart(6)} mm`);
  }
  console.log(`  window total ${String(report.reference.window_total_mm).padStart(6)} mm`);
  console.log(`  source: ${report.reference.source}`);
  console.log('');

  const summary = summariseByLead(report);
  if (!summary.length) {
    console.log('no archived model runs could be retrieved for this window.');
    console.log(`CAVEAT: ${report.caveat}`);
    return;
  }

  if (isCsiSaturated(report)) {
    console.log(
      `NOTE: CSI is saturated (every model scores 1.0) because the window is ${e.window.days.length} day(s) ` +
        `at a ${e.threshold_mm} mm threshold. Ranking falls back to MAE, which still discriminates. ` +
        'Do not quote the CSI as a skill score.',
    );
    console.log('');
  }

  console.log('lead     window totals in mm, observed in brackets');
  for (const row of summary) {
    const parts = row.all.map((m) => `${m.label.split(' ')[0]}=${m.total}`);
    console.log(`  ${String(row.lead_days).padStart(2)}d  [obs ${row.observed_mm}]  ${parts.join('  ')}`);
    if (row.unavailable.length) console.log(`       unavailable: ${row.unavailable.join(', ')}`);
  }
  console.log('');

  const metric = summary[0]?.rank_metric === 'mae_mm' ? 'MAE' : 'CSI';
  console.log(`lead   best on ${metric}            total     bias      ${metric}     CSI    POD    FAR`);
  for (const row of summary) {
    const b = row.best;
    if (!b) continue;
    console.log(
      `${String(row.lead_days).padStart(3)}d   ${b.label.padEnd(20)} ` +
        `${String(b.total).padStart(7)}mm ${String(b.bias).padStart(7)}mm ` +
        `${String(b.mae).padStart(7)}mm  ${pct(b.csi).padStart(5)}  ${pct(b.pod).padStart(5)}  ${pct(b.far).padStart(5)}`,
    );
  }
  console.log('');

  console.log('detection (did the model call a wet window at all?):');
  for (const d of detectionNarrative(report)) {
    console.log(
      `  ${String(d.lead_days).padStart(2)}d  detected: ${d.detected.join(', ') || 'none'}` +
        `${d.missed.length ? `  |  missed: ${d.missed.join(', ')}` : ''}` +
        `  |  spread ${d.spread_mm} mm`,
    );
  }
  console.log('');
  console.log(`CAVEAT: ${report.caveat}`);
}

const isMain = process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, '/')}`).href;

if (isMain) {
  const startISO = flag('start', null);
  if (!startISO) {
    console.error('pass --start YYYY-MM-DD (and optionally --end YYYY-MM-DD)');
    process.exit(2);
  }
  const target = resolveTarget({
    lat: Number(flag('lat', NaN)),
    lon: Number(flag('lon', NaN)),
    label: flag('label', undefined),
    siteId: flag('site', null),
  });
  const modelsArg = flag('models', null);
  const report = await verifyEvent({
    target,
    startISO,
    endISO: flag('end', startISO),
    models: modelsArg
      ? modelsArg.split(',').map((s) => s.trim()).filter(Boolean)
      : DEFAULT_MODELS,
    leadDays: Number(flag('lead-days', '7')),
    threshold: Number(flag('threshold', '1')),
    observedFile: flag('observed-file', null),
  });
  if (asJSON) console.log(JSON.stringify(report, null, 2));
  else printHuman(report);
}
