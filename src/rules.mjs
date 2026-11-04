const SHORT_RAINS = [10, 11, 12];
const LONG_RAINS = [3, 4, 5];

export function seasonForMonth(month) {
  if (SHORT_RAINS.includes(month)) return 'short_rains';
  if (LONG_RAINS.includes(month)) return 'long_rains';
  if ([6, 7, 8, 9].includes(month)) return 'dry_jun_sep';
  return 'dry_jan_feb';
}

export function isPlantingWindow(season) {
  return season === 'short_rains' || season === 'long_rains';
}

export const TOLERANCE_RANK = { low: 0, medium: 1, high: 2, very_high: 3 };
export const MIN_TOLERANCE = { below: 2, near: 1, above: 0 };

export function selectCrops({ tercile, month, waterBalancePct, irrigation = false, crops }) {
  const season = seasonForMonth(month);
  const planting = isPlantingWindow(season);
  const minTolerance = MIN_TOLERANCE[tercile] ?? 2;

  const recommended = [];
  const avoid = [];
  const warnings = [];

  for (const c of crops) {
    if (c.purpose === 'fodder' && !c.rainfed_ok) continue;

    const needsWater = c.irrigation_required === true || c.water_need === 'high';
    const waterSecured = irrigation && needsWater;
    const droughtOk = waterSecured || TOLERANCE_RANK[c.drought_tolerance] >= minTolerance;

    if (!planting) {
      if (!needsWater && droughtOk && c.purpose === 'fodder') recommended.push(c);
      else if (needsWater) avoid.push({ crop: c, reason: 'dry_season' });
      continue;
    }

    if (needsWater && !irrigation) {
      avoid.push({ crop: c, reason: 'needs_irrigation' });
      continue;
    }

    if (!droughtOk && tercile !== 'above') {
      avoid.push({ crop: c, reason: 'drought_risk' });
      continue;
    }

    recommended.push(c);
  }

  if (!irrigation && waterBalancePct && waterBalancePct < 60) {
    const maize = crops.find((c) => c.id === 'maize');
    if (maize && !avoid.some((a) => a.crop.id === 'maize')) {
      avoid.push({ crop: maize, reason: 'water_balance' });
    }
    warnings.push({
      code: 'water_balance',
      detail: `Annual rainfall is ${waterBalancePct}% of crop water demand at this site. Rainfed maize is a gamble, not a plan.`,
    });
  }

  if (tercile === 'above') {
    warnings.push({
      code: 'excess_rain',
      detail: 'Above-normal rain raises waterlogging, fungal disease and pest pressure. Plant on ridges and scout weekly.',
    });
  }

  if (tercile === 'below') {
    warnings.push({
      code: 'deficit',
      detail: 'Below-normal rain expected. Prefer the shortest-maturity drought-tolerant crop available and consider not planting at all if the window is already closing.',
    });
  }

  recommended.sort((a, b) => {
    const m = a.maturity_days[1] - b.maturity_days[1];
    if (m !== 0) return m;
    return TOLERANCE_RANK[b.drought_tolerance] - TOLERANCE_RANK[a.drought_tolerance];
  });

  return { season, planting, tercile, recommended, avoid, warnings };
}

export function livestockAdvice({ tercile, month, season }) {
  const s = season ?? seasonForMonth(month);
  const out = [];

  if (s === 'dry_jun_sep' || s === 'dry_jan_feb' || tercile === 'below') {
    out.push('water_pans');
    out.push('secure_hay');
    out.push('destock_early');
  }

  if (tercile === 'above') {
    out.push('move_off_low_ground');
    out.push('tick_and_worm');
  }

  if (s === 'short_rains' || s === 'long_rains') {
    out.push('establish_fodder');
  }

  return out;
}

export function earlyWarning({ tercile, season }) {
  if (tercile === 'unknown') return { level: 'no_data', key: 'no_data' };
  if (tercile === 'below' && (season === 'short_rains' || season === 'long_rains')) {
    return { level: 'watch', key: 'below_in_planting' };
  }
  if (tercile === 'below' && season.startsWith('dry')) {
    return { level: 'alert', key: 'below_in_dry' };
  }
  if (tercile === 'above') return { level: 'watch', key: 'above' };
  return { level: 'normal', key: 'normal' };
}
