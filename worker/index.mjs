import { computeOutlook, fetchSeasonalMulti, outlookFromRaw, baselineFromCell, normalsFromCell } from '../src/climate.mjs';
import { buildAdvisory } from '../src/advisory.mjs';
import { supportedLocales } from '../src/i18n.mjs';
import { ussdResponse } from '../src/ussd.mjs';
import { crops, getSite, siteIds } from '../src/packs.mjs';
import { counties as allCounties, wardsForCounty, resolveWard, wardSite, cellFor, coverage as wardCoverage } from '../src/wards.mjs';
import { locatePoint, pointSite, workerGeometryLoader } from '../src/point.mjs';
import { buildKitchenAdvisory } from '../src/kitchen.mjs';

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const cache = new Map();

/**
 * Live climate at an exact coordinate.
 *
 * A point deserves its own data. The precomputed normals pack is incomplete, and
 * wards borrowing a distant cell would otherwise describe an Embakasi balcony
 * with numbers from 80 km away. So the point routes read ET0 and elevation
 * straight from Open-Meteo at the requested coordinate, and hand back a site with
 * no precomputed cell attached. computeOutlook then fetches the archive for that
 * exact point instead of reusing a neighbour's.
 */
async function pointClimate(lat, lon) {
  const qs = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    daily: 'et0_fao_evapotranspiration,precipitation_sum',
    forecast_days: '7',
    timezone: 'auto',
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${qs}`);
  if (!res.ok) throw Object.assign(new Error(`open-meteo HTTP ${res.status}`), { status: 502 });
  const data = await res.json();
  const et0Series = (data.daily?.et0_fao_evapotranspiration ?? []).filter((v) => Number.isFinite(v));
  return {
    elevation_m: data.elevation ?? null,
    grid: { latitude: data.latitude, longitude: data.longitude },
    et0_next7_mean: et0Series.length ? Math.round((et0Series.reduce((a, b) => a + b, 0) / et0Series.length) * 100) / 100 : null,
    et0_today: et0Series[0] ?? null,
  };
}

/** Resolve ?lat=&lon= into a point target, with its administrative unit attached. */
async function resolvePointTarget(url, env = {}) {
  const lat = Number(url.searchParams.get('lat'));
  const lon = Number(url.searchParams.get('lon'));
  if (!url.searchParams.has('lat') || !url.searchParams.has('lon')) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw Object.assign(new Error('lat and lon must be numbers'), { status: 400 });
  }
  const location = await locatePoint(lat, lon, workerGeometryLoader(url.origin, env?.ASSETS));
  const climate = await pointClimate(lat, lon);
  const site = pointSite({
    lat,
    lon,
    label: url.searchParams.get('label') ?? location.ward ?? `${lat}, ${lon}`,
    location: { ...location, elevation_m: climate.elevation_m },
  });
  return { key: `point:${lat.toFixed(4)},${lon.toFixed(4)}`, kind: 'point', site, location, climate };
}

/**
 * Two ways to address a place:
 *   ?site=gataka        curated pilot site with its own verified normals
 *   ?ward=<id|slug>     any of Kenya's 1452 wards, via its ERA5 grid cell
 * A ward outlook costs one seasonal request because the 2005-2024 baseline ships in the pack.
 */
export function resolveTarget({ ward, site } = {}) {
  if (ward) {
    const resolved = resolveWard(ward);
    if (!resolved) throw Object.assign(new Error(`unknown ward "${ward}"`), { status: 404 });
    return { key: `ward:${resolved.id}`, kind: 'ward', site: wardSite(resolved) };
  }
  const id = site ?? 'gataka';
  try {
    return { key: `site:${id}`, kind: 'site', site: getSite(id) };
  } catch (err) {
    throw Object.assign(new Error(err.message), { status: 404 });
  }
}

async function outlookFor(target) {
  const hit = cache.get(target.key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return { site: target.site, outlook: hit.value };
  const outlook = await computeOutlook(target.site);
  cache.set(target.key, { at: Date.now(), value: outlook });
  return { site: target.site, outlook };
}

function pickActive(months) {
  const usable = months.filter((m) => m.complete && m.tercile !== 'unknown');
  const key = new Date().toISOString().slice(0, 7);
  return usable.find((m) => m.month === key) ?? usable.find((m) => m.month >= key) ?? usable[0] ?? months[0];
}

async function advisoryFor({ target, lang, irrigation }) {
  const { site, outlook } = await outlookFor(target);
  const active = pickActive(outlook.months);
  const advisory = buildAdvisory({
    site,
    tercile: active?.tercile ?? 'unknown',
    confidence: active?.confidence ?? 'none',
    month: active?.calendar_month ?? new Date().getUTCMonth() + 1,
    locale: lang,
    irrigation,
    crops,
  });
  return { site, outlook, active, advisory };
}

const json = (data, init = {}) =>
  new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', ...init.headers },
  });

const text = (body, init = {}) =>
  new Response(body, {
    ...init,
    headers: { 'content-type': 'text/plain; charset=utf-8', ...init.headers },
  });

/**
 * Choropleth feed for one county: a single multi-point seasonal request over the county's distinct
 * ERA5 cells, classified against each cell's precomputed 2005-2024 tercile bands. Wards sharing a
 * cell share a forecast, which is exactly what a 0.25-degree reanalysis can support.
 */
async function countyOutlook(countyRef) {
  const wards = wardsForCounty(countyRef);
  if (wards.length === 0) throw Object.assign(new Error(`unknown county "${countyRef}"`), { status: 404 });
  const slug = wards[0].county_slug;
  const cacheKey = `county:${slug}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const cellKeys = [...new Set(wards.map((w) => w.cell))];
  const coords = cellKeys.map((k) => {
    const [lat, lon] = k.split(',').map(Number);
    return { lat, lon };
  });
  const forecasts = await fetchSeasonalMulti(coords);

  const monthsByCell = new Map();
  cellKeys.forEach((key, i) => {
    const ward = wards.find((w) => w.cell === key);
    const cell = cellFor(ward);
    const forecast = forecasts[i];
    if (!cell || !forecast) return;
    monthsByCell.set(key, outlookFromRaw({ forecast, baseline: baselineFromCell(cell), normals: normalsFromCell(cell) }));
  });

  const value = {
    county: wards[0].county,
    county_slug: slug,
    baseline_years: wards[0].sample_years ?? 20,
    models: { seasonal: 'ecmwf_seas5' },
    retrieved_at: new Date().toISOString(),
    cells: cellKeys.length,
    wards: wards.map((w) => {
      const months = monthsByCell.get(w.cell) ?? [];
      const active = pickActive(months) ?? null;
      return {
        id: w.id,
        slug: w.slug,
        name: w.name,
        sub_county: w.sub_county,
        latitude: w.latitude,
        longitude: w.longitude,
        agro_ecology: w.agro_ecology,
        cell: w.cell,
        cell_source: w.cell_source,
        cell_distance_km: w.cell_distance_km,
        month: active?.month ?? null,
        tercile: active?.tercile ?? 'unknown',
        tercile_reason: active?.tercile_reason ?? 'no_data',
        confidence: active?.confidence ?? 'none',
        forecast_mm: active?.forecast_mm ?? null,
        median_mm: active?.median_mm ?? null,
        anomaly_pct: active?.anomaly_pct ?? null,
      };
    }),
  };
  cache.set(cacheKey, { at: Date.now(), value });
  return value;
}

export async function handle(request, env = {}) {
  const url = new URL(request.url);
  const siteId = url.searchParams.get('site') ?? 'gataka';
  const wardRef = url.searchParams.get('ward');
  const lang = url.searchParams.get('lang') ?? 'sw';
  const irrigation = url.searchParams.get('irrigation') === 'true';

  try {
    if (url.pathname === '/' || url.pathname === '/health') {
      const cov = wardCoverage();
      return json({
        service: 'msimu',
        status: 'ok',
        sites: siteIds(),
        coverage: {
          counties: allCounties().length,
          wards: cov.wards,
          era5_cells: cov.cells,
          wards_own_cell: cov.own,
          wards_nearest_cell: cov.nearest,
          baseline_years: cov.baseline_years,
        },
        locales: supportedLocales(),
        data: 'Open-Meteo Seasonal (ECMWF SEAS5) + Archive (ERA5 2005-2024). Boundaries: geoBoundaries gbOpen KEN, CC BY 4.0. No API key, no cost.',
        routes: [
          '/counties',
          '/wards?county=kajiado',
          '/locate?lat=-1.28496&lon=36.89468',
          '/forecast?ward=kajiado--nkaimurunya',
          '/forecast?lat=-1.28496&lon=36.89468',
          '/advisory?ward=kajiado--nkaimurunya&lang=sw',
          '/advisory?site=gataka&lang=sw',
          '/kitchen?lat=-1.28496&lon=36.89468&aspect=shaded&water=purchased&lang=en',
          'POST /ussd',
        ],
        generated_at: new Date().toISOString(),
      });
    }

    if (url.pathname === '/counties') {
      return json({ counties: allCounties(), wards: wardCoverage() });
    }

    if (url.pathname === '/wards') {
      const county = url.searchParams.get('county');
      if (!county) return json({ error: 'county is required, see /counties' }, { status: 400 });
      const wards = wardsForCounty(county);
      if (wards.length === 0) return json({ error: `unknown county "${county}"` }, { status: 404 });
      return json({ county: wards[0].county, county_slug: wards[0].county_slug, ward_count: wards.length, wards });
    }

    if (url.pathname === '/county-outlook') {
      const county = url.searchParams.get('county');
      if (!county) return json({ error: 'county is required, see /counties' }, { status: 400 });
      return json(await countyOutlook(county));
    }

    if (url.pathname === '/forecast') {
      const target = (await resolvePointTarget(url, env)) ?? resolveTarget({ ward: wardRef, site: siteId });
      const { site, outlook } = await outlookFor(target);
      return json({
        place:
          target.kind === 'point'
            ? { kind: 'point', latitude: site.latitude, longitude: site.longitude, ward: target.location?.ward ?? null, sub_county: target.location?.sub_county ?? null, county: target.location?.county ?? null, boundary_exact: target.location?.exact ?? null }
            : target.kind === 'ward'
              ? { kind: 'ward', id: site.id, slug: site.slug, ward: site.ward, county: site.county, sub_county: site.sub_county, agro_ecology: site.agro_ecology, cell: site.cell }
              : { kind: 'site', id: siteId, name: site.name },
        site,
        site_name: site.name,
        elevation_m: outlook.elevation_m,
        baseline_years: outlook.baseline_years,
        baseline_source: outlook.baseline_source,
        models: outlook.models,
        retrieved_at: outlook.retrieved_at,
        months: outlook.months,
      });
    }

    if (url.pathname === '/advisory') {
      const target = (await resolvePointTarget(url, env)) ?? resolveTarget({ ward: wardRef, site: siteId });
      const { site, outlook, active, advisory } = await advisoryFor({ target, lang, irrigation });
      if (url.searchParams.get('format') === 'text') return text(advisory.text);
      return json({
        site: site.name,
        county: target.location?.county ?? site.county ?? null,
        sub_county: target.location?.sub_county ?? site.sub_county ?? null,
        ward: target.location?.ward ?? site.ward ?? null,
        agro_ecology: site.agro_ecology ?? null,
        cell: site.cell ?? null,
        month: active?.month ?? null,
        tercile: active?.tercile ?? 'unknown',
        confidence: active?.confidence ?? 'none',
        forecast_mm: active?.forecast_mm ?? null,
        median_mm: active?.median_mm ?? null,
        advisory: advisory.lines,
        structured: advisory.structured,
        outlook: outlook.months,
      });
    }

    if (url.pathname === '/ussd') {
      if (request.method !== 'POST') return text('POST only', { status: 405 });
      const raw = await request.text();
      const params = new URLSearchParams(raw);
      const target = resolveTarget({
        ward: params.get('ward') ?? wardRef,
        site: params.get('site') ?? siteId,
      });
      const { site, outlook, advisory } = await advisoryFor({ target, lang: params.get('lang') ?? lang, irrigation: false });
      const result = ussdResponse(params.get('text') ?? '', { site, advisory, outlook, crops, locale: lang });
      return text(`${result.end ? 'END' : 'CON'} ${result.body}`);
    }

    if (url.pathname === '/locate') {
      const lat = Number(url.searchParams.get('lat'));
      const lon = Number(url.searchParams.get('lon'));
      if (!url.searchParams.has('lat') || !url.searchParams.has('lon')) {
        return json({ error: 'lat and lon are required, e.g. /locate?lat=-1.28496&lon=36.89468' }, { status: 400 });
      }
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        return json({ error: 'lat and lon must be numbers' }, { status: 400 });
      }
      const location = await locatePoint(lat, lon, workerGeometryLoader(url.origin, env?.ASSETS));
      const climate = await pointClimate(lat, lon).catch(() => null);
      return json({
        requested: { latitude: lat, longitude: lon },
        grid_point: climate?.grid ?? null,
        elevation_m: climate?.elevation_m ?? null,
        ...location,
        et0_today_mm: climate?.et0_today ?? null,
      });
    }

    if (url.pathname === '/kitchen') {
      const point = await resolvePointTarget(url, env);
      if (!point) {
        return json(
          { error: 'lat and lon are required, e.g. /kitchen?lat=-1.28496&lon=36.89468&aspect=shaded&water=purchased&lang=en' },
          { status: 400 },
        );
      }
      const tercile = url.searchParams.get('tercile') ?? 'near';
      if (!['below', 'near', 'above'].includes(tercile)) {
        return json({ error: 'tercile must be below, near or above' }, { status: 400 });
      }
      const advisory = buildKitchenAdvisory({
        site: point.site,
        et0: point.climate.et0_next7_mean ?? point.climate.et0_today,
        tercile,
        month: Number(url.searchParams.get('month')) || new Date().getUTCMonth() + 1,
        aspect: url.searchParams.get('aspect') ?? 'unknown',
        waterSource: url.searchParams.get('water') ?? 'unknown',
        locale: lang,
        crops,
      });
      return json({
        ...advisory,
        location: point.location,
        grid_point: point.climate.grid,
        elevation_m: point.climate.elevation_m,
        et0_next7_mean_mm: point.climate.et0_next7_mean,
      });
    }

    return json({ error: 'not found', routes: ['/health', '/counties', '/wards', '/locate', '/forecast', '/advisory', '/kitchen', '/ussd'] }, { status: 404 });
  } catch (err) {
    return json(
      { error: String(err?.message ?? err), site: wardRef ? null : siteId, ward: wardRef ?? null },
      { status: err?.status === 404 ? 404 : 500 },
    );
  }
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET,POST,OPTIONS',
          'access-control-allow-headers': 'content-type',
        },
      });
    }
    return handle(request, env);
  },
};
