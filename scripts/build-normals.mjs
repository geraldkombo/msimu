/**
 * Build ERA5 2005-2024 climate normals for every ward in Kenya, at ERA5's own resolution.
 *
 * Zero dependencies. Run:
 *   node scripts/build-normals.mjs                # all wards (resumable, cached)
 *   node scripts/build-normals.mjs --limit 20     # quick smoke run over the first 20 cells
 *   node scripts/build-normals.mjs --force        # ignore the cache and refetch
 *
 * Writes:
 *   data/wards.json           engine data pack: grid-cell normals + every ward's cell reference
 *   web/data/wards-index.json dashboard registry (no geometry; geometry lives in web/boundaries/)
 *
 * Why grid cells and not wards: ERA5 is a 0.25-degree reanalysis (~25 km). Asking it for 1452
 * ward centroids separately would return the same numbers for neighbouring wards while costing
 * 1452 requests. Snapping centroids to the 0.25-degree grid gives ~450 unique cells, so the same
 * coverage costs a third of the requests and every ward is described by the value the model can
 * actually resolve. Wards sharing a cell share normals, and the pack says so.
 *
 * Cost: $0. Open-Meteo archive API, no key. Downloads are cached per cell under cache/era5/ as
 * derived statistics (not raw daily series), so re-runs are offline and the repo stays small.
 */
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { monthlyTotals, groupHistoryByCalendarMonth, tercileBands, quantile } from '../src/terciles.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const FORCE = argv.includes('--force');
const NO_FETCH = argv.includes('--no-fetch');
const numArg = (flag, fallback) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : fallback;
};
const LIMIT = numArg('--limit', 0);
const BATCH = numArg('--batch', 6);
const CONCURRENCY = numArg('--concurrency', 2);

const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';
const START = '2005-01-01';
const END = '2024-12-31';
const GRID = 0.25;
const FROST_ELEVATION_M = 1900;
const CACHE = join(root, 'cache', 'era5');
const INDEX = join(root, 'web', 'boundaries', 'index.json');

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const snap = (v) => Math.round(v / GRID) * GRID;
const cellKey = (lat, lon) => `${snap(lat).toFixed(2)},${snap(lon).toFixed(2)}`;
const round = (v, dp = 1) => (v == null || Number.isNaN(v) ? null : Math.round(v * 10 ** dp) / 10 ** dp);

async function getJSON(url, tries = 4) {
  let lastErr;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(180000), headers: { accept: 'application/json' } });
      if (res.status === 429) {
        // Open-Meteo rate limit: honour Retry-After when present, otherwise back off briefly.
        const retryAfter = Number(res.headers.get('retry-after'));
        const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 20000) : 4000 * attempt;
        throw Object.assign(new Error('HTTP 429 rate limited'), { wait });
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      if (attempt < tries) await new Promise((r) => setTimeout(r, Math.min(err.wait ?? 2000 * attempt, 20000)));
    }
  }
  throw lastErr;
}

/** Monthly statistics over the 20 complete years: mean, median, tercile bands. */
function statsFromDaily(times, values) {
  const byMonth = groupHistoryByCalendarMonth(times, values);
  const mean = [], median = [], p33 = [], p67 = [], counts = [];
  for (const m of MONTHS) {
    const series = byMonth.get(m) ?? [];
    const sorted = [...series].sort((a, b) => a - b);
    const bands = tercileBands(sorted);
    mean.push(sorted.length ? Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length) : null);
    median.push(sorted.length ? Math.round(quantile(sorted, 0.5)) : null);
    p33.push(bands.p33 == null ? null : Math.round(bands.p33 * 10) / 10);
    p67.push(bands.p67 == null ? null : Math.round(bands.p67 * 10) / 10);
    counts.push(sorted.length);
  }
  return { mean, median, p33, p67, n: counts.length ? Math.min(...counts) : 0 };
}

async function fetchBatch(coords, daily) {
  const qs = new URLSearchParams({
    latitude: coords.map((c) => c.lat.toFixed(4)).join(','),
    longitude: coords.map((c) => c.lon.toFixed(4)).join(','),
    start_date: START,
    end_date: END,
    daily,
    timezone: 'Africa/Nairobi',
  });
  const data = await getJSON(`${ARCHIVE_URL}?${qs}`);
  return Array.isArray(data) ? data : [data];
}

function cellFromResponse(res, cell) {
  const precip = statsFromDaily(res.daily.time, res.daily.precipitation_sum);
  const et0 = statsFromDaily(res.daily.time, res.daily.et0_fao_evapotranspiration);
  const annualRain = precip.mean.reduce((a, b) => a + (b ?? 0), 0);
  const annualEt0 = et0.mean.reduce((a, b) => a + (b ?? 0), 0);
  return {
    key: cell.key,
    lat: round(cell.lat, 4),
    lon: round(cell.lon, 4),
    elevation_m: res.elevation ?? null,
    rain_mm: precip.mean,
    rain_median_mm: precip.median,
    p33_mm: precip.p33,
    p67_mm: precip.p67,
    sample_years: precip.n,
    et0_mm: et0.mean,
    annual_rain_mm: annualRain,
    annual_et0_mm: annualEt0,
    water_balance_pct: annualEt0 ? Math.round((annualRain / annualEt0) * 100) : null,
    tmin_c: null,
    frost_risk: false,
    retrieved_at: new Date().toISOString().slice(0, 10),
  };
}

async function runInPool(items, size, worker) {
  const out = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: size }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return out;
}

const index = JSON.parse(await readFile(INDEX, 'utf8'));
const wards = [];
for (const county of index.counties) {
  for (const w of county.wards) {
    if (w.lat == null || w.lon == null) continue;
    wards.push({
      id: w.id,
      name: w.name,
      county: county.name,
      county_slug: county.slug,
      sub_county: w.sub_county,
      lat: w.lat,
      lon: w.lon,
      cell: cellKey(w.lat, w.lon),
    });
  }
}

const cells = new Map();
for (const w of wards) {
  if (!cells.has(w.cell)) {
    const [lat, lon] = w.cell.split(',').map(Number);
    cells.set(w.cell, { key: w.cell, lat, lon });
  }
}
let cellList = [...cells.values()];
if (LIMIT > 0) cellList = cellList.slice(0, LIMIT);
const wanted = new Set(cellList.map((c) => c.key));

await mkdir(CACHE, { recursive: true });
const cachePath = (key) => join(CACHE, `cell-${key.replace(',', '_')}.json`);

const cached = new Map();
const MAX_CELLS = numArg('--max-cells', 0);
let toFetch = [];
for (const cell of cellList) {
  const p = cachePath(cell.key);
  if (!FORCE && existsSync(p)) {
    try {
      cached.set(cell.key, JSON.parse(await readFile(p, 'utf8')));
      continue;
    } catch { /* refetch corrupt entry */ }
  }
  toFetch.push(cell);
}
// --max-cells keeps a run time-boxed; the cache makes the next run resume where this one stopped.
if (MAX_CELLS > 0) toFetch = toFetch.slice(0, MAX_CELLS);
if (NO_FETCH) toFetch = [];
console.log(`wards ${wards.length} | unique ${GRID}-deg cells ${cells.size} | cached ${cached.size} | to fetch ${toFetch.length}`);

const batches = [];
for (let i = 0; i < toFetch.length; i += BATCH) batches.push(toFetch.slice(i, i + BATCH));

let done = 0;
const failures = [];
await runInPool(batches, CONCURRENCY, async (batch) => {
  try {
    const results = await fetchBatch(batch, 'precipitation_sum,et0_fao_evapotranspiration');
    for (let i = 0; i < batch.length && i < results.length; i++) {
      const cell = cellFromResponse(results[i], batch[i]);
      cached.set(cell.key, cell);
      await writeFile(cachePath(cell.key), JSON.stringify(cell), 'utf8');
    }
  } catch (err) {
    failures.push(`${batch.map((b) => b.key).join(' ')}: ${err.message}`);
  }
  done += batch.length;
  process.stdout.write(`\rfetched cells: ${done}/${toFetch.length}`);
});
console.log('');

// Second, much smaller pass: minimum temperature only where frost is plausible.
const highCells = [...cached.values()].filter((c) => c.elevation_m != null && c.elevation_m >= FROST_ELEVATION_M && c.tmin_c == null);
if (highCells.length) {
  const highBatches = [];
  for (let i = 0; i < highCells.length; i += BATCH) highBatches.push(highCells.slice(i, i + BATCH));
  let tdone = 0;
  await runInPool(highBatches, CONCURRENCY, async (batch) => {
    try {
      const results = await fetchBatch(batch, 'temperature_2m_min');
      for (let i = 0; i < batch.length && i < results.length; i++) {
        const st = statsFromDaily(results[i].daily.time, results[i].daily.temperature_2m_min);
        const cell = cached.get(batch[i].key);
        if (cell) {
          cell.tmin_c = st.mean.map((v) => (v == null ? null : round(v * 10, 0) / 10));
          cell.frost_risk = cell.tmin_c.some((v) => v != null && v <= 5);
          await writeFile(cachePath(cell.key), JSON.stringify(cell), 'utf8');
        }
      }
    } catch (err) {
      failures.push(`tmin ${batch.map((b) => b.key).join(' ')}: ${err.message}`);
    }
    tdone += batch.length;
    process.stdout.write(`\rfrost pass cells: ${tdone}/${highCells.length}`);
  });
  console.log('');
}

const packed = [...cached.values()].filter((c) => wanted.has(c.key));

/**
 * Wards whose own ERA5 cell has not been fetched yet fall back to the nearest cached cell,
 * labelled as such with the distance in km. ERA5 is a 0.25-degree reanalysis, so a neighbour
 * cell is the same model's view of the same climate system; the label keeps the interpolation
 * visible instead of pretending every ward was sampled directly. As `npm run normals` fills the
 * cache, nearest-cell wards are replaced by their own cell automatically.
 */
const haversineKm = (a, b, c, d) => {
  const R = 6371;
  const dLat = ((c - a) * Math.PI) / 180;
  const dLon = ((d - b) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a * Math.PI) / 180) * Math.cos((c * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};
let own = 0;
let nearest = 0;
let maxKm = 0;
for (const w of wards) {
  if (packed.some((c) => c.key === w.cell)) {
    w.cell_source = 'own';
    own++;
    continue;
  }
  let best = null;
  let bestKm = Infinity;
  for (const c of packed) {
    const km = haversineKm(w.lat, w.lon, c.lat, c.lon);
    if (km < bestKm) { bestKm = km; best = c; }
  }
  if (best) {
    w.cell = best.key;
    w.cell_source = 'nearest';
    w.cell_distance_km = Math.round(bestKm);
    nearest++;
    if (bestKm > maxKm) maxKm = bestKm;
  } else {
    w.cell_source = 'none';
  }
}

const pack = {
  _provenance: {
    built_at: new Date().toISOString(),
    baseline: 'ERA5 via Open-Meteo archive API, 2005-01-01 to 2024-12-31, Africa/Nairobi',
    variables: 'daily precipitation_sum, et0_fao_evapotranspiration; temperature_2m_min where elevation >= 1900 m',
    grid: `${GRID} degrees, centroids snapped to the ERA5 grid; wards sharing a cell share normals`,
    statistics: 'rain_mm and et0_mm are monthly means over 20 years; rain_median_mm is the monthly median; p33_mm/p67_mm are tercile band edges; sample_years is the smallest per-month count',
    wards_source: 'geoBoundaries gbOpen KEN ADM3 (CC BY 4.0), see web/boundaries/index.json',
    cost: '$0, no API key',
    script: 'scripts/build-normals.mjs',
    cell_count: packed.length,
    coverage: { wards_total: wards.length, wards_with_normals: wards.filter((w) => w.cell_source !== 'none').length, wards_own_cell: own, wards_nearest_cell: nearest, worst_nearest_km: nearest ? Math.round(maxKm) : 0 },
    failures: failures.length,
  },
  baseline_years: [2005, 2024],
  grid_degrees: GRID,
  cells: Object.fromEntries(packed.map((c) => [c.key, c])),
  wards,
};

const dashboardIndex = {
  generated_at: pack._provenance.built_at,
  baseline_years: pack.baseline_years,
  counties: index.counties.map((c) => ({
    name: c.name,
    slug: c.slug,
    file: c.file,
    ward_count: c.ward_count,
  })),
  wards: wards.map((w) => ({ id: w.id, name: w.name, county: w.county, county_slug: w.county_slug, sub_county: w.sub_county, lat: w.lat, lon: w.lon, cell: w.cell })),
};

await mkdir(dirname(join(root, 'web', 'data', 'wards-index.json')), { recursive: true });
const packJson = JSON.stringify(pack);
const dashJson = JSON.stringify(dashboardIndex);
await writeFile(join(root, 'data', 'wards.json'), packJson, 'utf8');
await writeFile(join(root, 'web', 'data', 'wards-index.json'), dashJson, 'utf8');

const covered = wards.filter((w) => w.cell_source !== 'none').length;
console.log(`cells in pack        : ${packed.length} of ${cells.size} (${Math.round((packed.length / cells.size) * 100)}% of the ERA5 grid over Kenya)`);
console.log(`wards with normals   : ${covered}/${wards.length} (own cell ${own}, nearest cell ${nearest}${nearest ? `, worst ${Math.round(maxKm)} km` : ''})`);
console.log(`data/wards.json      : ${(Buffer.byteLength(packJson) / 1024).toFixed(0)} KB`);
console.log(`web wards-index.json : ${(Buffer.byteLength(dashJson) / 1024).toFixed(0)} KB`);
console.log(`fetch failures       : ${failures.length}${failures.length ? ` (${failures[0]})` : ''}`);
if (failures.length) process.exitCode = 1;
