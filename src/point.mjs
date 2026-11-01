/**
 * Precise point location: turn a latitude/longitude into a ward, sub-county and county.
 *
 * Why this exists separately from wards.mjs
 * ----------------------------------------
 * wards.mjs resolves a ward by NAME or SLUG. This module resolves a ward by
 * COORDINATE, which is what a phone GPS or a browser geolocation prompt gives
 * you. A farmer standing in a kitchen garden in Embakasi has no idea which ward
 * she is in, and the ward name is not printed on anything she can see.
 *
 * How it stays cheap
 * ------------------
 * The full boundary set is 3.29 MB across 47 county files. Bundling all of that
 * into a Worker would be wasteful and slow, so geometry is loaded lazily:
 *
 *   1. Narrow to candidate counties using ward centroids already in the index.
 *   2. Load only those counties' GeoJSON through an injected loader.
 *   3. Run exact ray-casting point-in-polygon on the candidates.
 *
 * The loader is injected because the two runtimes fetch files differently: Node
 * reads from disk, the Worker fetches its own deployed static asset over HTTP.
 * Nothing else in this module knows which runtime it is in.
 *
 * Boundary data: geoBoundaries gbOpen KEN ADM3, CC BY 4.0. Attribution required.
 */
import indexJson from '../web/boundaries/index.json' with { type: 'json' };

const counties = indexJson.counties;
export const boundaryAttribution = indexJson.attribution ?? 'geoBoundaries gbOpen KEN (CC BY 4.0)';

/** Degrees of slack when narrowing counties by centroid distance. */
const CANDIDATE_RADIUS_DEG = 0.75;
const MAX_CANDIDATE_COUNTIES = 4;

/** Haversine distance in km. */
export function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Ray casting: is (x, y) inside this linear ring? */
export function ringContains(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const crosses = yi > y !== yj > y;
    if (crosses && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Point-in-geometry for Polygon and MultiPolygon.
 * Holes are honoured: inside the outer ring but inside a hole means outside.
 */
export function geometryContains(geometry, lon, lat) {
  if (!geometry) return false;
  const { type, coordinates } = geometry;
  if (type === 'Polygon') {
    const [outer, ...holes] = coordinates;
    if (!ringContains(outer, lon, lat)) return false;
    return !holes.some((h) => ringContains(h, lon, lat));
  }
  if (type === 'MultiPolygon') {
    return coordinates.some((poly) => {
      const [outer, ...holes] = poly;
      return ringContains(outer, lon, lat) && !holes.some((h) => ringContains(h, lon, lat));
    });
  }
  return false;
}

/**
 * Counties whose ward centroids lie near the point, closest first.
 * A centroid test is not a boundary test, so this only ever narrows the search:
 * the exact answer comes from geometryContains. The radius is generous because a
 * point can sit inside a large ward whose centroid is far away.
 */
export function candidateCounties(lat, lon) {
  const scored = [];
  for (const c of counties) {
    let best = Infinity;
    for (const w of c.wards ?? []) {
      const d = distanceKm(lat, lon, w.lat, w.lon);
      if (d < best) best = d;
    }
    scored.push({ slug: c.slug, name: c.name, file: c.file, km: best });
  }
  scored.sort((a, b) => a.km - b.km);
  const degLimit = CANDIDATE_RADIUS_DEG * 111;
  const near = scored.filter((s) => s.km <= degLimit);
  return (near.length ? near : scored).slice(0, MAX_CANDIDATE_COUNTIES);
}

/** Nearest ward by centroid distance, used when no polygon matches. */
export function nearestWard(lat, lon) {
  let best = null;
  for (const c of counties) {
    for (const w of c.wards ?? []) {
      const km = distanceKm(lat, lon, w.lat, w.lon);
      if (!best || km < best.km) {
        best = { km, county: c.name, county_slug: c.slug, sub_county: w.sub_county, ward: w.name, ward_id: w.id };
      }
    }
  }
  return best;
}

/**
 * Resolve a coordinate to an administrative unit.
 *
 * @param {number} lat
 * @param {number} lon
 * @param {(slug:string)=>Promise<object>} loadGeometry  returns a county FeatureCollection
 * @returns {Promise<object>} match, or the nearest ward with `exact: false`
 */
export async function locatePoint(lat, lon, loadGeometry) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error('lat and lon must be finite numbers');
  }
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    throw new Error('lat must be within -90..90 and lon within -180..180');
  }

  const candidates = candidateCounties(lat, lon);
  const loaded = [];
  const errors = [];
  for (const c of candidates) {
    let fc;
    try {
      fc = await loadGeometry(c.slug);
    } catch (err) {
      // Recorded, not swallowed. A loader that cannot reach the boundary assets
      // makes every lookup fall through to the centroid guess, which still
      // returns a plausible ward name. Without this trail that failure is
      // invisible: the answer looks exact and is not.
      errors.push({ county: c.slug, error: String(err?.message ?? err) });
      continue;
    }
    loaded.push(c.slug);
    for (const f of fc?.features ?? []) {
      if (geometryContains(f.geometry, lon, lat)) {
        const p = f.properties ?? {};
        return {
          exact: true,
          latitude: lat,
          longitude: lon,
          ward: p.ward ?? null,
          ward_id: p.id ?? null,
          sub_county: p.sub_county ?? null,
          county: p.county ?? c.name,
          county_slug: c.slug,
          boundary_file: c.file,
          candidates_checked: candidates.map((x) => x.slug),
          geometry_loaded: loaded,
          geometry_errors: errors,
          attribution: boundaryAttribution,
        };
      }
    }
  }

  const near = nearestWard(lat, lon);
  return {
    exact: false,
    latitude: lat,
    longitude: lon,
    ward: near?.ward ?? null,
    ward_id: near?.ward_id ?? null,
    sub_county: near?.sub_county ?? null,
    county: near?.county ?? null,
    county_slug: near?.county_slug ?? null,
    boundary_file: null,
    candidates_checked: candidates.map((x) => x.slug),
    geometry_loaded: loaded,
    geometry_errors: errors,
    distance_to_nearest_ward_centroid_km: near ? Math.round(near.km * 10) / 10 : null,
    note: errors.length
      ? `boundary geometry could not be loaded for ${errors.length} candidate county/counties, so this is the nearest ward centroid, not a boundary match`
      : 'no ward polygon contained this point; showing the nearest ward centroid instead',
    attribution: boundaryAttribution,
  };
}

/** Node loader: read the county GeoJSON from disk. */
export async function nodeGeometryLoader(slug) {
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const { dirname, resolve } = await import('node:path');
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const text = await readFile(resolve(root, 'web', 'boundaries', `${slug}-wards.geojson`), 'utf8');
  return JSON.parse(text);
}

/**
 * Worker loader.
 *
 * A plain fetch() to this Worker's own origin does NOT reliably reach its static
 * assets from inside the Worker. The asset binding does. Prefer `env.ASSETS`,
 * and fall back to a same-origin fetch only where no binding exists (local dev).
 * Getting this wrong does not throw at the caller: it degrades every lookup to
 * the nearest-centroid guess, which still returns a plausible ward name.
 */
export function workerGeometryLoader(origin, assets) {
  return async (slug) => {
    const path = `/boundaries/${slug}-wards.geojson`;
    const res = assets?.fetch
      ? await assets.fetch(new Request(`https://assets.local${path}`))
      : await fetch(`${origin}${path}`);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
    const fc = await res.json();
    if (!fc?.features?.length) throw new Error(`no features in ${path}`);
    return fc;
  };
}

/**
 * Build a site object for an arbitrary point, compatible with climate.mjs.
 *
 * This matters because the precomputed normals pack is incomplete: 902 of 1452
 * wards currently borrow a neighbouring ERA5 cell, and the worst borrower is
 * 299 km from the cell describing it. A real coordinate deserves real data, so a
 * point site is flagged as having no precomputed baseline and the caller fetches
 * the archive at that exact point instead of trusting a distant cell.
 */
export function pointSite({ lat, lon, label, location, cell }) {
  return {
    id: `point:${lat.toFixed(4)},${lon.toFixed(4)}`,
    name: label ?? location?.ward ?? `${lat}, ${lon}`,
    latitude: lat,
    longitude: lon,
    county: location?.county ?? null,
    ward: location?.ward ?? null,
    sub_county: location?.sub_county ?? null,
    elevation_m: location?.elevation_m ?? null,
    // Deliberately absent: precomputed normals. See the comment above.
    cell: cell ?? null,
    cell_source: cell?.cell_source ?? null,
    cell_distance_km: cell?.cell_distance_km ?? null,
  };
}
