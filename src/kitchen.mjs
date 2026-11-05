/**
 * Kitchen garden and container advisory.
 *
 * This exists because the rest of Msimu assumes land. A household in a flat in
 * Embakasi has no field, no furrow and no rainfall runoff to plan around, but she
 * does have a balcony, a few sacks and a tap. The seasonal tercile still matters
 * to her, just differently: it tells her whether to expect free water or to budget
 * for bought water, and whether her containers will bake or stay damp.
 *
 * DATA STATUS - READ THIS BEFORE QUOTING ANY NUMBER
 * -------------------------------------------------
 * The container profiles in data/kitchen.json carry `_provenance.status =
 * "partially_verified"` (2026-11-05): harvest windows, harvest styles and the
 * crop exclusions were matched against published Kenyan and institutional
 * sources - every citation in docs/CONTAINER-DATA-SOURCES.md - while the
 * container depths and volumes remain app-derived horticultural defaults.
 * Every payload this module returns therefore includes `data_status` and a
 * `caveat`, and the two are not optional: a caller that drops them is
 * presenting defaults as fact.
 *
 * Watering frequency is derived from FAO ET0, which is a real physical quantity
 * from Open-Meteo. The mapping from ET0 to "water twice a day" is a heuristic,
 * and is labelled as one.
 */
import kitchenJson from '../data/kitchen.json' with { type: 'json' };
import { seasonForMonth } from './rules.mjs';
import { cropName } from './advisory.mjs';

export const kitchenProvenance = kitchenJson._provenance;
export const containers = kitchenJson.containers;
export const unsuitableInContainers = kitchenJson.unsuitable_in_containers;

export const DATA_STATUS_CAVEAT =
  'Harvest windows and styles were matched on 5 Nov 2026 against published Kenyan and institutional sources ' +
  '(MOALF-SHEP/JICA, FAO, KALRO; citations in docs/CONTAINER-DATA-SOURCES.md). Container depths and volumes ' +
  'remain horticultural defaults, not Kenyan trial data. Confirm with a county extension officer before ' +
  'relying on them commercially.';

/**
 * Map daily reference evapotranspiration (FAO ET0, mm/day) to a watering rhythm.
 *
 * Containers hold far less water than soil, so they cross the same ET0 thresholds
 * at a higher frequency than a field would. The band edges are a heuristic, not a
 * measured curve, and the returned `basis` says so.
 */
export function wateringFromEt0(et0MmPerDay) {
  if (!Number.isFinite(et0MmPerDay)) {
    return {
      frequency: 'unknown',
      detail: 'No ET0 available for this point, so watering cannot be scheduled from demand.',
      basis: 'unavailable',
    };
  }
  const e = et0MmPerDay;
  if (e >= 5.5) {
    return {
      frequency: 'twice_daily',
      detail: `ET0 is ${e.toFixed(1)} mm/day. Containers at this demand dry out within a day: water morning and evening.`,
      basis: 'heuristic_from_fao_et0',
    };
  }
  if (e >= 4.0) {
    return {
      frequency: 'daily',
      detail: `ET0 is ${e.toFixed(1)} mm/day. Water every day, and check the top 5 cm before skipping one.`,
      basis: 'heuristic_from_fao_et0',
    };
  }
  if (e >= 2.5) {
    return {
      frequency: 'every_2_days',
      detail: `ET0 is ${e.toFixed(1)} mm/day. Water every second day, but daily for anything in full afternoon sun.`,
      basis: 'heuristic_from_fao_et0',
    };
  }
  return {
    frequency: 'every_3_days',
    detail: `ET0 is ${e.toFixed(1)} mm/day. Water every third day. Over-watering is now the more likely failure.`,
    basis: 'heuristic_from_fao_et0',
  };
}

/** Sunlight a balcony or windowsill can realistically give, by aspect. */
export function lightClass(aspect) {
  const map = {
    full_sun: 'full_sun_only',
    morning_sun: 'part_shade_ok',
    afternoon_shade: 'part_shade_ok',
    shaded: 'shade_tolerant_only',
    unknown: 'part_shade_ok',
  };
  return map[aspect] ?? 'part_shade_ok';
}

/** Filter and rank containers for the conditions at this point. */
export function suitableContainers({ light = 'part_shade_ok', month, tercile, frostRisk = false } = {}) {
  const season = seasonForMonth(month ?? new Date().getMonth() + 1);
  const byCrop = new Map(containers.map((c) => [c.crop_id, c]));
  const out = [];

  for (const c of containers) {
    const reasons = [];
    // A shaded balcony cannot ripen fruit, whatever the season says.
    if (light === 'shade_tolerant_only' && c.shade_tolerance === 'full_sun_only') {
      continue;
    }
    if (light === 'full_sun_only' && c.shade_tolerance === 'part_shade_ok') {
      reasons.push('would_tolerate_more_shade');
    }
    if (frostRisk && !c.shade_tolerance) reasons.push('frost_exposed');
    // Climbers need something to climb. On a bare windowsill that is a real blocker.
    if (c.support_needed) reasons.push('needs_staking_or_railing');
    out.push({ ...c, notes: reasons, season });
  }

  // In a dry tercile, prefer the crops that forgive a missed watering.
  const dry = tercile === 'below';
  out.sort((a, b) => {
    const score = (x) => {
      let s = x.days_to_first_harvest[0]; // fast return first
      if (dry && x.crop_id === 'cowpea') s -= 20;
      if (dry && x.crop_id === 'tomato') s += 25;
      if (x.notes.length) s += 5 * x.notes.length;
      return s;
    };
    return score(a) - score(b);
  });

  return { season, ranked: out, profiles: byCrop };
}

/**
 * Build the kitchen-garden payload.
 *
 * @param {object} opts
 * @param {object} opts.site       point site from point.mjs, or any site-like object
 * @param {number} [opts.et0]      daily FAO ET0 in mm at this point
 * @param {string} [opts.tercile]  'below' | 'near' | 'above' for the coming season
 * @param {number} [opts.month]
 * @param {string} [opts.aspect]   balcony light: full_sun | morning_sun | afternoon_shade | shaded | unknown
 * @param {string} [opts.waterSource] tap | rainwater | purchased | unknown
 * @param {string} [opts.locale]   'sw' | 'en'
 * @param {object[]} [opts.crops]  crop pack, used for local names
 */
export function buildKitchenAdvisory({
  site,
  et0 = null,
  tercile = 'near',
  month = new Date().getMonth() + 1,
  aspect = 'unknown',
  waterSource = 'unknown',
  locale = 'sw',
  crops = [],
} = {}) {
  if (!site) throw new Error('buildKitchenAdvisory needs a site');
  const light = lightClass(aspect);
  const frostRisk = Number.isFinite(site.elevation_m) && site.elevation_m >= 2400;
  const { season, ranked } = suitableContainers({ light, month, tercile, frostRisk });

  const nameOf = (id) => {
    const c = crops.find((x) => x.id === id);
    return c ? cropName(c, locale) : id;
  };

  const warnings = [];
  if (tercile === 'below') {
    warnings.push({
      code: 'dry_season_outlook',
      detail:
        'Below-normal rain is expected. Containers have no soil buffer behind them, so a missed watering costs more here than in a field.',
    });
  }
  if (waterSource === 'purchased') {
    warnings.push({
      code: 'bought_water',
      detail:
        'Water is purchased at this site. Grow leafy crops for household use rather than fruit crops for market, and mulch the surface of every container.',
    });
  }
  if (frostRisk) {
    warnings.push({
      code: 'frost_risk',
      detail: `Elevation is ${site.elevation_m} m. Bring seedlings indoors on cold clear nights.`,
    });
  }
  if (light === 'shade_tolerant_only') {
    warnings.push({
      code: 'shaded_site',
      detail: 'This site is shaded. Only leafy greens will do well; fruiting crops will not ripen.',
    });
  }
  if (!ranked.length) {
    warnings.push({
      code: 'nothing_suitable',
      detail: 'No container crop suits these light conditions.',
    });
  }

  return {
    kind: 'kitchen_garden',
    site: {
      name: site.name ?? null,
      latitude: site.latitude ?? null,
      longitude: site.longitude ?? null,
      county: site.county ?? null,
      ward: site.ward ?? null,
      sub_county: site.sub_county ?? null,
      elevation_m: site.elevation_m ?? null,
    },
    season,
    month,
    tercile,
    light,
    water_source: waterSource,
    watering: wateringFromEt0(et0 === null ? Number.NaN : Number(et0)),
    recommended: ranked.map((r) => ({
      crop_id: r.crop_id,
      name: nameOf(r.crop_id),
      min_depth_cm: r.min_depth_cm,
      min_volume_litres: r.min_volume_litres,
      days_to_first_harvest: r.days_to_first_harvest,
      harvest_style: r.harvest_style,
      support_needed: r.support_needed,
      shade_tolerance: r.shade_tolerance,
      spacing_cm: r.spacing_cm,
      notes: locale === 'en' ? r.notes_en : r.notes_sw,
      flags: r.notes,
    })),
    unsuitable: unsuitableInContainers.map((u) => ({ crop_id: u.crop_id, name: nameOf(u.crop_id), reason: u.reason })),
    warnings,
    data_status: kitchenProvenance.status,
    caveat: DATA_STATUS_CAVEAT,
  };
}
