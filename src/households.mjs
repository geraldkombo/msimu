/**
 * KNBS 2019 census average household size, per county.
 *
 * Saved artifact (the source of every number below):
 * docs/knbs-2019-household-size-by-county.md - StatsKenya's reproduction of KNBS
 * (2022), 2019 Kenya Population and Housing Census Vol. I, p. 9, fetched
 * 2 November 2026. National average 3.9.
 *
 * Default policy: a household plan rounds the county mean UP (Math.ceil), because
 * overstating a household is the safe direction for water and storage sizing.
 * An unknown county falls back to the national mean, rounded up to 4.
 *
 * Pure module: no fs, no fetch, no Node or Workers APIs. Runs in tests, in the
 * worker and in the CLI unchanged.
 */

export const NATIONAL_HOUSEHOLD_SIZE = 3.9;

/** Keys are normalized: lowercase, no apostrophes, hyphens folded to spaces. */
export const COUNTY_HOUSEHOLD_SIZE = {
  'mombasa': 3.1,
  'kwale': 5.0,
  'kilifi': 4.8,
  'tana river': 4.6,
  'lamu': 3.7,
  'taita taveta': 3.5,
  'garissa': 5.9,
  'wajir': 6.1,
  'mandera': 6.9,
  'marsabit': 5.8,
  'isiolo': 4.6,
  'meru': 3.6,
  'tharaka nithi': 3.6,
  'embu': 3.3,
  'kitui': 4.3,
  'machakos': 3.5,
  'makueni': 4.0,
  'nyandarua': 3.5,
  'nyeri': 3.0,
  'kirinyaga': 3.0,
  'muranga': 3.3,
  'kiambu': 3.0,
  'turkana': 5.6,
  'west pokot': 5.3,
  'samburu': 4.7,
  'trans nzoia': 4.4,
  'uasin gishu': 3.8,
  'elgeyo marakwet': 4.5,
  'nandi': 4.4,
  'baringo': 4.7,
  'laikipia': 3.4,
  'nakuru': 3.5,
  'narok': 4.8,
  'kajiado': 3.5,
  'kericho': 4.4,
  'bomet': 4.7,
  'kakamega': 4.3,
  'vihiga': 4.1,
  'bungoma': 4.6,
  'busia': 4.5,
  'siaya': 3.9,
  'kisumu': 3.8,
  'homa bay': 4.3,
  'migori': 4.6,
  'kisii': 4.1,
  'nyamira': 4.0,
  'nairobi': 2.9,
};

/** data/wards.json says "Tharaka"; KNBS says "Tharaka Nithi". Same county. */
const ALIASES = {
  'tharaka': 'tharaka nithi',
};

export function normalizeCounty(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/['\u2019]/g, '')
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The KNBS 2019 county mean, or null when the county is unknown. */
export function countyHouseholdSize(county) {
  const key = normalizeCounty(county);
  const size = COUNTY_HOUSEHOLD_SIZE[ALIASES[key] ?? key];
  return Number.isFinite(size) ? size : null;
}

/**
 * The default household size to plan for: county mean rounded up, national mean
 * rounded up when the county is unknown. `basis` travels into API payloads so a
 * caller can always see where the number came from.
 */
export function defaultHouseholdPeople(county) {
  const size = countyHouseholdSize(county);
  if (size === null) {
    return { people: Math.ceil(NATIONAL_HOUSEHOLD_SIZE), basis: 'knbs_2019_national', mean_size: NATIONAL_HOUSEHOLD_SIZE };
  }
  return { people: Math.ceil(size), basis: 'knbs_2019_county', mean_size: size };
}
