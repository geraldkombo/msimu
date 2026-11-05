/**
 * Food-security preparedness plan.
 *
 * The advisory answers "what do I plant this week?". This answers the harder
 * household question: will we eat through the coming dry season, and what do I
 * do THIS month so that we will? It turns the seasonal outlook plus the ward's
 * 20-year ERA5 normals into three survival artefacts - a planting plan with a
 * harvest month attached, a lean-month calendar, and a rainwater tank size -
 * and renders them as bilingual lines a basic phone can show.
 *
 * DATA STATUS - READ THIS BEFORE QUOTING ANY NUMBER
 * -------------------------------------------------
 * Every number this module produces is a PLANNING HEURISTIC. The runoff
 * coefficient (0.8), the first-flush loss (0.9), the drinking allowance
 * (15 L/person/day) and the wet-month threshold (30 mm) are documented rules
 * of thumb, not Kenyan field measurements. The payload therefore always
 * carries `data_status` and `caveat`, and a caller that drops them is
 * presenting heuristics as fact.
 *
 * Ward targets get the full analysis: deficit months measured from the cell's
 * normals as rain_median < ET0, including the circular longest streak. Point
 * targets have no precomputed normals, so the module degrades to basis
 * 'tercile_only': lean months are simply the below-normal forecast months,
 * and the payload says so instead of pretending to precision the data cannot
 * support.
 *
 * Pure module: no fs, no fetch, no Node or Workers APIs. Runs in tests, in the
 * worker and in the CLI unchanged.
 *
 * PROVENANCE: every constant and gate is mapped to its Kenyan or authoritative
 * source in docs/FOOD-SECURITY-SOURCES.md (Sphere 15 L/person/day, KNBS 2019
 * household size 3.9, FAO Kenya AEZ half-ET0 growing-period rule, KEPHIS/KALRO
 * maturity windows, FEWS NET/NDMA lean-season calendar). The `sources` field
 * ships with every payload so the evidence travels with the plan.
 */
import { calendarMonth, daysInMonth } from './terciles.mjs';
import { MIN_TOLERANCE, TOLERANCE_RANK } from './rules.mjs';
import { i18n } from './i18n.mjs';
import { cropName } from './advisory.mjs';
import { VERIFY_WITH } from './helpdesk.mjs';

export const DATA_STATUS = 'planning_heuristic';
export const FOOD_CAVEAT =
  'Planning heuristic, not a guarantee. Rainfall expectations come from ECMWF SEAS5 classified against ERA5 2005-2024 terciles; the water numbers use fixed coefficients (0.72 L harvested per mm per m2 of roof, 15 L of drinking water per person per day); crop windows are rules of thumb. Confirm with your ward extension officer before buying seed, tanks or livestock.';

// Heuristic constants. None of these is a field measurement; see header.
export const RUNOFF_COEFFICIENT = 0.8; // share of roof rain that reaches the gutter
export const FIRST_FLUSH_FACTOR = 0.9; // share left after the first-flush diverter
export const CATCH_L_PER_MM_PER_M2 = RUNOFF_COEFFICIENT * FIRST_FLUSH_FACTOR; // 0.72
export const DRINKING_L_PER_PERSON_DAY = 15; // drinking plus cooking allowance
export const WET_MONTH_MM = 30; // below this a month cannot carry a rainfed crop
export const DAYS_PER_MONTH = 30.44;
export const MAIZE_WATER_BALANCE_FLOOR = 60; // below 60% rainfed maize is a gamble

/**
 * The datasets behind the numbers, shipped with every plan.
 * Full dossier with verbatim evidence: docs/FOOD-SECURITY-SOURCES.md.
 */
export const SOURCES = [
  { id: 'sphere_wash', title: 'Sphere Handbook 2018, WASH Standard 2.1: 15 L per person per day minimum', url: 'https://spherestandards.org/handbook/' },
  { id: 'knbs_2019', title: 'KNBS 2019 Census: average household size 3.9', url: 'https://www.knbs.or.ke/2019-kenya-population-and-housing-census-results/' },
  { id: 'fao_aez_kenya', title: 'FAO Kenya AEZ assessment: growing period begins at 0.5 x ET0 moisture supply', url: 'https://www.fao.org/4/t0732e/T0732E05.htm' },
  { id: 'kephis_varieties', title: 'KEPHIS National Crop Variety List: official durations to maturity', url: 'https://www.kephis.org/images/pdf-files/UPDATED_2022_JANUARY_NATIONAL_VARIETY_LIST.pdf' },
  { id: 'kalro_green_gram', title: 'KALRO improved green gram varieties: 65-70 days to maturity', url: 'https://keep.kalro.org/appfiles/media/vc_files/New_improved_market-preferred_green_gram_varieties.pdf' },
  { id: 'fewsnet_kenya', title: 'FEWS NET Kenya Food Security Outlook: lean season and harvest calendar', url: 'https://fews.net/east-africa/kenya/food-security-outlook/june-2026' },
  { id: 'ndma_bulletin', title: 'NDMA National Drought Early Warning Bulletin (monthly, per county)', url: 'https://knowledgeweb.ndma.go.ke/' },
  { id: 'roof_runoff_ke', title: 'Kenyan rainwater design practice: 0.8-0.9 runoff on smooth iron sheet', url: 'https://www.fugaequipment.co.ke/blog-rainwater-harvesting-kenya.html' },
];

// Food-first ordering: storage staples and drought-tolerant crops first,
// vegetables next, maize deliberately last so it never crowds out sorghum.
export const STAPLE_PRIORITY = [
  'cassava',
  'sorghum',
  'millet',
  'sweetpotato',
  'pigeonpea',
  'cowpea',
  'greengram',
  'dolichos',
  'amaranth',
  'kales',
  'boma_rhodes',
  'tomato',
  'maize',
];

// Harvests that must be dried and stored off the floor to survive the lean months.
const DRY_STORE = new Set(['sorghum', 'millet', 'cowpea', 'greengram', 'pigeonpea', 'dolichos', 'maize']);

function sortByMonth(rows) {
  return [...(rows ?? [])].sort((a, b) => String(a.month).localeCompare(String(b.month)));
}

/** 'YYYY-MM' plus n months, with year wrap: addMonths('2026-11', 3) === '2027-02'. */
export function addMonths(key, n) {
  const [y, m] = String(key).split('-').map(Number);
  const total = y * 12 + (m - 1) + Number(n);
  const yy = Math.floor(total / 12);
  const mm = (((total % 12) + 12) % 12) + 1;
  return `${String(yy).padStart(4, '0')}-${String(mm).padStart(2, '0')}`;
}

/** When a crop planted in `plantKey` is ready, given its maturity in days. */
export function harvestEstimate(plantKey, maturityDays) {
  const months = Math.ceil(Number(maturityDays) / DAYS_PER_MONTH);
  return addMonths(plantKey, months);
}

/**
 * The rainfall a household should PLAN on for one outlook row.
 * Below-normal tercile -> the 20-year p33 (a dry year's month, not the average),
 * above-normal -> p67, otherwise the median, falling back to the raw forecast.
 * Point sites have no p33/p67, so they degrade to median/forecast automatically.
 */
export function expectedRainMm(row, site) {
  if (!row) return null;
  const cm = row.calendar_month ?? calendarMonth(row.month);
  const p33 = site?.p33_mm?.[cm - 1];
  const p67 = site?.p67_mm?.[cm - 1];
  if (row.tercile === 'below' && Number.isFinite(p33)) return p33;
  if (row.tercile === 'above' && Number.isFinite(p67)) return p67;
  if (Number.isFinite(row.median_mm)) return row.median_mm;
  if (Number.isFinite(row.forecast_mm)) return row.forecast_mm;
  return null;
}

/**
 * Calendar months where the 20-year median rain fails the 20-year median ET0.
 * Returns null for sites without normals (points) so callers can degrade honestly.
 */
export function deficitMonths(site) {
  const n = site?.normals_2005_2024;
  if (!Array.isArray(n?.rain_median_mm) || !Array.isArray(n?.et0_mm)) return null;
  const months = [];
  for (let m = 1; m <= 12; m += 1) {
    const rain = n.rain_median_mm[m - 1];
    const et0 = n.et0_mm[m - 1];
    if (Number.isFinite(rain) && Number.isFinite(et0) && rain < et0) months.push(m);
  }
  return { count: months.length, months };
}

/** Longest run of consecutive deficit months, wrapping December into January. */
export function longestDeficitStreak(site) {
  const d = deficitMonths(site);
  if (!d) return null;
  if (d.count === 0) return 0;
  if (d.count === 12) return 12;
  const deficit = new Set(d.months);
  let best = 0;
  let run = 0;
  for (let i = 0; i < 24; i += 1) {
    if (deficit.has((i % 12) + 1)) {
      run += 1;
      if (run > best) best = run;
    } else {
      run = 0;
    }
  }
  return Math.min(best, 12);
}

/**
 * How much rain makes a month wet enough to plant.
 * FAO's Kenya AEZ assessment starts the growing period when moisture supply
 * reaches half of potential evapotranspiration, so where a cell has ET0
 * normals the threshold is 0.5 x ET0 (floor 30 mm). In the ASALs that lifts
 * the bar well above 30 mm, which is the point: 35 mm against 170 mm of ET0
 * germinates a crop and then kills it. Points without normals keep the floor.
 */
export function wetThresholdMm(site, calendarMonth) {
  const et0 = site?.normals_2005_2024?.et0_mm?.[calendarMonth - 1];
  if (Number.isFinite(et0)) return Math.max(WET_MONTH_MM, 0.5 * et0);
  return WET_MONTH_MM;
}

/**
 * The first run of consecutive months from `startKey` whose planned rainfall
 * clears the wet-month threshold: the planting window the household can bank on.
 */
export function wetRunFrom(rows, site, startKey) {
  const sorted = sortByMonth(rows);
  const isWet = (r) => (expectedRainMm(r, site) ?? 0) >= wetThresholdMm(site, r.calendar_month ?? calendarMonth(r.month));
  let i = sorted.findIndex((r) => String(r.month) >= String(startKey) && isWet(r));
  if (i < 0) i = sorted.findIndex(isWet);
  if (i < 0) return null;
  let n = 0;
  while (i + n < sorted.length && isWet(sorted[i + n])) n += 1;
  return { start: sorted[i].month, months: n, tercile: sorted[i].tercile ?? 'unknown' };
}

/**
 * Which staples fit inside the coming wet run, in food-first order.
 * Gates: rainfed, no irrigation requirement, drought tolerance for the tercile,
 * full maturity inside the wet window, and maize only where the annual water
 * balance can carry it.
 */
export function planCrops({ run, tercile = 'unknown', waterBalancePct = null, crops }) {
  const byId = new Map((crops ?? []).map((c) => [c.id, c]));
  const wetDays = run ? run.months * DAYS_PER_MONTH : 0;
  const minTolerance = MIN_TOLERANCE[tercile] ?? MIN_TOLERANCE.below; // unknown plans for the worst
  const plant = [];
  const skip = [];
  for (const id of STAPLE_PRIORITY) {
    const c = byId.get(id);
    if (!c) continue;
    // Maize gets its water-balance verdict first: in a cell that cannot carry
    // it, the honest reason is water, even where the pack also flags it as
    // not rainfed.
    if (id === 'maize' && Number.isFinite(waterBalancePct) && waterBalancePct < MAIZE_WATER_BALANCE_FLOOR) {
      skip.push({ id, en: c.en, sw: c.sw, reason: 'water_balance' });
      continue;
    }
    if (c.rainfed_ok !== true || c.irrigation_required === true) {
      skip.push({ id, en: c.en, sw: c.sw, reason: 'irrigation_only' });
      continue;
    }
    if ((TOLERANCE_RANK[c.drought_tolerance] ?? 0) < minTolerance) {
      skip.push({ id, en: c.en, sw: c.sw, reason: 'drought_risk' });
      continue;
    }
    const late = c.maturity_days?.[1] ?? Infinity;
    if (!run || late > wetDays) {
      skip.push({ id, en: c.en, sw: c.sw, reason: 'maturity_too_long' });
      continue;
    }
    plant.push({
      id,
      en: c.en,
      sw: c.sw,
      purpose: c.purpose ?? null,
      drought_tolerance: c.drought_tolerance,
      maturity_days: c.maturity_days,
      plant_by: run.start,
      harvest: harvestEstimate(run.start, late),
    });
  }
  return { window: run, wet_days: Math.round(wetDays), plant, skip };
}

/**
 * Drinking-water drawdown across the outlook. Supply is roof catchment at the
 * heuristic yield; demand is people x 15 L x real days in the month. The tank
 * size is the deepest cumulative drawdown (a surplus month refills the tank),
 * rounded up to the next 100 L so it maps to something a shop actually sells.
 */
export function waterPlan({ rows, site, roof_m2, people }) {
  const roof = Number(roof_m2);
  const ppl = Number(people);
  // roof 0 is valid: a household that buys water still needs storage sizing.
  if (!Number.isFinite(roof) || roof < 0 || !Number.isFinite(ppl) || ppl <= 0) return null;
  const monthly = [];
  let drawdown = 0;
  let maxDrawdown = 0;
  let maxGap = 0;
  let worst = null;
  let worstGap = null;
  for (const r of sortByMonth(rows)) {
    const rain = expectedRainMm(r, site) ?? 0;
    const supply = rain * roof * CATCH_L_PER_MM_PER_M2;
    const demand = ppl * DRINKING_L_PER_PERSON_DAY * daysInMonth(r.month);
    const gap = Math.max(0, demand - supply);
    if (gap > maxGap) {
      maxGap = gap;
      worstGap = r.month;
    }
    drawdown = gap > 0 ? drawdown + gap : 0;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
      worst = r.month;
    }
    monthly.push({
      month: r.month,
      expected_rain_mm: Math.round(rain * 10) / 10,
      supply_l: Math.round(supply),
      demand_l: Math.round(demand),
      deficit_l: Math.round(gap),
    });
  }
  // With a roof, the tank bridges consecutive deficit months and a surplus
  // month refills it. Without one (bought water) there is no refill to wait
  // for: the honest buffer is the worst single month's demand, not the whole
  // outlook horizon summed.
  const sized = roof > 0 ? maxDrawdown : maxGap;
  return {
    roof_m2: roof,
    people: ppl,
    litres_per_mm_per_m2: CATCH_L_PER_MM_PER_M2,
    drinking_l_per_person_day: DRINKING_L_PER_PERSON_DAY,
    tank_litres: Math.ceil(sized / 100) * 100,
    // The derivation travels with the number: a UI that shows the tank size
    // must be able to show WHY it is that size, from these exact fields.
    tank_basis: {
      method: roof > 0 ? 'cumulative_drawdown' : 'worst_single_month',
      litres_raw: Math.round(sized),
      worst_month: roof > 0 ? worst : worstGap,
    },
    worst_month: roof > 0 ? worst : worstGap,
    monthly,
  };
}

function upcomingLeanKeys(calMonths, now) {
  const out = [];
  for (let i = 0; i < 12 && out.length < 3; i += 1) {
    const key = addMonths(now, i);
    if (calMonths.includes(calendarMonth(key))) out.push(key);
  }
  return out;
}

/**
 * The whole plan: stance, lean calendar, planting window, water plan and the
 * bilingual lines. `outlook` accepts the computeOutlook payload or a bare rows
 * array. `now` is a 'YYYY-MM' key, defaulting to the current UTC month.
 */
export function buildFoodSecurityPlan({
  site,
  outlook,
  crops,
  roof_m2 = 30,
  people = 4,
  dwelling = 'house',
  roof_material = 'iron',
  locale = 'sw',
  now = new Date().toISOString().slice(0, 7),
}) {
  const isFlat = dwelling === 'flat';
  // Thatch is not a harvesting surface at all (Kenyan design practice), so it
  // zeroes the catchment and sends the household down the bought-water route.
  const roofEff = roof_material === 'thatch' ? 0 : Number(roof_m2);
  const rows = sortByMonth(Array.isArray(outlook) ? outlook : outlook?.months ?? []);
  const L = (i18n[locale] ?? i18n.en).food;
  const monthLabel = (key) => L.months[calendarMonth(key) - 1] ?? key;

  const below = rows.filter((r) => r.complete && r.tercile === 'below');
  const stance = below.length >= 3 ? 'prepare_now' : below.length >= 1 ? 'caution' : 'good_season';

  const normals = deficitMonths(site);
  const lean = normals
    ? { basis: 'rain_vs_et0_normals', deficit_count: normals.count, longest_streak: longestDeficitStreak(site), months: normals.months }
    : {
        basis: 'tercile_only',
        deficit_count: null,
        longest_streak: null,
        months: below.map((r) => r.calendar_month ?? calendarMonth(r.month)),
      };

  const rawRun = wetRunFrom(rows, site, now);
  // The window carries its own gate: the rain depth a month needs to count as
  // plantable here (FAO half-ET0 where normals exist, 30 mm floor otherwise),
  // so the UI can state the rule instead of showing an unexplained window.
  const run = rawRun ? { ...rawRun, threshold_mm: Math.round(wetThresholdMm(site, calendarMonth(rawRun.start))) } : null;
  const planting = planCrops({
    run,
    tercile: run?.tercile ?? 'unknown',
    waterBalancePct: site?.annual?.water_balance_pct ?? null,
    crops,
  });
  const water = waterPlan({ rows, site, roof_m2: roofEff, people });

  const leanKeys =
    lean.basis === 'rain_vs_et0_normals'
      ? upcomingLeanKeys(lean.months, now)
      : below.slice(0, 3).map((r) => r.month);

  const place = site?.name ?? site?.ward ?? 'this place';
  const lines = [];
  lines.push(`${L.labels.plan_for} ${place}.`);
  lines.push(`${L.labels.verdict}: ${L.stance[stance]}`);
  if (lean.basis === 'rain_vs_et0_normals' && (lean.longest_streak ?? 0) > 0) {
    lines.push(L.templates.lean_streak(lean.longest_streak));
  }
  const pct = site?.annual?.water_balance_pct;
  if (Number.isFinite(pct) && pct < MAIZE_WATER_BALANCE_FLOOR) {
    lines.push(L.templates.water_balance(pct));
  }
  if (run && planting.plant.length > 0) {
    const names = planting.plant
      .slice(0, 4)
      .map((c) => cropName(c, locale))
      .join(', ');
    lines.push(L.templates.plant_by(names, monthLabel(run.start)));
    // Only a catchment that actually harvests gets cleaned.
    if (roofEff > 0) lines.push(L.templates.clean_catchment(monthLabel(run.start)));
  }
  // Lockdown lesson: a household with no field plan still needs a growing
  // route, and flat dwellers grow in containers even when a planting window
  // exists - the field belongs to someone else.
  if (isFlat || !(run && planting.plant.length > 0)) lines.push(L.templates.balcony);
  if (isFlat && !(roofEff > 0)) lines.push(L.templates.flat_water);
  if (roof_material === 'thatch') lines.push(L.templates.thatch_note);
  if (roof_material === 'tiles') lines.push(L.templates.tiles_note);
  for (const c of planting.plant.filter((x) => DRY_STORE.has(x.id)).slice(0, 2)) {
    lines.push(L.templates.harvest_dry(cropName(c, locale), monthLabel(c.harvest)));
  }
  for (const key of leanKeys) {
    lines.push(L.templates.bridge(monthLabel(key)));
  }
  if (water && water.tank_litres > 0) {
    lines.push(water.roof_m2 > 0 ? L.templates.tank(water.tank_litres) : L.templates.tank_bought(water.tank_litres));
  }

  return {
    data_status: DATA_STATUS,
    caveat: FOOD_CAVEAT,
    sources: SOURCES,
    verify_with: VERIFY_WITH,
    stance,
    below_months: below.length,
    water_balance_pct: site?.annual?.water_balance_pct ?? null,
    lean,
    planting,
    water,
    inputs: { roof_m2: roofEff, people: Number(people), dwelling, roof_material },
    outlook: rows.map((r) => ({
      month: r.month,
      tercile: r.tercile,
      expected_rain_mm: expectedRainMm(r, site),
      confidence: r.confidence,
      complete: r.complete,
    })),
    lines,
    generated_at: new Date().toISOString(),
  };
}
