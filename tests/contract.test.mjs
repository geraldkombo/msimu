import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { outlookFromRaw } from '../src/climate.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');
const html = read('web/index.html');

function engineMonthKeys() {
  const times = [];
  const precip = [];
  for (const d of [28, 29, 30, 31]) { times.push(`2026-10-${d}`); precip.push(2); }
  for (let d = 1; d <= 30; d++) { times.push(`2026-11-${String(d).padStart(2, '0')}`); precip.push(3.2); }

  const rows = outlookFromRaw({
    forecast: { times, precip },
    baseline: new Map([
      [10, { p33: 40, p67: 75, n: 20 }],
      [11, { p33: 80, p67: 120, n: 20 }],
    ]),
    normals: new Map([
      [10, { mean: 57, median: 33, n: 20 }],
      [11, { mean: 99, median: 86, n: 20 }],
    ]),
  });

  return new Set(rows.flatMap((r) => Object.keys(r)));
}

function siteKeys() {
  const site = JSON.parse(read('data/sites.json')).gataka;
  const keys = new Set();
  const walk = (o) => {
    for (const k of Object.keys(o)) {
      keys.add(k);
      const v = o[k];
      if (v && typeof v === 'object' && !Array.isArray(v)) walk(v);
    }
  };
  walk(site);
  return keys;
}

const fieldsRead = (source, receiver) =>
  new Set([...source.matchAll(new RegExp(`\\b${receiver}\\.([A-Za-z_][A-Za-z0-9_]*)`, 'g'))].map((m) => m[1]));

test('REGRESSION: the dashboard only reads month fields the engine actually emits', () => {
  const produced = engineMonthKeys();
  const used = fieldsRead(html, 'm');
  const drift = [...used].filter((k) => !produced.has(k));
  assert.deepEqual(
    drift,
    [],
    `web/index.html reads fields the engine does not produce: ${drift.join(', ')} (produced: ${[...produced].join(', ')})`,
  );
});

test('REGRESSION: the dashboard only reads site fields present in the site pack', () => {
  const produced = siteKeys();
  const used = fieldsRead(html, 'site');
  const drift = [...used].filter((k) => !produced.has(k));
  assert.deepEqual(drift, [], `web/index.html reads unknown site fields: ${drift.join(', ')}`);
});

test('the map gets real coordinates, not a name string', () => {
  assert.ok(/f\.site\s*&&\s*typeof f\.site === 'object'/.test(html), 'dashboard must accept a site object');
  const worker = read('worker/index.mjs');
  assert.match(worker, /^\s+site,\s*$/m, '/forecast must return the whole site object, not site.name');
  assert.ok(!/site:\s*site\.name,\s*elevation_m/.test(worker), '/forecast must not collapse the site to its name');
});

test('the dashboard renders terciles for every month the engine returns', () => {
  const produced = engineMonthKeys();
  for (const required of ['month', 'forecast_mm', 'median_mm', 'tercile', 'confidence', 'complete', 'days_covered', 'days_expected']) {
    assert.ok(produced.has(required), `engine must emit ${required}`);
    assert.ok(html.includes(required), `dashboard must display ${required}`);
  }
});

test('wrangler assets point at a dashboard that exists', () => {
  const toml = read('worker/wrangler.toml');
  const m = toml.match(/directory\s*=\s*"([^"]+)"/);
  assert.ok(m, 'worker/wrangler.toml must configure an assets directory');
  const dir = resolve(root, 'worker', m[1]);
  assert.ok(existsSync(join(dir, 'index.html')), `assets directory ${dir} has no index.html`);
});

test('the dashboard is dependency-free and needs no build step', () => {
  assert.ok(!html.includes('<script src="./'), 'no local bundle expected');
  assert.ok(html.includes('leaflet'), 'map library is Leaflet from a CDN');
  const pkg = JSON.parse(read('package.json'));
  assert.deepEqual({ ...pkg.dependencies, ...pkg.devDependencies }, {}, 'msimu must stay dependency-free');
  assert.ok(!existsSync(join(root, 'package-lock.json')), 'no lockfile: nothing to install');
});

test('the dashboard states the forecast caveat instead of hiding it', () => {
  for (const locale of ['sw', 'en']) {
    const block = html.slice(html.indexOf(`${locale}: {`), html.indexOf(`${locale}: {`) + 4000);
    assert.ok(block.includes('bias-corrected'), `${locale} must disclose that SEAS5 is not bias-corrected`);
  }
  assert.ok(html.includes('afisa kilimo wa kata'), 'sw must refer the farmer to the ward extension officer');
});

const boundariesDir = join(root, 'web', 'boundaries');
const boundariesIndex = existsSync(join(boundariesDir, 'index.json'))
  ? JSON.parse(readFileSync(join(boundariesDir, 'index.json'), 'utf8'))
  : null;
const wardsPath = join(boundariesDir, 'kajiado-wards.geojson');
const wards = existsSync(wardsPath) ? JSON.parse(readFileSync(wardsPath, 'utf8')) : null;
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

test('the country-wide boundary set covers all 47 counties and every ward', () => {
  assert.ok(boundariesIndex, 'web/boundaries/index.json must exist (run: node scripts/fetch-boundaries.mjs)');
  assert.equal(boundariesIndex.counties.length, 47, 'Kenya has 47 counties');
  const total = boundariesIndex.counties.reduce((n, c) => n + c.wards.length, 0);
  assert.equal(total, 1452, `expected every Kenyan ward, got ${total}`);
  for (const c of boundariesIndex.counties) {
    assert.ok(c.slug && c.file && c.name, `county entry is incomplete: ${JSON.stringify(c).slice(0, 80)}`);
    assert.ok(existsSync(join(root, 'web', c.file)), `missing boundary file for ${c.name}: web/${c.file}`);
    assert.ok(c.wards.every((w) => w.id && w.name && w.sub_county && w.lat != null && w.lon != null), `${c.name} wards need id, name, sub_county and a point`);
  }
  assert.ok(boundariesIndex.counties.some((c) => c.slug === 'kajiado'), 'the pilot county must be present');
});

test('each county boundary file is real, attributed and phone-sized', () => {
  assert.ok(wards, 'web/boundaries/kajiado-wards.geojson must exist');
  assert.equal(wards.type, 'FeatureCollection');
  assert.ok(wards.features.length >= 20, `expected Kajiado's wards, got ${wards.features.length}`);
  assert.match(String(wards.properties.license), /CC BY 4\.0/i, 'boundaries must carry their licence');
  assert.match(String(wards.properties.attribution), /geoBoundaries/i, 'CC BY 4.0 requires attribution');
  assert.ok(wards.properties.source_urls?.length >= 1, 'the exact upstream files must be recorded');
  assert.ok(wards.properties.retrieved_at, 'the retrieval date must be recorded');

  let heaviest = { kb: 0, name: '' };
  for (const c of boundariesIndex.counties) {
    const p = join(root, 'web', c.file);
    const fc = JSON.parse(readFileSync(p, 'utf8'));
    const kb = readFileSync(p).byteLength / 1024;
    assert.equal(fc.features.length, c.wards.length, `${c.name}: file and index disagree on ward count`);
    assert.match(String(fc.properties.license), /CC BY 4\.0/i, `${c.name} must carry the licence`);
    assert.ok(kb < 400, `${c.name} boundary file is ${kb.toFixed(0)} KB - too heavy for a phone on mobile data`);
    for (const f of fc.features) {
      assert.ok(f.properties?.ward && f.properties?.id, `${c.name}: every feature must name and identify its ward`);
      assert.ok(f.geometry?.coordinates?.length, `${c.name}: every feature must carry geometry`);
    }
    if (kb > heaviest.kb) heaviest = { kb, name: c.name };
  }
  assert.ok(heaviest.kb > 0, 'no boundary files were measured');
});

test('the pilot ward exists in the country-wide boundary set', () => {
  const site = JSON.parse(read('data/sites.json')).gataka;
  assert.ok(site.ward, 'the site pack must name its ward');
  assert.ok(
    wards.features.some((f) => norm(f.properties.ward) === norm(site.ward)),
    `site ward "${site.ward}" is not in the Kajiado boundary file`,
  );
  assert.equal(norm(wards.properties.county), 'kajiado', 'the county file must be labelled with its county');
});

test('the ward data pack gives every ward a climate cell and 20-year normals', () => {
  const pack = JSON.parse(read('data/wards.json'));
  assert.equal(pack.wards.length, 1452, 'every ward must be in the pack');
  assert.deepEqual(pack.baseline_years, [2005, 2024]);
  assert.equal(pack.grid_degrees, 0.25);
  assert.ok(Object.keys(pack.cells).length >= 50, 'the ERA5 cell set must cover the country');
  for (const w of pack.wards) {
    assert.ok(['own', 'nearest'].includes(w.cell_source), `ward ${w.name} has no cell assignment`);
    const cell = pack.cells[w.cell];
    assert.ok(cell, `ward ${w.name} points at a missing cell ${w.cell}`);
    assert.equal(cell.rain_mm.length, 12);
    assert.equal(cell.p33_mm.length, 12);
    assert.equal(cell.p67_mm.length, 12);
    assert.equal(cell.sample_years, 20, 'normals must use all twenty baseline years');
    assert.ok(cell.annual_rain_mm > 0 && cell.annual_et0_mm > 0, `${w.cell} has no annual water balance`);
    if (w.cell_source === 'nearest') assert.ok(w.cell_distance_km >= 0, 'nearest-cell wards must record the distance');
  }
  const zones = new Set(Object.values(pack.cells).map((c) => (c.frost_risk || c.elevation_m >= 2400 ? 'highland' : c.annual_rain_mm >= 1200 ? 'humid' : c.annual_rain_mm >= 900 ? 'sub_humid' : c.annual_rain_mm >= 600 ? 'semi_arid' : 'arid')));
  assert.ok(zones.size >= 3, `the country must span several agro-ecological zones, got ${[...zones].join(', ')}`);
});

test('the choropleth is driven by county selection, not one hardcoded pilot file', () => {
  assert.ok(html.includes("fetch('/counties')"), 'dashboard must load the county list from the API');
  assert.match(html, /\/county-outlook\?county=/, 'dashboard must fetch the county choropleth feed');
  assert.match(html, /\/wards\?county=/, 'dashboard must fetch the ward list per county');
  assert.ok(html.includes('boundaries/'), 'dashboard must load per-county boundary files lazily');
  assert.ok(!html.includes('kajiado-wards.geojson'), 'no county may be hardcoded into the dashboard');
  assert.match(html, /TER_COLOR\[/, 'ward colour must come from the tercile');
  assert.ok(html.includes('id="county"') && html.includes('id="ward"'), 'county and ward pickers must be in the DOM');
  assert.ok(html.includes('id="legend"') && html.includes('id="ward-attrib"'), 'legend and attribution must be in the DOM');
  for (const locale of ['sw', 'en']) {
    const block = html.slice(html.indexOf(`${locale}: {`), html.indexOf(`${locale}: {`) + 4000);
    assert.match(block, /mapLegend/, `${locale} must translate the legend`);
    assert.match(block, /noWard/, `${locale} must label wards that have no data yet`);
    assert.match(block, /geoBoundaries/, `${locale} must attribute the boundaries`);
    assert.match(block, /nearestCell/, `${locale} must disclose when a ward borrows a neighbouring ERA5 cell`);
  }
});

test('the local server serves GeoJSON with the right content type', () => {
  assert.match(read('scripts/serve-local.mjs'), /\.geojson['"]?\s*:\s*['"]application\/geo\+json/);
});

test('verification claims never overstate what was measured', () => {
  const readme = read('README.md');
  const provenance = read('docs/DATA-PROVENANCE.md');
  assert.match(readme, /leave-one-out/i, 'README must describe the verification method');
  assert.match(readme, /NOT a measure of ECMWF SEAS5 forecast skill/i, 'README must deny forecast-skill claims');
  assert.match(provenance, /geoBoundaries/i, 'provenance must record the boundary source');
  assert.match(provenance, /GADM/i, 'provenance must record why GADM was rejected');
  assert.match(read('src/verification.mjs'), /NOT_SKILL_CAVEAT/);
});
