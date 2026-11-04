/**
 * Surroundings analysis: what the map says is around a point, turned into an
 * honest suggestion for the food-security plan inputs.
 *
 * Input is an OpenStreetMap element list (buildings within ~300 m,
 * farmland/gardens within ~550 m; the rings are wider than a property line on
 * purpose - in mapped African cities the parcel you stand in is often the only
 * untagged thing for 100 m, and the vertical city around it is the signal)
 * plus an optional Nominatim reverse-geocode address. All sources are free and
 * keyless; OSM coverage varies, so the analyzer degrades to
 * `suggestion: null` with a reason instead of guessing.
 *
 * Every suggestion is labelled `osm_heuristic`: a map-derived hint the user
 * confirms with their own eyes, never a measurement of their home.
 *
 * Pure module: no fs, no fetch, no Node or Workers APIs.
 */

export const DATA_STATUS = 'osm_heuristic';

const APARTMENT_TYPES = new Set(['apartments', 'apartment', 'residential', 'dormitory']);
const HOUSE_TYPES = new Set(['house', 'detached', 'semidetached_house', 'terrace_house', 'bungalow', 'hut', 'cabin']);
const FARMLAND_USES = new Set(['farmland', 'farmyard', 'orchard', 'meadow', 'greenhouse_horticulture']);

const ROOF_MATERIAL_MAP = [
  [/corrugated|iron|metal|steel|zinc/i, 'iron'],
  [/tile|terracotta|concrete|slab|cement/i, 'tiles'],
  [/thatch|grass|palm|straw|reed|makuti/i, 'thatch'],
];

/**
 * Convert an OSM API `/api/0.6/map?bbox=` XML document into the same element
 * shape Overpass returns, so one analyzer serves both sources. Only tagged
 * buildings and land use are kept, each filtered by distance from the centre
 * point: buildings inside 300 m, land use inside 550 m. Way positions are the
 * mean of their node positions; relations are skipped because their member
 * ways are already in the document.
 */
export function osmXmlToElements(xml, lat, lon, { building_m = 300, land_m = 550 } = {}) {
  const text = String(xml ?? '');
  const centre = { lat: Number(lat), lon: Number(lon) };
  if (!Number.isFinite(centre.lat) || !Number.isFinite(centre.lon)) return [];
  const cosLat = Math.cos((centre.lat * Math.PI) / 180);
  const distM = (p) => {
    if (!p) return Infinity;
    const dy = (p.lat - centre.lat) * 111320;
    const dx = (p.lon - centre.lon) * 111320 * cosLat;
    return Math.sqrt(dy * dy + dx * dx);
  };
  const parseTags = (inner) => {
    const tags = {};
    for (const m of String(inner ?? '').matchAll(/<tag\s+k="([^"]*)"\s+v="([^"]*)"/g)) tags[m[1]] = m[2];
    return tags;
  };
  const wanted = (tags) => Boolean(tags.building) || Boolean(tags.landuse) || Boolean(tags.leisure);
  const nodePos = new Map();
  const elements = [];
  const push = (tags, pos) => {
    if (!wanted(tags)) return;
    const limit = tags.building ? building_m : land_m;
    if (distM(pos) > limit) return;
    elements.push({ type: tags.building ? 'way' : 'way', tags });
  };
  for (const m of text.matchAll(/<node\b([^>]*?)(?:\/>|>([\s\S]*?)<\/node>)/g)) {
    const id = /id="(-?\d+)"/.exec(m[1])?.[1];
    const pos = {
      lat: Number(/lat="(-?[\d.]+)"/.exec(m[1])?.[1]),
      lon: Number(/lon="(-?[\d.]+)"/.exec(m[1])?.[1]),
    };
    if (id && Number.isFinite(pos.lat) && Number.isFinite(pos.lon)) nodePos.set(id, pos);
    if (m[2]) {
      const tags = parseTags(m[2]);
      if (Object.keys(tags).length) push(tags, pos);
    }
  }
  for (const m of text.matchAll(/<way\b[^>]*>([\s\S]*?)<\/way>/g)) {
    const inner = m[1];
    const tags = parseTags(inner);
    if (!wanted(tags)) continue;
    let sumLat = 0;
    let sumLon = 0;
    let n = 0;
    for (const nd of inner.matchAll(/<nd\s+ref="(-?\d+)"/g)) {
      const p = nodePos.get(nd[1]);
      if (p) {
        sumLat += p.lat;
        sumLon += p.lon;
        n += 1;
      }
    }
    push(tags, n ? { lat: sumLat / n, lon: sumLon / n } : null);
  }
  return elements;
}

export function mapRoofMaterial(tag) {
  const value = String(tag ?? '').trim();
  if (!value) return null;
  for (const [re, material] of ROOF_MATERIAL_MAP) {
    if (re.test(value)) return material;
  }
  return null;
}

/** Classify one building tag into apartment / house / other. */
export function buildingClass(type) {
  const value = String(type ?? '').trim().toLowerCase();
  if (!value || value === 'yes') return 'unknown';
  if (APARTMENT_TYPES.has(value)) return 'apartment';
  if (HOUSE_TYPES.has(value)) return 'house';
  return 'other';
}

/**
 * Analyze Overpass elements into counts, land context and a dwelling/material
 * suggestion. Rules are deliberately conservative: with no buildings mapped
 * (common outside city centres) the suggestion is null and says why, because
 * an absent map is not evidence of an absent home.
 */
export function analyzeSurroundings({ elements = [], reverse = null } = {}) {
  const buildings = [];
  const land = { farmland_ways: 0, garden_ways: 0 };
  for (const el of elements) {
    const tags = el?.tags ?? {};
    if (tags.building) {
      buildings.push({
        klass: buildingClass(tags.building),
        levels: Number(tags['building:levels']) || null,
        roof: mapRoofMaterial(tags['roof:material']),
        name: tags.name ?? null,
      });
    } else if (FARMLAND_USES.has(tags.landuse)) {
      land.farmland_ways += 1;
    } else if (tags.leisure === 'garden' || tags.leisure === 'park') {
      land.garden_ways += 1;
    }
  }

  const count = buildings.length;
  const apartments = buildings.filter((b) => b.klass === 'apartment').length;
  const houses = buildings.filter((b) => b.klass === 'house').length;
  const unknown = buildings.filter((b) => b.klass === 'unknown').length;
  const highRise = buildings.filter((b) => b.levels !== null && b.levels >= 3).length;
  const apartmentsShare = count ? apartments / count : 0;
  const unknownShare = count ? unknown / count : 0;
  const roofVotes = {};
  for (const b of buildings) if (b.roof) roofVotes[b.roof] = (roofVotes[b.roof] ?? 0) + 1;
  const roofTop = Object.entries(roofVotes).sort((a, b) => b[1] - a[1])[0] ?? null;

  const address = reverse?.address ?? null;
  const place = address
    ? {
        suburb: address.suburb ?? address.city_district ?? address.neighbourhood ?? null,
        town: address.town ?? address.city ?? address.village ?? null,
        county: address.county ?? address.state ?? null,
        country: address.country ?? null,
      }
    : null;

  // Suggestion rules, in plain words:
  // - half or more of the mapped buildings are apartment-type, or a third of
  //   them are 3+ storeys: this looks like flat country.
  // - otherwise, if houses are the largest known class: house.
  // - otherwise, a dense block (15+ buildings, no mapped houses, and either
  //   some vertical/some apartments or mostly unclassified buildings, which is
  //   how African city centres are mapped - building=yes with no type): flat.
  //   Standing in Nairobi's Upper Hill, this is the honest read of 84 buildings
  //   with zero houses among them.
  // - no buildings mapped at all: no suggestion, honest reason.
  const reasons = [];
  let dwelling = null;
  const denseCityBlock = count >= 15 && houses === 0 && (apartments + highRise > 0 || unknownShare >= 0.8);
  if (count === 0) {
    reasons.push('no_osm_buildings_mapped_here');
  } else if (apartmentsShare >= 0.5 || (count >= 3 && highRise / count >= 0.34)) {
    dwelling = 'flat';
    reasons.push(`apartment_share_${Math.round(apartmentsShare * 100)}pct`);
    if (highRise) reasons.push(`high_rise_${highRise}`);
  } else if (houses >= apartments && houses > 0) {
    dwelling = 'house';
    reasons.push(`house_majority_${houses}_of_${count}`);
  } else if (denseCityBlock) {
    dwelling = 'flat';
    reasons.push(`dense_block_${count}_buildings_no_houses`);
    if (highRise) reasons.push(`high_rise_${highRise}`);
  } else {
    reasons.push(`mixed_or_other_${count}_buildings`);
  }

  const suggestion = {
    dwelling,
    roof_material: roofTop ? roofTop[0] : null,
    roof_material_votes: roofTop ? roofTop[1] : 0,
    farmland_nearby: land.farmland_ways > 0,
    reasons,
  };

  return {
    data_status: DATA_STATUS,
    buildings: {
      count,
      apartments,
      houses,
      unknown,
      high_rise: highRise,
      apartments_share: Number(apartmentsShare.toFixed(2)),
      roof_material_votes: roofVotes,
      named: buildings.filter((b) => b.name).map((b) => b.name).slice(0, 5),
    },
    land,
    place,
    suggestion: dwelling || suggestion.roof_material || land.farmland_ways ? suggestion : null,
    caveat:
      'Suggested from OpenStreetMap buildings mapped near this point. OSM coverage is uneven: a null suggestion means nothing is mapped, not that nothing is there. Confirm with your eyes before trusting it.',
    sources: [
      { title: 'OpenStreetMap API (buildings and land use)', url: 'https://api.openstreetmap.org/' },
      { title: 'OpenStreetMap Overpass API (fallback)', url: 'https://overpass-api.de/' },
      { title: 'OpenStreetMap Nominatim (reverse geocode)', url: 'https://nominatim.openstreetmap.org/' },
    ],
  };
}
