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
 * The scoring core lives in src/skill.mjs, shared with the live /skill
 * scoreboard route so the CLI and the API can never drift apart. This file is
 * the Node-only shell: argument parsing, fetching with backoff, gauge-file
 * support and human printing.
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
import {
  DEFAULT_MODELS,
  REFERENCE_CAVEAT,
  categoricalScores,
  dateRange,
  detectionNarrative,
  hourlyKey,
  isCsiSaturated,
  previousRunVariables,
  scoreWindow,
  summariseByLead,
  toDailyTotals,
} from '../src/skill.mjs';

// Re-exported so the existing test suite (and any script) keeps one import path.
export {
  DEFAULT_MODELS,
  REFERENCE_CAVEAT,
  categoricalScores,
  dateRange,
  detectionNarrative,
  hourlyKey,
  isCsiSaturated,
  previousRunVariables,
  scoreWindow,
  summariseByLead,
  toDailyTotals,
};

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
};
const has = (name) => argv.includes(`--${name}`);
const asJSON = has('json');

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

function pct(v) {
  return v === null ? 'n/a' : `${Math.round(v * 100)}%`;
}

/** Fetch both payloads, then hand the pure scoring core in src/skill.mjs. */
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

  // Fail fast on a bad window before spending any request.
  dateRange(startISO, endISO);

  const obs = observedFile
    ? await loadObservedFile(observedFile)
    : await fetchObserved(target, startISO, endISO);

  const qs = new URLSearchParams({
    latitude: String(target.lat),
    longitude: String(target.lon),
    hourly: previousRunVariables(leadDays).join(','),
    models: models.join(','),
    start_date: startISO,
    end_date: endISO,
    timezone: 'auto',
  });
  const previousRuns = await getJSON(`https://previous-runs-api.open-meteo.com/v1/forecast?${qs}`);

  return scoreWindow({ target, startISO, endISO, observed: obs, previousRuns, models, leadDays, threshold });
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
