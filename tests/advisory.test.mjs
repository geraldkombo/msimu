import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { seasonForMonth, isPlantingWindow, selectCrops, livestockAdvice, earlyWarning } from '../src/rules.mjs';
import { buildAdvisory } from '../src/advisory.mjs';
import { pickActiveMonth } from '../src/cli.mjs';
import { i18n } from '../src/i18n.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const crops = JSON.parse(readFileSync(join(here, '..', 'data', 'crops.json'), 'utf8')).crops;
const sites = JSON.parse(readFileSync(join(here, '..', 'data', 'sites.json'), 'utf8'));
const gataka = sites.gataka;

test('season mapping follows the real Kenyan bimodal calendar', () => {
  assert.equal(seasonForMonth(11), 'short_rains');
  assert.equal(seasonForMonth(4), 'long_rains');
  assert.equal(seasonForMonth(7), 'dry_jun_sep');
  assert.equal(seasonForMonth(1), 'dry_jan_feb');
  assert.ok(isPlantingWindow('short_rains'));
  assert.ok(!isPlantingWindow('dry_jun_sep'));
});

test('below-normal short rains: drought-tolerant in, maize and irrigated veg out', () => {
  const d = selectCrops({ tercile: 'below', month: 11, waterBalancePct: 44, crops });
  const ids = d.recommended.map((c) => c.id);
  assert.ok(ids.includes('cowpea'), 'cowpea must survive a below-normal short rain');
  assert.ok(ids.includes('sorghum'), 'sorghum must survive a below-normal short rain');
  assert.ok(!ids.includes('maize'), 'rainfed maize must never be recommended at a 44% water balance');
  assert.ok(!ids.includes('tomato'), 'irrigation-only crops must be excluded without irrigation');
  assert.ok(
    d.avoid.some((a) => a.crop.id === 'maize' && ['water_balance', 'needs_irrigation'].includes(a.reason)),
    'maize must be actively avoided, with a stated reason',
  );
  assert.ok(d.warnings.some((w) => w.code === 'water_balance'), 'the water-balance constraint must always be surfaced');
  assert.ok(d.warnings.some((w) => w.code === 'deficit'));
});

test('near-normal short rains widen the choice but still exclude rainfed maize', () => {
  const d = selectCrops({ tercile: 'near', month: 11, waterBalancePct: 44, crops });
  const ids = d.recommended.map((c) => c.id);
  assert.ok(ids.includes('cowpea') && ids.includes('greengram'));
  assert.ok(!ids.includes('maize'));
  assert.equal(d.warnings.some((w) => w.code === 'deficit'), false);
});

test('irrigation unlocks the high-value horticulture the extension officer recommends', () => {
  const d = selectCrops({ tercile: 'near', month: 11, waterBalancePct: 44, irrigation: true, crops });
  const ids = d.recommended.map((c) => c.id);
  assert.ok(ids.includes('tomato'), 'tomato is officer-recommended and must appear under irrigation');
  assert.ok(ids.includes('kales'), 'kales is officer-recommended and must appear under irrigation');
});

test('above-normal rain adds the waterlogging and disease warning', () => {
  const d = selectCrops({ tercile: 'above', month: 4, waterBalancePct: 44, crops });
  assert.ok(d.warnings.some((w) => w.code === 'excess_rain'));
});

test('dry season is honestly reported as not a planting window', () => {
  const d = selectCrops({ tercile: 'near', month: 7, waterBalancePct: 44, crops });
  assert.equal(d.planting, false);
  assert.equal(d.recommended.some((c) => c.id === 'tomato'), false);
});

test('recommendations are ordered most drought-tolerant and shortest-cycle first', () => {
  const d = selectCrops({ tercile: 'below', month: 11, waterBalancePct: 44, crops });
  assert.ok(d.recommended.length >= 2);
  assert.ok(d.recommended[0].maturity_days[1] <= d.recommended.at(-1).maturity_days[1]);
});

test('livestock track fires on dry season and on below-normal rain', () => {
  const dry = livestockAdvice({ tercile: 'near', month: 7 });
  assert.ok(dry.includes('water_pans'));
  assert.ok(dry.includes('destock_early'));
  const wet = livestockAdvice({ tercile: 'above', month: 4 });
  assert.ok(wet.includes('tick_and_worm'));
  assert.ok(wet.includes('move_off_low_ground'));
  assert.ok(livestockAdvice({ tercile: 'near', month: 11 }).includes('establish_fodder'));
});

test('early warning escalates and never invents confidence on missing data', () => {
  assert.equal(earlyWarning({ tercile: 'near', season: 'long_rains' }).level, 'normal');
  assert.equal(earlyWarning({ tercile: 'below', season: 'long_rains' }).level, 'watch');
  assert.equal(earlyWarning({ tercile: 'below', season: 'dry_jun_sep' }).level, 'alert');
  assert.equal(earlyWarning({ tercile: 'above', season: 'short_rains' }).level, 'watch');
  assert.equal(earlyWarning({ tercile: 'unknown', season: 'short_rains' }).level, 'no_data');
});

test('every early-warning and livestock key is translated in both locales', () => {
  const ewKeys = Object.keys(i18n.en.early_warning);
  const lsKeys = Object.keys(i18n.en.livestock);
  for (const loc of ['en', 'sw']) {
    for (const k of ewKeys) {
      assert.ok(i18n[loc].early_warning[k]?.length > 10, `${loc}.early_warning.${k} missing`);
    }
    for (const k of lsKeys) {
      assert.ok(i18n[loc].livestock[k]?.length > 10, `${loc}.livestock.${k} missing`);
    }
  }
});

test('Swahili advisory is a decision, not a dataset', () => {
  const a = buildAdvisory({ site: gataka, tercile: 'near', confidence: 'high', month: 11, locale: 'sw', crops });
  assert.ok(/Kunde|Ndengu/.test(a.text), 'must name a real crop in Swahili');
  assert.ok(/Panda/i.test(a.text), 'must contain an instruction to plant');
  assert.ok(/44%/.test(a.text), 'must state the water balance constraint');
  assert.ok(a.text.length < 1600, 'must stay short enough for SMS/USSD paging');
  assert.equal(a.structured.recommended.length > 0, true);
  assert.ok(a.structured.avoid.some((x) => x.id === 'maize'));
});

test('English advisory renders and carries provenance', () => {
  const a = buildAdvisory({ site: gataka, tercile: 'above', confidence: 'medium', month: 4, locale: 'en', crops });
  assert.ok(/Plant /i.test(a.text));
  assert.ok(/ECMWF SEAS5/.test(a.text), 'must attribute the forecast source');
  assert.ok(/ERA5/.test(a.text), 'must attribute the baseline');
});

test('unknown tercile degrades safely instead of inventing advice', () => {
  const a = buildAdvisory({ site: gataka, tercile: 'unknown', confidence: 'none', month: 11, locale: 'sw', crops });
  assert.ok(/haijulikani/i.test(a.text), 'must say the outlook is unknown, in Swahili');
  assert.equal(a.structured.early_warning, 'no_data');
  assert.ok(a.text.includes(i18n.sw.early_warning.no_data), 'must render the localized no-data warning');
});

test('Swahili advisory carries no untranslated English advisory sentences', () => {
  const a = buildAdvisory({ site: gataka, tercile: 'below', confidence: 'high', month: 7, locale: 'sw', crops });
  for (const en of Object.values(i18n.en.livestock)) {
    assert.ok(!a.text.includes(en), `English livestock text leaked into the Swahili advisory: ${en.slice(0, 40)}`);
  }
  for (const en of Object.values(i18n.en.early_warning)) {
    assert.ok(!a.text.includes(en), `English warning leaked into the Swahili advisory: ${en.slice(0, 40)}`);
  }
});

test('pickActiveMonth selects the current calendar month from a live outlook', () => {
  const months = [
    { month: '2026-11', calendar_month: 11, tercile: 'near', confidence: 'high' },
    { month: '2026-12', calendar_month: 12, tercile: 'near', confidence: 'high' },
  ];
  assert.equal(pickActiveMonth(months, new Date('2026-11-15T00:00:00Z')).month, '2026-11');
  assert.equal(pickActiveMonth(months, new Date('2027-06-01T00:00:00Z')).month, '2026-11', 'falls back to first');
});
