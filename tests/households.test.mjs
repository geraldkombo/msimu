import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  COUNTY_HOUSEHOLD_SIZE,
  NATIONAL_HOUSEHOLD_SIZE,
  countyHouseholdSize,
  defaultHouseholdPeople,
  normalizeCounty,
} from '../src/households.mjs';

test('the table holds all 47 counties and the national mean', () => {
  assert.equal(Object.keys(COUNTY_HOUSEHOLD_SIZE).length, 47);
  assert.equal(NATIONAL_HOUSEHOLD_SIZE, 3.9);
  for (const [k, v] of Object.entries(COUNTY_HOUSEHOLD_SIZE)) {
    assert.equal(k, normalizeCounty(k), `key "${k}" must already be normalized`);
    assert.ok(v >= 2 && v <= 8, `${k}: ${v} outside the plausible KNBS range`);
  }
});

test('county lookup survives the spellings used in data/wards.json', () => {
  assert.equal(countyHouseholdSize('Tharaka'), 3.6, 'wards.json alias for Tharaka Nithi');
  assert.equal(countyHouseholdSize("Murang'a"), 3.3, 'apostrophe folded away');
  assert.equal(countyHouseholdSize('Elgeyo-Marakwet'), 4.5, 'hyphen folded to space');
  assert.equal(countyHouseholdSize('TAITA TAVETA'), 3.5, 'case-insensitive');
  assert.equal(countyHouseholdSize('Kajiado'), 3.5);
  assert.equal(countyHouseholdSize('Nowhere Land'), null);
  assert.equal(countyHouseholdSize(null), null);
});

test('the default rounds the county mean UP, the safe direction for a water plan', () => {
  assert.deepEqual(defaultHouseholdPeople('Nairobi'), { people: 3, basis: 'knbs_2019_county', mean_size: 2.9 });
  assert.deepEqual(defaultHouseholdPeople('Kajiado'), { people: 4, basis: 'knbs_2019_county', mean_size: 3.5 });
  assert.deepEqual(defaultHouseholdPeople('Mandera'), { people: 7, basis: 'knbs_2019_county', mean_size: 6.9 });
  assert.deepEqual(defaultHouseholdPeople('Makueni'), { people: 4, basis: 'knbs_2019_county', mean_size: 4.0 });
});

test('an unknown or missing county falls back to the national mean, rounded up', () => {
  assert.deepEqual(defaultHouseholdPeople('Nowhere Land'), { people: 4, basis: 'knbs_2019_national', mean_size: 3.9 });
  assert.deepEqual(defaultHouseholdPeople(null), { people: 4, basis: 'knbs_2019_national', mean_size: 3.9 });
  assert.deepEqual(defaultHouseholdPeople(undefined).people, 4);
});
