import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  buildKitchenAdvisory,
  containers,
  DATA_STATUS_CAVEAT,
  kitchenProvenance,
  lightClass,
  suitableContainers,
  wateringFromEt0,
} from '../src/kitchen.mjs';
import { crops } from '../src/packs.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const kitchen = JSON.parse(readFileSync(join(here, '..', 'data', 'kitchen.json'), 'utf8'));

const site = {
  name: 'Embakasi flat',
  latitude: -1.28496,
  longitude: 36.89468,
  county: 'Nairobi',
  ward: 'Umoja II',
  sub_county: 'Embakasi West',
  elevation_m: 1625,
};

test('watering bands follow FAO ET0 monotonically, and unknown ET0 stays unknown', () => {
  assert.equal(wateringFromEt0(1.8).frequency, 'every_3_days');
  assert.equal(wateringFromEt0(3.0).frequency, 'every_2_days');
  assert.equal(wateringFromEt0(4.5).frequency, 'daily');
  assert.equal(wateringFromEt0(6.2).frequency, 'twice_daily');
  assert.equal(wateringFromEt0(NaN).frequency, 'unknown');
  assert.equal(wateringFromEt0(undefined).frequency, 'unknown');
  assert.equal(wateringFromEt0(4.5).basis, 'heuristic_from_fao_et0', 'the basis must be declared as a heuristic');
});

test('every container profile carries the fields the UI needs', () => {
  for (const c of containers) {
    assert.ok(c.crop_id, 'crop_id is required');
    assert.ok(c.min_depth_cm > 0, `${c.crop_id} needs a depth`);
    assert.ok(c.min_volume_litres > 0, `${c.crop_id} needs a volume`);
    assert.equal(c.days_to_first_harvest.length, 2);
    assert.ok(c.days_to_first_harvest[0] <= c.days_to_first_harvest[1], 'harvest range must be ordered');
    assert.ok(c.notes_en && c.notes_sw, `${c.crop_id} needs both locales`);
    assert.ok(crops.some((x) => x.id === c.crop_id), `${c.crop_id} must exist in the crop pack`);
  }
});

test('the draft status of container numbers is declared, not hidden', () => {
  assert.equal(kitchenProvenance.status, 'unverified_draft');
  assert.match(kitchenProvenance.warning, /NOT measured Kenyan trial data/);
  const adv = buildKitchenAdvisory({ site, crops });
  assert.equal(adv.data_status, 'unverified_draft');
  assert.equal(adv.caveat, DATA_STATUS_CAVEAT);
  assert.ok(adv.caveat.length > 40, 'the caveat must actually explain the limitation');
});

test('lightClass maps balcony aspect to a usable light class', () => {
  assert.equal(lightClass('full_sun'), 'full_sun_only');
  assert.equal(lightClass('shaded'), 'shade_tolerant_only');
  assert.equal(lightClass('morning_sun'), 'part_shade_ok');
  assert.equal(lightClass('nonsense'), 'part_shade_ok', 'unknown aspect degrades safely');
  assert.equal(lightClass(undefined), 'part_shade_ok');
});

test('a shaded balcony cannot grow fruiting crops', () => {
  const shaded = suitableContainers({ light: 'shade_tolerant_only', month: 11, tercile: 'near' });
  const ids = shaded.ranked.map((r) => r.crop_id);
  assert.ok(!ids.includes('tomato'), 'tomato needs full sun');
  assert.ok(ids.includes('amaranth'), 'leafy greens should survive shade');
  const sunny = suitableContainers({ light: 'full_sun_only', month: 11, tercile: 'near' });
  assert.ok(sunny.ranked.some((r) => r.crop_id === 'tomato'), 'full sun should offer tomato');
  assert.ok(sunny.ranked.length > shaded.ranked.length, 'more light means more options');
});

test('a dry tercile promotes drought-tolerant crops and demotes tomato', () => {
  const dry = suitableContainers({ light: 'full_sun_only', month: 11, tercile: 'below' });
  const wet = suitableContainers({ light: 'full_sun_only', month: 11, tercile: 'above' });
  const rank = (list, id) => list.ranked.findIndex((r) => r.crop_id === id);
  assert.ok(rank(dry, 'cowpea') < rank(wet, 'cowpea'), 'cowpea should rank higher when dry');
  assert.ok(rank(dry, 'tomato') > rank(wet, 'tomato'), 'tomato should rank lower when dry');
});

test('the season is derived from the month, not hardcoded', () => {
  assert.equal(suitableContainers({ month: 11 }).season, 'short_rains');
  assert.equal(suitableContainers({ month: 4 }).season, 'long_rains');
  assert.equal(suitableContainers({ month: 7 }).season, 'dry_jun_sep');
  assert.equal(suitableContainers({ month: 1 }).season, 'dry_jan_feb');
});

test('an Embakasi flat with bought water and a dry outlook gets the right warnings', () => {
  const adv = buildKitchenAdvisory({
    site,
    et0: 4.6,
    tercile: 'below',
    month: 11,
    aspect: 'shaded',
    waterSource: 'purchased',
    locale: 'en',
    crops,
  });
  const codes = adv.warnings.map((w) => w.code);
  assert.ok(codes.includes('dry_season_outlook'));
  assert.ok(codes.includes('bought_water'));
  assert.ok(codes.includes('shaded_site'));
  assert.equal(adv.watering.frequency, 'daily');
  assert.equal(adv.season, 'short_rains');
  assert.equal(adv.site.county, 'Nairobi');
  assert.ok(adv.recommended.length > 0);
  assert.ok(adv.unsuitable.length > 0, 'the household should also be told what will not work');
});

test('high elevation raises a frost warning and low elevation does not', () => {
  const high = buildKitchenAdvisory({ site: { ...site, elevation_m: 2600 }, crops });
  assert.ok(high.warnings.some((w) => w.code === 'frost_risk'));
  const low = buildKitchenAdvisory({ site, crops });
  assert.ok(!low.warnings.some((w) => w.code === 'frost_risk'));
});

test('Swahili output uses Swahili names and notes', () => {
  const adv = buildKitchenAdvisory({ site, locale: 'sw', aspect: 'full_sun', month: 11, crops });
  const names = adv.recommended.map((r) => r.name).join(' ');
  assert.match(names, /Terere|Sukuma|Kunde|Nyanya/, 'Swahili crop names should appear');
  assert.ok(adv.recommended[0].notes.length > 10);
  const en = buildKitchenAdvisory({ site, locale: 'en', aspect: 'full_sun', month: 11, crops });
  assert.notEqual(en.recommended[0].notes, adv.recommended[0].notes, 'locales must not be identical');
});

test('the advisory requires a site', () => {
  assert.throws(() => buildKitchenAdvisory({}), /needs a site/);
});

test('an unknown aspect still produces advice rather than nothing', () => {
  const adv = buildKitchenAdvisory({ site, aspect: 'unknown', crops });
  assert.ok(adv.recommended.length > 0);
  assert.equal(adv.light, 'part_shade_ok');
});
