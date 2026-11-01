/**
 * Country-wide ward resolution: every one of Kenya's 1452 wards, mapped to the ERA5 grid cell
 * that describes its climate. Built by `scripts/build-normals.mjs` into `data/wards.json`.
 *
 * A ward site object is shaped exactly like the curated sites in `data/sites.json`, so the
 * advisory, USSD and CLI code paths do not need to know whether they are talking about the
 * Kajiado pilot or any other ward in the country.
 */
import wardsJson from '../data/wards.json' with { type: 'json' };

const pack = wardsJson;
const cells = pack.cells;
const wardList = pack.wards;

const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const byId = new Map();
const bySlug = new Map();
const byName = new Map();
const countyOrder = [];

for (const w of wardList) {
  w.slug = `${w.county_slug}--${slugify(w.name)}`;
  byId.set(w.id, w);
  bySlug.set(w.slug, w);
  const nameKey = `${w.county_slug}/${slugify(w.name)}`;
  byName.set(nameKey, w);
  if (!countyOrder.some((c) => c.name === w.county)) countyOrder.push({ name: w.county, slug: w.county_slug });
}

export const baselineYears = pack.baseline_years;
export const gridDegrees = pack.grid_degrees;
export const provenance = pack._provenance;

export function counties() {
  return countyOrder.map((c) => ({ ...c, ward_count: wardList.filter((w) => w.county_slug === c.slug).length }));
}

export function wardsForCounty(countyRef) {
  const slug = resolveCountySlug(countyRef);
  return wardList.filter((w) => w.county_slug === slug).map((w) => publicWard(w));
}

export function resolveCountySlug(ref) {
  if (!ref) return null;
  const s = slugify(ref);
  const hit = countyOrder.find((c) => c.slug === s || slugify(c.name) === s);
  return hit ? hit.slug : null;
}

function publicWard(w) {
  const cell = cellFor(w);
  return {
    id: w.id,
    slug: w.slug,
    name: w.name,
    county: w.county,
    county_slug: w.county_slug,
    sub_county: w.sub_county,
    latitude: w.lat,
    longitude: w.lon,
    elevation_m: cell?.elevation_m ?? null,
    agro_ecology: cell ? agroEcology(cell) : 'unknown',
    cell: w.cell,
    cell_source: w.cell_source,
    cell_distance_km: w.cell_distance_km ?? 0,
    annual_rain_mm: cell?.annual_rain_mm ?? null,
    water_balance_pct: cell?.water_balance_pct ?? null,
  };
}

/** Accepts a ward id, a slug, "county/ward-name", or a bare ward name when it is unique. */
export function resolveWard(ref) {
  if (!ref) return null;
  if (byId.has(ref)) return byId.get(ref);
  if (bySlug.has(ref)) return bySlug.get(ref);
  const s = slugify(ref);
  if (bySlug.has(s)) return bySlug.get(s);
  if (byName.has(ref)) return byName.get(ref);
  if (byName.has(s)) return byName.get(s);
  const parts = String(ref).split('/');
  if (parts.length === 2) {
    const pairKey = `${slugify(parts[0])}/${slugify(parts[1])}`;
    if (byName.has(pairKey)) return byName.get(pairKey);
  }
  const bare = wardList.filter((w) => slugify(w.name) === s);
  if (bare.length === 1) return bare[0];
  return null;
}

export function cellFor(ward) {
  return ward ? cells[ward.cell] ?? null : null;
}

/**
 * Agro-ecological zone from the same numbers a farmer would use: how much rain falls in a normal
 * year, how much of the crop water demand that covers, and how cold it gets. Deliberately coarse
 * and documented in docs/ADVISORY-RULES.md, because ERA5 at 0.25 degrees cannot support finer
 * claims and the crop rules already gate on water balance and drought tolerance.
 */
export function agroEcology(cell) {
  const rain = cell.annual_rain_mm ?? 0;
  if (cell.frost_risk || (cell.elevation_m ?? 0) >= 2400) return 'highland';
  if (rain >= 1200) return 'humid';
  if (rain >= 900) return 'sub_humid';
  if (rain >= 600) return 'semi_arid';
  return 'arid';
}

export function wardSite(ref) {
  const ward = typeof ref === 'string' ? resolveWard(ref) : ref;
  if (!ward) throw new Error(`unknown ward "${ref}"`);
  const cell = cellFor(ward);
  if (!cell) throw new Error(`no ERA5 normals for ward "${ward.name}" (cell ${ward.cell} not built yet)`);
  return {
    id: ward.id,
    slug: ward.slug,
    name: ward.name,
    county: ward.county,
    sub_county: ward.sub_county,
    ward: ward.name,
    latitude: ward.lat,
    longitude: ward.lon,
    elevation_m: cell.elevation_m,
    agro_ecology: agroEcology(cell),
    frost_risk: cell.frost_risk === true,
    normals_2005_2024: {
      rain_mm: cell.rain_mm,
      rain_median_mm: cell.rain_median_mm,
      et0_mm: cell.et0_mm,
      tmin_c: cell.tmin_c,
    },
    annual: {
      rain_mm: cell.annual_rain_mm,
      et0_mm: cell.annual_et0_mm,
      water_balance_pct: cell.water_balance_pct,
    },
    cell: {
      key: cell.key,
      lat: cell.lat,
      lon: cell.lon,
      source: ward.cell_source,
      distance_km: ward.cell_distance_km ?? 0,
      grid_degrees: gridDegrees,
    },
    p33_mm: cell.p33_mm,
    p67_mm: cell.p67_mm,
    sample_years: cell.sample_years,
  };
}

export function wardCount() {
  return wardList.length;
}

export function coverage() {
  const own = wardList.filter((w) => w.cell_source === 'own').length;
  const nearest = wardList.filter((w) => w.cell_source === 'nearest').length;
  const none = wardList.filter((w) => w.cell_source === 'none').length;
  return { wards: wardList.length, cells: Object.keys(cells).length, own, nearest, none, baseline_years: baselineYears };
}
