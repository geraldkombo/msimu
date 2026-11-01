import test from 'node:test';
import assert from 'node:assert/strict';
import {
  counties,
  wardsForCounty,
  resolveWard,
  wardSite,
  cellFor,
  agroEcology,
  coverage,
  baselineYears,
  gridDegrees,
} from '../src/wards.mjs';
import { baselineFromCell, normalsFromCell, hasPrecomputedBaseline, outlookFromRaw } from '../src/climate.mjs';
import { buildAdvisory } from '../src/advisory.mjs';
import { crops } from '../src/packs.mjs';

const ZONES = new Set(['highland', 'humid', 'sub_humid', 'semi_arid', 'arid']);

test('every county and ward in Kenya resolves from the pack', () => {
  const list = counties();
  assert.equal(list.length, 47, 'Kenya has 47 counties');
  assert.equal(list.reduce((n, c) => n + c.ward_count, 0), 1452, 'all wards must be reachable');
  for (const c of list) {
    const wards = wardsForCounty(c.slug);
    assert.equal(wards.length, c.ward_count, `${c.name}: county listing disagrees with its wards`);
    assert.ok(wards.every((w) => w.slug && w.id && w.sub_county), `${c.name}: wards need slug, id and sub-county`);
  }
  assert.deepEqual(baselineYears, [2005, 2024]);
  assert.equal(gridDegrees, 0.25);
});

test('a ward can be addressed by slug, id, county/name or unique name', () => {
  const bySlug = resolveWard('kajiado--nkaimurunya');
  assert.ok(bySlug, 'the pilot ward must resolve by slug');
  assert.equal(resolveWard(bySlug.id).slug, bySlug.slug, 'id lookup must match slug lookup');
  assert.equal(resolveWard('Kajiado / Nkaimurunya').id, bySlug.id, 'county/name lookup must be normalised');
  assert.equal(resolveWard('nkaimurunya').id, bySlug.id, 'a unique bare name must resolve');
  assert.equal(resolveWard('definitely-not-a-ward'), null, 'unknown wards resolve to null, not a guess');
  assert.throws(() => wardSite('definitely-not-a-ward'), /unknown ward/);
});

test('a ward site is shaped like the curated pilot site', () => {
  const site = wardSite('turkana--kalokol');
  for (const key of ['name', 'county', 'sub_county', 'latitude', 'longitude', 'elevation_m', 'agro_ecology']) {
    assert.ok(site[key] != null && site[key] !== '', `ward site is missing ${key}`);
  }
  assert.equal(site.normals_2005_2024.rain_mm.length, 12);
  assert.equal(site.normals_2005_2024.et0_mm.length, 12);
  assert.ok(site.annual.rain_mm > 0 && site.annual.et0_mm > 0);
  assert.ok(site.annual.water_balance_pct > 0, 'water balance drives the maize warning, it must exist');
  assert.ok(ZONES.has(site.agro_ecology), `unexpected zone ${site.agro_ecology}`);
  assert.equal(site.cell.grid_degrees, gridDegrees);
  assert.ok(['own', 'nearest'].includes(site.cell.source), 'the pack must say where the normals came from');
  assert.ok(site.p33_mm.length === 12 && site.p67_mm.length === 12, 'tercile bands must ship with the site');
  assert.equal(site.sample_years, 20);
  assert.ok(hasPrecomputedBaseline(site), 'a ward site must be recognised as precomputed');
});

test('agro-ecology follows rain, elevation and frost, not the county name', () => {
  assert.equal(agroEcology({ annual_rain_mm: 300, elevation_m: 500, frost_risk: false }), 'arid');
  assert.equal(agroEcology({ annual_rain_mm: 700, elevation_m: 900, frost_risk: false }), 'semi_arid');
  assert.equal(agroEcology({ annual_rain_mm: 1000, elevation_m: 1500, frost_risk: false }), 'sub_humid');
  assert.equal(agroEcology({ annual_rain_mm: 1500, elevation_m: 1200, frost_risk: false }), 'humid');
  assert.equal(agroEcology({ annual_rain_mm: 1500, elevation_m: 2600, frost_risk: false }), 'highland');
  assert.equal(agroEcology({ annual_rain_mm: 900, elevation_m: 3000, frost_risk: true }), 'highland');
  const real = Object.values(counties()).length;
  assert.ok(real > 0);
});

test('the precomputed baseline classifies a full month and refuses a partial one', () => {
  const site = wardSite('kajiado--nkaimurunya');
  const marchP67 = site.p33_mm[2] != null ? site.p67_mm[2] : null;
  assert.ok(marchP67 != null, 'March tercile bands must exist for the pilot ward');

  const times = [];
  const precip = [];
  const heavy = (marchP67 + 60) / 31;
  for (let d = 1; d <= 31; d++) {
    times.push(`2027-03-${String(d).padStart(2, '0')}`);
    precip.push(heavy);
  }
  for (let d = 1; d <= 5; d++) {
    times.push(`2027-04-${String(d).padStart(2, '0')}`);
    precip.push(4);
  }

  const months = outlookFromRaw({
    forecast: { times, precip },
    baseline: baselineFromCell(site),
    normals: normalsFromCell(site),
  });
  const march = months.find((m) => m.month === '2027-03');
  const april = months.find((m) => m.month === '2027-04');

  assert.equal(march.complete, true);
  assert.equal(march.tercile, 'above', 'rain above the p67 band must classify as above normal');
  assert.equal(march.tercile_reason, 'classified');
  assert.equal(march.confidence, 'high', 'twenty baseline years must earn high confidence');
  assert.ok(march.median_mm > 0, 'the median must come from the pack, not a fresh archive call');
  assert.ok(march.anomaly_pct > 0);

  assert.equal(april.complete, false);
  assert.equal(april.tercile, 'unknown');
  assert.equal(april.tercile_reason, 'partial_month');
  assert.equal(april.confidence, 'none');
});

test('a ward advisory renders in both locales from pack data alone', () => {
  const site = wardSite('kajiado--nkaimurunya');
  for (const locale of ['sw', 'en']) {
    const advisory = buildAdvisory({
      site,
      tercile: 'below',
      confidence: 'high',
      month: 11,
      locale,
      irrigation: false,
      crops,
    });
    assert.ok(advisory.lines.length >= 4, `${locale}: advisory is too thin`);
    assert.match(advisory.text, new RegExp(site.name), `${locale}: advisory must name the ward`);
    assert.match(advisory.text, /SEAS5/, `${locale}: advisory must name its forecast source`);
    assert.match(advisory.text, /ERA5/, `${locale}: advisory must name its baseline`);
    assert.ok(advisory.structured.recommended.length + advisory.structured.avoid.length > 0, `${locale}: no crop decision`);
  }
});

test('coverage accounting is honest about borrowed cells', () => {
  const cov = coverage();
  assert.equal(cov.wards, 1452);
  assert.equal(cov.own + cov.nearest + cov.none, cov.wards, 'every ward must be accounted for');
  assert.equal(cov.none, 0, 'no ward may be left without normals');
  assert.ok(cov.cells >= 50, `only ${cov.cells} ERA5 cells built`);
  assert.ok(cov.own > 0, 'at least some wards must sit on their own cell');
  const borrowed = wardsForCounty('kajiado').filter((w) => w.cell_source === 'nearest');
  for (const w of borrowed) {
    assert.ok(w.cell_distance_km > 0, `${w.name} borrows a cell but does not say how far`);
    assert.ok(cellFor(resolveWard(w.slug)), `${w.name} points at a cell that is not in the pack`);
  }
});
