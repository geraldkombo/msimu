import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  candidateCounties,
  distanceKm,
  geometryContains,
  locatePoint,
  nearestWard,
  nodeGeometryLoader,
  pointSite,
  ringContains,
} from '../src/point.mjs';

const square = { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] };
const withHole = {
  type: 'Polygon',
  coordinates: [
    [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
    [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]],
  ],
};
const multi = {
  type: 'MultiPolygon',
  coordinates: [
    [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
    [[[20, 20], [21, 20], [21, 21], [20, 21], [20, 20]]],
  ],
};

test('ringContains resolves inside, outside and edge cases', () => {
  const ring = square.coordinates[0];
  assert.equal(ringContains(ring, 5, 5), true);
  assert.equal(ringContains(ring, 15, 5), false);
  assert.equal(ringContains(ring, -1, -1), false);
});

test('geometryContains honours holes', () => {
  assert.equal(geometryContains(withHole, 5, 5), false, 'a point inside the hole is outside the polygon');
  assert.equal(geometryContains(withHole, 2, 2), true);
  assert.equal(geometryContains(withHole, 50, 50), false);
});

test('geometryContains handles MultiPolygon and rejects other types', () => {
  assert.equal(geometryContains(multi, 0.5, 0.5), true);
  assert.equal(geometryContains(multi, 20.5, 20.5), true, 'either part matches');
  assert.equal(geometryContains(multi, 10, 10), false, 'the gap between parts is outside');
  assert.equal(geometryContains(null, 0, 0), false);
  assert.equal(geometryContains({ type: 'Point', coordinates: [0, 0] }, 0, 0), false);
});

test('distanceKm is symmetric and roughly correct for a known pair', () => {
  const d = distanceKm(-1.28496, 36.89468, -1.4275, 36.6865);
  assert.ok(d > 25 && d < 40, `Nairobi to Kiserian should be tens of km, got ${d}`);
  assert.ok(Math.abs(distanceKm(0, 0, 0, 1) - 111) < 1, 'one degree of longitude at the equator is about 111 km');
  assert.equal(distanceKm(1, 2, 1, 2), 0);
});

test('candidateCounties puts the right county first for real Kenyan points', () => {
  assert.equal(candidateCounties(-1.28496, 36.89468)[0].slug, 'nairobi');
  assert.equal(candidateCounties(-1.4275, 36.6865)[0].slug, 'kajiado');
  assert.equal(candidateCounties(-4.0547, 39.6636)[0].slug, 'mombasa');
});

test('locatePoint resolves an exact ward for real coordinates', async () => {
  const embakasi = await locatePoint(-1.28496, 36.89468, nodeGeometryLoader);
  assert.equal(embakasi.exact, true);
  assert.equal(embakasi.county, 'Nairobi');
  assert.equal(embakasi.sub_county, 'Embakasi West');
  assert.equal(embakasi.ward, 'Umoja II');
  assert.ok(embakasi.attribution.includes('geoBoundaries'), 'CC BY 4.0 attribution must travel with the answer');

  const kiserian = await locatePoint(-1.4275, 36.6865, nodeGeometryLoader);
  assert.equal(kiserian.exact, true);
  assert.equal(kiserian.county, 'Kajiado');
  assert.equal(kiserian.ward, 'Olkeri');
});

test('locatePoint falls back to the nearest ward and says so when no polygon matches', async () => {
  const offshore = await locatePoint(-0.4, 34.0, nodeGeometryLoader);
  assert.equal(offshore.exact, false);
  assert.ok(offshore.ward, 'a nearest ward is still returned');
  assert.ok(Number.isFinite(offshore.distance_to_nearest_ward_centroid_km), 'the fallback must disclose how far it guessed');
  assert.match(offshore.note, /no ward polygon contained this point/);
});

test('locatePoint survives a loader that cannot fetch geometry', async () => {
  const broken = async () => {
    throw new Error('asset missing');
  };
  const res = await locatePoint(-1.28496, 36.89468, broken);
  assert.equal(res.exact, false);
  assert.ok(res.ward, 'degrades to the centroid fallback instead of throwing');
});

test('locatePoint validates its inputs', async () => {
  await assert.rejects(() => locatePoint(NaN, 36.8, nodeGeometryLoader), /finite numbers/);
  await assert.rejects(() => locatePoint(95, 36.8, nodeGeometryLoader), /-90\.\.90/);
  await assert.rejects(() => locatePoint(-1.2, 200, nodeGeometryLoader), /-180\.\.180/);
});

test('nearestWard returns a plausible ward for a point inside Kenya', () => {
  const n = nearestWard(-1.28496, 36.89468);
  assert.equal(n.county, 'Nairobi');
  assert.ok(n.km < 20, `centroid should be close, got ${n.km} km`);
});

test('pointSite deliberately carries no precomputed normals', () => {
  const s = pointSite({ lat: -1.28496, lon: 36.89468, label: 'Flat', location: { county: 'Nairobi', ward: 'Umoja II', elevation_m: 1625 } });
  assert.equal(s.cell, null, 'a point site must not inherit a distant cell silently');
  assert.equal('annual_rain_mm' in s, false, 'no precomputed normals may ride along');
  assert.ok(s.id.startsWith('point:'));
  assert.equal(s.county, 'Nairobi');
  assert.equal(s.elevation_m, 1625);
});
