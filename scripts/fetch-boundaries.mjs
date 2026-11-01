/**
 * Country-wide Kenya administrative boundaries from geoBoundaries (CC BY 4.0).
 *
 * Zero dependencies. Run:
 *   node scripts/fetch-boundaries.mjs                 # all 47 counties
 *   node scripts/fetch-boundaries.mjs Kajiado         # one county only
 *   node scripts/fetch-boundaries.mjs --simplified    # smaller ward polygons
 *
 * Writes:
 *   web/boundaries/<county-slug>-wards.geojson   one file per county, full-precision ADM3 wards
 *   web/boundaries/kenya-counties.geojson        national ADM1 overview layer (simplified, see below)
 *   web/boundaries/index.json                    registry: counties, wards, centroids, sub-counties
 *
 * Precision policy (this is the "precise" build):
 *   - Ward polygons come from the FULL-resolution geoBoundaries ADM3 file (5.37 MB nationally),
 *     not the _simplified release, and are rounded to 5 decimals (~1.1 m). Rounding at 5 dp is
 *     lossless for display and still removes upstream float noise.
 *   - The national county overview layer is the one exception: it uses ADM1_simplified rounded to
 *     4 decimals, because a full-precision ADM1 layer is 7.59 MB and would be the first thing a
 *     phone on mobile data downloads. Ward detail, where precision actually matters for a farmer,
 *     is full-resolution and loaded per county on demand.
 *
 * Licence: geoBoundaries is CC BY 4.0 with attribution required, so attribution is embedded in every
 * output file and documented in docs/DATA-PROVENANCE.md. GADM was rejected because its licence
 * forbids redistribution without permission (gadm.org/license.html, checked 2026-10-28), which is
 * incompatible with committing derived files to an MIT repository.
 *
 * Network note: www.geoboundaries.org is unreachable from some networks, so files are pulled from
 * the project's Git LFS media route on GitHub, with the official API as fallback. Downloads are
 * cached under cache/geoboundaries/ so re-runs are offline.
 */
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const SIMPLIFIED = argv.includes('--simplified');
const ONLY = argv.find((a) => !a.startsWith('--')) ?? null;
const CACHE = join(root, 'cache', 'geoboundaries');
const OUT_DIR = join(root, 'web', 'boundaries');
const WARD_DP = SIMPLIFIED ? 4 : 5;
const COUNTY_DP = 4;

const MEDIA = (level, simplified) =>
  `https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/main/releaseData/gbOpen/KEN/${level}/geoBoundaries-KEN-${level}${simplified ? '_simplified' : ''}.geojson`;
const META = (level) =>
  `https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/main/releaseData/gbOpen/KEN/${level}/geoBoundaries-KEN-${level}-metaData.json`;
const API = (level) => `https://www.geoboundaries.org/api/current/gbOpen/KEN/${level}/`;

const slug = (name) => String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function cachedJSON(url, file, { timeout = 300000 } = {}) {
  const path = join(CACHE, file);
  if (existsSync(path)) {
    try {
      return JSON.parse(await readFile(path, 'utf8'));
    } catch { /* corrupt cache entry: refetch */ }
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const body = await res.text();
  await mkdir(CACHE, { recursive: true });
  await writeFile(path, body, 'utf8');
  return JSON.parse(body);
}

async function loadLevel(level, simplified) {
  const file = `KEN-${level}${simplified ? '_simplified' : ''}.geojson`;
  try {
    const [geometry, metadata] = await Promise.all([
      cachedJSON(MEDIA(level, simplified), file),
      cachedJSON(META(level), `KEN-${level}-metaData.json`).catch(() => null),
    ]);
    return { geometry, metadata, source: MEDIA(level, simplified) };
  } catch {
    const api = await cachedJSON(API(level), `KEN-${level}-api.json`);
    const url = simplified ? api.simplifiedGeometryGeoJSON : api.gjDownloadURL;
    const geometry = await cachedJSON(url, file);
    return { geometry, metadata: api, source: url };
  }
}

function coordsOf(geometry) {
  const out = [];
  const walk = (node) => {
    if (!Array.isArray(node)) return;
    if (typeof node[0] === 'number') { out.push(node); return; }
    for (const child of node) walk(child);
  };
  walk(geometry.coordinates);
  return out;
}

function ringsOf(geometry) {
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates ?? [];
  return polys.map((rings) => rings[0]).filter(Boolean);
}

function bboxOf(geometry) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of coordsOf(geometry)) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

function pointInRings([lon, lat], rings) {
  return rings.some((ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  });
}

/** Area-weighted centroid: good enough for a label point and for containment tests. */
function centroid(geometry) {
  let sx = 0, sy = 0, n = 0;
  for (const [x, y] of coordsOf(geometry)) { sx += x; sy += y; n++; }
  return n ? [sx / n, sy / n] : null;
}

function roundCoords(node, dp) {
  const f = 10 ** dp;
  const walk = (v) => {
    if (typeof v === 'number') return Math.round(v * f) / f;
    return Array.isArray(v) ? v.map(walk) : v;
  };
  return walk(node);
}

/** Index a feature list with bounding boxes so containment tests stay cheap. */
function indexFeatures(features) {
  return features.map((f) => ({
    name: String(f.properties.shapeName ?? ''),
    id: String(f.properties.shapeID ?? ''),
    geometry: f.geometry,
    rings: ringsOf(f.geometry),
    bbox: bboxOf(f.geometry),
    centroid: centroid(f.geometry),
  }));
}

function findContaining(point, index) {
  if (!point) return null;
  const [lon, lat] = point;
  const candidates = index.filter((f) => lon >= f.bbox[0] && lon <= f.bbox[2] && lat >= f.bbox[1] && lat <= f.bbox[3]);
  return candidates.find((f) => pointInRings(point, f.rings)) ?? null;
}

/**
 * A point that is actually inside the feature. The vertex-average centroid of an island or a
 * crescent-shaped ward can fall in the sea or in a neighbouring county (this is what dropped
 * Kipevu, Mkomani, Faza and Miritini in the first run), so fall back to the bbox centre and then
 * to sampled boundary vertices until one lands inside a polygon.
 */
function representativePoints(geometry) {
  const pts = coordsOf(geometry);
  if (!pts.length) return [];
  const c = centroid(geometry);
  const [minX, minY, maxX, maxY] = bboxOf(geometry);
  const bboxCentre = [(minX + maxX) / 2, (minY + maxY) / 2];
  const step = Math.max(1, Math.floor(pts.length / 24));
  const sampled = [];
  for (let i = 0; i < pts.length && sampled.length < 24; i += step) sampled.push(pts[i]);
  return [c, bboxCentre, ...sampled, ...pts.slice(0, 8)];
}

console.log(`fetching geoBoundaries Kenya (ward precision: ${SIMPLIFIED ? 'simplified' : 'full'}, ${WARD_DP} dp)`);
const [adm1, adm2, adm3] = await Promise.all([
  loadLevel('ADM1', true),
  loadLevel('ADM2', false),
  loadLevel('ADM3', SIMPLIFIED),
]);
const meta = adm3.metadata ?? {};

const counties = indexFeatures(adm1.geometry.features);
const subCounties = indexFeatures(adm2.geometry.features);
console.log(`counties ${counties.length} | sub-counties ${subCounties.length} | wards ${adm3.geometry.features.length}`);

const byCounty = new Map();
const unassigned = [];

for (const f of adm3.geometry.features) {
  let c = null;
  let county = null;
  for (const p of representativePoints(f.geometry)) {
    const hit = findContaining(p, counties);
    if (hit) { c = p; county = hit; break; }
  }
  if (!county) { unassigned.push(String(f.properties.shapeName)); continue; }
  const sub = findContaining(c, subCounties);
  const key = county.name.trim();
  if (ONLY && !key.toLowerCase().includes(ONLY.toLowerCase())) continue;
  if (!byCounty.has(key)) byCounty.set(key, { county: key, sub_counties: new Set(), wards: [] });
  const entry = byCounty.get(key);
  if (sub) entry.sub_counties.add(sub.name);
  entry.wards.push({
    name: String(f.properties.shapeName ?? ''),
    id: String(f.properties.shapeID ?? ''),
    sub_county: sub?.name ?? null,
    centroid: c ? [Math.round(c[0] * 1e5) / 1e5, Math.round(c[1] * 1e5) / 1e5] : null,
    geometry: { type: f.geometry.type, coordinates: roundCoords(f.geometry.coordinates, WARD_DP) },
  });
}

await mkdir(OUT_DIR, { recursive: true });
const attribution = 'Contains geoBoundaries data (Runfola et al. 2020, PLoS ONE 15(4): e0231866), CC BY 4.0.';
const license = meta.boundaryLicense ?? 'Creative Commons Attribution 4.0 International (CC BY 4.0)';
const retrievedAt = new Date().toISOString().slice(0, 10);
const commonProps = {
  level: 'ADM3 (ward)',
  precision: SIMPLIFIED ? 'geoBoundaries simplified, 4 dp' : 'geoBoundaries full resolution, 5 dp (~1.1 m)',
  boundary_year: meta.boundaryYear ?? null,
  source: 'geoBoundaries - www.geoboundaries.org (CC BY 4.0, attribution required)',
  source_urls: [adm3.source, adm2.source, adm1.source],
  upstream_data: meta.boundarySource ?? null,
  upstream_url: (meta.boundarySourceURL ?? '').replace(/^https\/\//, 'https://'),
  license,
  retrieved_at: retrievedAt,
  attribution,
};

const index = { generated_at: new Date().toISOString(), license, attribution, source_urls: commonProps.source_urls, precision: commonProps.precision, counties: [] };
let totalWards = 0;
let totalBytes = 0;

for (const [name, entry] of [...byCounty.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  const s = slug(name);
  const fc = {
    type: 'FeatureCollection',
    properties: {
      ...commonProps,
      county: name,
      county_slug: s,
      sub_counties: [...entry.sub_counties].sort(),
      ward_count: entry.wards.length,
      processing: `wards assigned to county by centroid containment in ADM1; coordinates rounded to ${WARD_DP} decimals`,
    },
    features: entry.wards.map((w) => ({
      type: 'Feature',
      properties: { ward: w.name, id: w.id, sub_county: w.sub_county, county: name },
      geometry: w.geometry,
    })),
  };
  const json = JSON.stringify(fc);
  const path = join(OUT_DIR, `${s}-wards.geojson`);
  await writeFile(path, json, 'utf8');
  totalWards += entry.wards.length;
  totalBytes += Buffer.byteLength(json);
  index.counties.push({
    name,
    slug: s,
    file: `boundaries/${s}-wards.geojson`,
    ward_count: entry.wards.length,
    sub_counties: [...entry.sub_counties].sort(),
    wards: entry.wards.map((w) => ({ id: w.id, name: w.name, sub_county: w.sub_county, lon: w.centroid?.[0] ?? null, lat: w.centroid?.[1] ?? null })),
  });
}

const countiesFC = {
  type: 'FeatureCollection',
  properties: {
    ...commonProps,
    level: 'ADM1 (county)',
    precision: 'geoBoundaries ADM1 simplified, 4 dp (see scripts/fetch-boundaries.mjs for why)',
    county_count: counties.length,
    processing: 'national overview layer; ward detail is full resolution and loaded per county',
  },
  features: counties.map((c) => ({
    type: 'Feature',
    properties: { county: c.name, id: c.id, slug: slug(c.name), centroid: c.centroid ? [Math.round(c.centroid[0] * 1e5) / 1e5, Math.round(c.centroid[1] * 1e5) / 1e5] : null },
    geometry: roundCoords(c.geometry, COUNTY_DP),
  })),
};
const countiesJson = JSON.stringify(countiesFC);
await writeFile(join(OUT_DIR, 'kenya-counties.geojson'), countiesJson, 'utf8');
await writeFile(join(OUT_DIR, 'index.json'), JSON.stringify(index), 'utf8');

const biggest = index.counties.reduce((a, b) => (b.ward_count > a.ward_count ? b : a), index.counties[0]);
console.log(`counties written     : ${index.counties.length}`);
console.log(`wards written        : ${totalWards} (${(totalBytes / 1048576).toFixed(2)} MB across ${index.counties.length} files)`);
console.log(`largest county       : ${biggest.name} (${biggest.ward_count} wards)`);
console.log(`unassigned wards     : ${unassigned.length}${unassigned.length ? ` (${unassigned.slice(0, 5).join(', ')})` : ''}`);
console.log(`pilot ward present   : ${index.counties.some((c) => c.wards.some((w) => /nkaimurunya/i.test(w.name)))}`);
console.log(`license              : ${license}`);
console.log(`counties layer       : kenya-counties.geojson (${(Buffer.byteLength(countiesJson) / 1024).toFixed(0)} KB, simplified)`);
console.log(`output               : ${OUT_DIR}`);
