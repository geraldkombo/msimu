import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  addMonths,
  buildFoodSecurityPlan,
  CATCH_L_PER_MM_PER_M2,
  DATA_STATUS,
  deficitMonths,
  expectedRainMm,
  FOOD_CAVEAT,
  harvestEstimate,
  longestDeficitStreak,
  planCrops,
  SOURCES,
  waterPlan,
  wetRunFrom,
  wetThresholdMm,
} from '../src/foodsecurity.mjs';
import { VERIFY_WITH } from '../src/helpdesk.mjs';
import { TOLERANCE_RANK } from '../src/rules.mjs';
import { crops } from '../src/packs.mjs';

function row(month, { tercile = 'near', median_mm = 40, forecast_mm = null, complete = true } = {}) {
  return {
    month,
    calendar_month: Number(month.slice(5, 7)),
    forecast_mm,
    median_mm,
    anomaly_pct: null,
    tercile,
    confidence: 'medium',
    complete,
  };
}

// Deficit calendar months: 1, 11, 12 (rain median 10/10/10 vs ET0 100).
const rainMedian = [10, 200, 200, 200, 200, 200, 200, 200, 200, 200, 10, 10];
const et0Flat = Array(12).fill(100);

const wardTarget = {
  name: 'Olkerei Onyeka',
  ward: 'Olkerei Onyeka',
  county: 'Kajiado',
  sub_county: 'Kajiado North',
  latitude: -1.4,
  longitude: 36.7,
  agro_ecology: 'semi_arid',
  frost_risk: false,
  normals_2005_2024: { rain_mm: rainMedian, rain_median_mm: rainMedian, et0_mm: et0Flat, tmin_c: Array(12).fill(12) },
  annual: { rain_mm: 1540, et0_mm: 1200, water_balance_pct: 38 },
  p33_mm: Array(12).fill(20),
  p67_mm: Array(12).fill(150),
  sample_years: 20,
};

const pointTarget = { name: 'Embakasi balcony', latitude: -1.28496, longitude: 36.89468, elevation_m: 1625 };

// 60 mm clears both the 30 mm point floor and the ward's FAO half-ET0 bar (0.5 x 100).
const sevenNear = [
  row('2026-11', { median_mm: 60 }), row('2026-12', { median_mm: 60 }), row('2027-01', { median_mm: 60 }),
  row('2027-02', { median_mm: 60 }), row('2027-03', { median_mm: 60 }), row('2027-04', { median_mm: 60 }),
  row('2027-05', { median_mm: 60 }),
];

test('addMonths wraps across the year boundary in both directions', () => {
  assert.equal(addMonths('2026-11', 3), '2027-02');
  assert.equal(addMonths('2026-01', -1), '2025-12');
  assert.equal(addMonths('2026-11', 0), '2026-11');
  assert.equal(addMonths('2026-11', 12), '2027-11');
});

test('harvestEstimate carries a Nov 2026 planting of a 90-day crop to Feb 2027', () => {
  assert.equal(harvestEstimate('2026-11', 90), '2027-02');
  assert.equal(harvestEstimate('2026-11', 60), '2027-01');
  assert.equal(harvestEstimate('2026-11', 30), '2026-12');
});

test('deficitMonths counts rain-below-ET0 months from normals, and stays honest for points', () => {
  const d = deficitMonths(wardTarget);
  assert.deepEqual(d.months, [1, 11, 12]);
  assert.equal(d.count, 3);
  assert.equal(deficitMonths(pointTarget), null, 'a point without normals must not fake a deficit analysis');
});

test('longestDeficitStreak wraps December into January', () => {
  assert.equal(longestDeficitStreak(wardTarget), 3, 'Nov-Dec-Jan must count as one circular streak');
  const wet = { normals_2005_2024: { rain_median_mm: Array(12).fill(200), et0_mm: et0Flat } };
  assert.equal(longestDeficitStreak(wet), 0);
  const arid = { normals_2005_2024: { rain_median_mm: Array(12).fill(5), et0_mm: et0Flat } };
  assert.equal(longestDeficitStreak(arid), 12);
  assert.equal(longestDeficitStreak(pointTarget), null);
});

test('expectedRainMm plans on p33 when below, p67 when above, median otherwise', () => {
  assert.equal(expectedRainMm(row('2026-11', { tercile: 'below', median_mm: 40 }), wardTarget), 20);
  assert.equal(expectedRainMm(row('2026-11', { tercile: 'above', median_mm: 40 }), wardTarget), 150);
  assert.equal(expectedRainMm(row('2026-11', { median_mm: 40 }), wardTarget), 40);
  assert.equal(
    expectedRainMm(row('2026-11', { tercile: 'below', median_mm: null, forecast_mm: 33 }), wardTarget),
    20,
    'below still prefers p33 over a null median',
  );
  assert.equal(
    expectedRainMm(row('2026-11', { tercile: 'below', median_mm: 40 }), pointTarget),
    40,
    'a point without tercile bands degrades to the median',
  );
});

test('wetRunFrom finds the first consecutive wet run from the planning month', () => {
  const rows = [
    row('2026-11', { median_mm: 10 }),
    row('2026-12', { median_mm: 40 }),
    row('2027-01', { median_mm: 50 }),
    row('2027-02', { median_mm: 20 }),
  ];
  const run = wetRunFrom(rows, pointTarget, '2026-11');
  assert.equal(run.start, '2026-12');
  assert.equal(run.months, 2);
  const late = wetRunFrom(rows, pointTarget, '2027-01');
  assert.equal(late.start, '2027-01');
  assert.equal(late.months, 1);
  const dry = wetRunFrom([row('2026-11', { median_mm: 5 }), row('2026-12', { median_mm: 8 })], pointTarget, '2026-11');
  assert.equal(dry, null);
});

test('wards use the FAO Kenya half-ET0 rule for wet months; points keep the 30 mm floor', () => {
  assert.equal(wetThresholdMm(wardTarget, 1), 50, '0.5 x 100 mm ET0 normal');
  assert.equal(wetThresholdMm(pointTarget, 1), 30, 'no normals, no fake precision');
  const rows = [
    row('2026-11', { median_mm: 10 }),
    row('2026-12', { median_mm: 40 }),
    row('2027-01', { median_mm: 50 }),
    row('2027-02', { median_mm: 20 }),
  ];
  const wardRun = wetRunFrom(rows, wardTarget, '2026-11');
  assert.equal(wardRun.start, '2027-01', '40 mm against 100 mm ET0 does not make a planting month');
  assert.equal(wardRun.months, 1);
  const pointRun = wetRunFrom(rows, pointTarget, '2026-11');
  assert.equal(pointRun.start, '2026-12');
  assert.equal(pointRun.months, 2);
});

test('roof catchment yields 0.72 L per mm per m2, so 30 mm on 30 m2 is 648 L', () => {
  assert.ok(Math.abs(CATCH_L_PER_MM_PER_M2 - 0.72) < 1e-9, '0.8 runoff x 0.9 first-flush = 0.72, declared heuristic');
  const w = waterPlan({ rows: [row('2026-11', { median_mm: 30 })], site: wardTarget, roof_m2: 30, people: 4 });
  assert.equal(w.monthly[0].supply_l, 648);
  assert.equal(w.monthly[0].demand_l, 1800, '4 people x 15 L x 30 days');
});

test('tank size is the deepest cumulative drawdown, rounded up to 100 L, reset by a surplus month', () => {
  const rows = [
    row('2026-11', { median_mm: 30 }),
    row('2026-12', { median_mm: 30 }),
    row('2027-01', { median_mm: 300 }),
  ];
  const w = waterPlan({ rows, site: wardTarget, roof_m2: 30, people: 4 });
  // Nov gap 1152, Dec gap 1212 -> drawdown 2364; Jan surplus refills.
  assert.equal(w.tank_litres, 2400);
  assert.equal(w.worst_month, '2026-12');
  assert.equal(w.monthly.length, 3);
});

test('a roof-0 balcony household still gets a bought-water storage number', () => {
  const rows = [
    row('2026-11', { median_mm: 30 }),
    row('2026-12', { median_mm: 30 }),
    row('2027-01', { median_mm: 300 }),
  ];
  const w = waterPlan({ rows, site: pointTarget, roof_m2: 0, people: 4 });
  assert.equal(w.monthly[0].supply_l, 0);
  // No catchment means no refill month: the buffer is the worst single month's
  // demand (4 x 15 x 31 = 1860), rounded up to the next 100 L.
  assert.equal(w.tank_litres, 1900);
  assert.equal(w.worst_month, '2026-12');
  assert.equal(waterPlan({ rows, site: pointTarget, roof_m2: -5, people: 4 }), null, 'negative roof is rejected');
});

test('planCrops gates on the wet window: a 1-month run cannot carry a 70-day cowpea, a 6-month run can', () => {
  const short = planCrops({ run: { start: '2026-11', months: 1, tercile: 'near' }, tercile: 'near', crops });
  assert.equal(short.plant.length, 0);
  assert.ok(short.skip.some((s) => s.id === 'cowpea' && s.reason === 'maturity_too_long'));
  const long = planCrops({ run: { start: '2026-11', months: 6, tercile: 'near' }, tercile: 'near', crops });
  const cowpea = long.plant.find((p) => p.id === 'cowpea');
  assert.ok(cowpea, 'cowpea fits a 6-month wet run');
  assert.equal(cowpea.harvest, '2027-02', 'plant by Nov 2026 + 70-day maturity');
  for (const p of long.plant) {
    assert.ok(p.maturity_days[1] <= long.wet_days, `${p.id} must mature inside the wet window`);
  }
});

test('maize is skipped below a 60% water balance and never for water balance above it', () => {
  const run = { start: '2026-11', months: 12, tercile: 'near' };
  const dry = planCrops({ run, tercile: 'near', waterBalancePct: 38, crops });
  assert.ok(dry.skip.some((s) => s.id === 'maize' && s.reason === 'water_balance'));
  const wetter = planCrops({ run, tercile: 'near', waterBalancePct: 80, crops });
  assert.ok(!wetter.skip.some((s) => s.id === 'maize' && s.reason === 'water_balance'));
});

test('a below-normal window only plants drought-tolerant crops, and no window plants nothing', () => {
  const below = planCrops({ run: { start: '2026-11', months: 12, tercile: 'below' }, tercile: 'below', crops });
  assert.ok(below.plant.length > 0, 'a 12-month window in a below-normal season must still offer hardy staples');
  for (const p of below.plant) {
    assert.ok(TOLERANCE_RANK[p.drought_tolerance] >= 2, `${p.id} must tolerate drought in a below-normal window`);
  }
  const none = planCrops({ run: null, tercile: 'near', crops });
  assert.equal(none.plant.length, 0);
  assert.equal(none.wet_days, 0);
});

test('stance follows the count of below-normal months: 3+ prepare, 1-2 caution, 0 good season', () => {
  const mk = (belowCount) => {
    const rows = sevenNear.map((r, i) => (i < belowCount ? row(r.month, { tercile: 'below', median_mm: 10 }) : r));
    return buildFoodSecurityPlan({ site: pointTarget, outlook: { months: rows }, crops, now: '2026-11' });
  };
  assert.equal(mk(3).stance, 'prepare_now');
  assert.equal(mk(3).below_months, 3);
  assert.equal(mk(1).stance, 'caution');
  assert.equal(mk(0).stance, 'good_season');
});

test('wards get the normals-based lean analysis; points degrade to tercile_only, explicitly', () => {
  const ward = buildFoodSecurityPlan({ site: wardTarget, outlook: { months: sevenNear }, crops, now: '2026-11' });
  assert.equal(ward.lean.basis, 'rain_vs_et0_normals');
  assert.equal(ward.lean.deficit_count, 3);
  assert.equal(ward.lean.longest_streak, 3);
  assert.deepEqual(ward.lean.months, [1, 11, 12]);
  const point = buildFoodSecurityPlan({ site: pointTarget, outlook: { months: sevenNear }, crops, now: '2026-11' });
  assert.equal(point.lean.basis, 'tercile_only');
  assert.equal(point.lean.deficit_count, null);
  assert.equal(point.lean.longest_streak, null);
});

test('the payload declares its heuristic status and renders bilingual lines', () => {
  const sw = buildFoodSecurityPlan({ site: wardTarget, outlook: { months: sevenNear }, crops, locale: 'sw', now: '2026-11' });
  assert.equal(sw.data_status, DATA_STATUS);
  assert.equal(sw.data_status, 'planning_heuristic');
  assert.equal(sw.caveat, FOOD_CAVEAT);
  assert.ok(sw.caveat.length > 40, 'the caveat must actually explain the limitation');
  assert.ok(sw.lines[0].startsWith('Mpango wa usalama wa chakula wa Olkerei Onyeka'));
  assert.deepEqual(sw.inputs, { roof_m2: 30, people: 4, dwelling: 'house', roof_material: 'iron' });
  assert.equal(sw.outlook.length, 7);
  assert.ok(sw.water.tank_litres > 0);
  assert.ok(sw.lines.some((l) => l.includes('Safisha paa')), 'the catchment-clean line must precede the rains');
  assert.ok(sw.lines.some((l) => l.includes('uhaba')), 'lean months must carry a bridge action');
  assert.ok(sw.sources.length >= 6, 'the evidence travels with the plan');
  assert.ok(sw.sources.some((s) => s.url.includes('spherestandards')), 'the 15 L allowance must cite Sphere');
  assert.deepEqual(sw.sources, SOURCES);
  const en = buildFoodSecurityPlan({ site: wardTarget, outlook: { months: sevenNear }, crops, locale: 'en', now: '2026-11' });
  assert.ok(en.lines[0].startsWith('Food security plan for'));
});

test('a balcony household with no planting window is routed to containers, not left empty-handed', () => {
  const dryRows = sevenNear.map((r) => row(r.month, { tercile: 'below', median_mm: 10 }));
  const plan = buildFoodSecurityPlan({
    site: pointTarget,
    outlook: { months: dryRows },
    crops,
    roof_m2: 0,
    people: 2,
    locale: 'sw',
    now: '2026-11',
  });
  assert.equal(plan.planting.plant.length, 0);
  assert.equal(plan.planting.window, null);
  assert.ok(plan.lines.some((l) => l.includes('Huna shamba?')), 'the no-land line points to container growing');
  assert.ok(plan.lines.some((l) => l.startsWith('Ukinunua maji')), 'roof 0 gets the bought-water storage line');
  assert.equal(plan.stance, 'prepare_now');
});

test('flat dwellers get the bought-water and container route, not a roof they do not own', () => {
  const flat = buildFoodSecurityPlan({ site: wardTarget, outlook: { months: sevenNear }, crops, dwelling: 'flat', roof_m2: 0, locale: 'en', now: '2026-11' });
  assert.equal(flat.inputs.dwelling, 'flat');
  assert.ok(flat.lines.some((l) => l.includes('containers')), 'the container-growing route is always offered to flats');
  assert.ok(flat.lines.some((l) => l.includes('boil or treat')), 'bought-water safety line for flats without a roof share');
  assert.ok(!flat.lines.some((l) => l.includes('Clean the roof')), 'no private roof, no roof-cleaning chore');

  const share = buildFoodSecurityPlan({ site: wardTarget, outlook: { months: sevenNear }, crops, dwelling: 'flat', roof_m2: 12, locale: 'en', now: '2026-11' });
  assert.ok(share.lines.some((l) => l.includes('Clean the roof')), 'a stated roof share keeps the catchment chore');
  assert.ok(!share.lines.some((l) => l.includes('boil or treat')), 'harvested rain replaces the bought-water line');

  const house = buildFoodSecurityPlan({ site: wardTarget, outlook: { months: sevenNear }, crops, locale: 'en', now: '2026-11' });
  assert.equal(house.inputs.dwelling, 'house');
  assert.ok(house.lines.some((l) => l.includes('Clean the roof')), 'the landed household keeps the catchment chore');
  assert.ok(!house.lines.some((l) => l.includes('containers')), 'a house with a planting window is not told to farm its balcony');

  const swFlat = buildFoodSecurityPlan({ site: wardTarget, outlook: { months: sevenNear }, crops, dwelling: 'flat', roof_m2: 0, locale: 'sw', now: '2026-11' });
  assert.ok(swFlat.lines.some((l) => l.includes('chemsha')), 'the Swahili flat plan carries the water-safety line');
});

test('roof material changes the water route: thatch cannot harvest, tiles warn', () => {
  const thatch = buildFoodSecurityPlan({ site: wardTarget, outlook: { months: sevenNear }, crops, roof_material: 'thatch', roof_m2: 30, locale: 'en', now: '2026-11' });
  assert.equal(thatch.inputs.roof_m2, 0, 'thatch zeroes the catchment');
  assert.equal(thatch.inputs.roof_material, 'thatch');
  assert.ok(thatch.lines.some((l) => l.includes('thatch roof cannot harvest')), 'the plan says why in plain words');
  assert.ok(!thatch.lines.some((l) => l.includes('Clean the roof')), 'nothing to clean on thatch');

  const tiles = buildFoodSecurityPlan({ site: wardTarget, outlook: { months: sevenNear }, crops, roof_material: 'tiles', roof_m2: 30, locale: 'en', now: '2026-11' });
  assert.equal(tiles.inputs.roof_m2, 30);
  assert.ok(tiles.lines.some((l) => l.includes('best case')), 'tiles carry the honest caveat');

  const iron = buildFoodSecurityPlan({ site: wardTarget, outlook: { months: sevenNear }, crops, locale: 'en', now: '2026-11' });
  assert.ok(!iron.lines.some((l) => l.includes('best case')) && !iron.lines.some((l) => l.includes('thatch roof')), 'iron sheet needs no caveat');
});

test('the plan ships the verification desk with every payload', () => {
  const plan = buildFoodSecurityPlan({ site: wardTarget, outlook: { months: sevenNear }, crops, locale: 'en', now: '2026-11' });
  assert.ok((plan.verify_with ?? []).length >= 4, 'the desk travels with the plan');
  assert.ok(plan.verify_with.some((v) => v.id === 'kephis_seed'));
  assert.deepEqual(plan.verify_with, VERIFY_WITH);
});

test('the payload exposes the facts the dashboard visualises, so no number renders unexplained', () => {
  const plan = buildFoodSecurityPlan({ site: wardTarget, outlook: { months: sevenNear }, crops, locale: 'en', now: '2026-11' });
  // Water balance ships at the top level so the maize exclusion can quote it.
  assert.equal(plan.water_balance_pct, 38);
  // wardTarget ET0 = 100 -> the FAO half-ET0 gate is 50 mm, stated in the window.
  assert.equal(plan.planting.window?.threshold_mm, 50);
  // The tank size carries its derivation: method, raw litres, worst month.
  assert.equal(plan.water.tank_basis.method, 'cumulative_drawdown');
  assert.equal(plan.water.tank_basis.worst_month, plan.water.worst_month);
  assert.equal(plan.water.drinking_l_per_person_day, 15, 'the Sphere allowance ships with the payload so no UI hardcodes it');
  assert.ok(Number.isFinite(plan.water.tank_basis.litres_raw));
  assert.equal(plan.water.tank_litres, Math.ceil(plan.water.tank_basis.litres_raw / 100) * 100);
  const bought = waterPlan({ rows: sevenNear, site: wardTarget, roof_m2: 0, people: 4 });
  assert.equal(bought.tank_basis.method, 'worst_single_month');
  // Skips carry the crop's own names so the UI can explain exclusions without
  // a second copy of the crop pack.
  const maize = plan.planting.skip.find((s) => s.id === 'maize');
  assert.equal(maize.reason, 'water_balance');
  assert.equal(maize.en, 'Maize');
  assert.equal(maize.sw, 'Mahindi');
  for (const s of plan.planting.skip) {
    assert.ok(s.en && s.sw, `every skip entry is nameable in both languages: ${s.id}`);
    assert.ok(['water_balance', 'irrigation_only', 'drought_risk', 'maturity_too_long'].includes(s.reason));
  }
});
