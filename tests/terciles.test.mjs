import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  quantile,
  tercileBands,
  classify,
  classifyByRatio,
  anomalyPercent,
  monthlyTotals,
  groupHistoryByCalendarMonth,
  confidenceFromSampleSize,
} from '../src/terciles.mjs';

test('quantile interpolates between points', () => {
  assert.equal(quantile([0, 10], 0.5), 5);
  assert.equal(quantile([0, 10, 20], 0.5), 10);
  assert.equal(quantile([5], 0.9), 5);
  assert.equal(quantile([], 0.5), null);
});

test('tercileBands splits history into thirds', () => {
  const bands = tercileBands([10, 20, 30, 40, 50, 60]);
  assert.equal(bands.n, 6);
  assert.ok(bands.p33 < bands.p67);
});

test('classify returns below / near / above', () => {
  const bands = tercileBands([10, 20, 30, 40, 50, 60]);
  assert.equal(classify(5, bands), 'below');
  assert.equal(classify(35, bands), 'near');
  assert.equal(classify(70, bands), 'above');
  assert.equal(classify(null, bands), 'unknown');
});

test('classifyByRatio uses the documented +/-20% band', () => {
  assert.equal(classifyByRatio(96, 99), 'near');
  assert.equal(classifyByRatio(184, 142), 'above');
  assert.equal(classifyByRatio(9, 42), 'below');
  assert.equal(classifyByRatio(10, 0), 'unknown');
});

test('anomalyPercent is signed and rounded', () => {
  assert.equal(anomalyPercent(184, 142), 30);
  assert.equal(anomalyPercent(9, 42), -79);
  assert.equal(anomalyPercent(50, 0), null);
});

test('monthlyTotals aggregates daily to month and skips nulls', () => {
  const times = ['2026-11-01', '2026-11-02', '2026-12-01'];
  const vals = [10, null, 5];
  const m = monthlyTotals(times, vals);
  assert.equal(m.get('2026-11'), 10);
  assert.equal(m.get('2026-12'), 5);
});

test('groupHistoryByCalendarMonth pools the same month across years', () => {
  const times = ['2005-11-15', '2006-11-15', '2005-04-15'];
  const vals = [80, 120, 140];
  const g = groupHistoryByCalendarMonth(times, vals);
  assert.deepEqual(g.get(11).sort((a, b) => a - b), [80, 120]);
  assert.deepEqual(g.get(4), [140]);
});

test('confidenceFromSampleSize degrades with thin history', () => {
  assert.equal(confidenceFromSampleSize(20), 'high');
  assert.equal(confidenceFromSampleSize(10), 'medium');
  assert.equal(confidenceFromSampleSize(4), 'low');
  assert.equal(confidenceFromSampleSize(1), 'none');
});

test('REGRESSION on verified live data: Gataka SEAS5 outlook 2026-10-28 vs ERA5 normals', () => {
  const verified = [
    { month: '2026-11', forecast: 96, normal: 99, expect: 'near' },
    { month: '2026-12', forecast: 54, normal: 58, expect: 'near' },
    { month: '2027-01', forecast: 31, normal: 36, expect: 'near' },
    { month: '2027-02', forecast: 9, normal: 42, expect: 'below' },
    { month: '2027-03', forecast: 146, normal: 68, expect: 'above' },
    { month: '2027-04', forecast: 184, normal: 142, expect: 'above' },
  ];
  for (const v of verified) {
    assert.equal(classifyByRatio(v.forecast, v.normal), v.expect, `${v.month} misclassified`);
  }
});

test('the seasonal source reproduces the bimodal regime at Gataka', () => {
  const normals = { 1: 36, 2: 42, 3: 68, 4: 142, 5: 81, 6: 35, 7: 17, 8: 24, 9: 26, 10: 57, 11: 99, 12: 58 };
  const shortPeak = Object.entries(normals).filter(([m]) => [10, 11, 12].includes(Number(m))).sort((a, b) => b[1] - a[1])[0];
  const longPeak = Object.entries(normals).filter(([m]) => [3, 4, 5].includes(Number(m))).sort((a, b) => b[1] - a[1])[0];
  assert.equal(shortPeak[0], '11', 'short rains must peak in November');
  assert.equal(longPeak[0], '4', 'long rains must peak in April');
  assert.ok(shortPeak[1] > normals[1] && shortPeak[1] > normals[2], 'Jan-Feb must be drier than the Nov peak');
});
