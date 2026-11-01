import { test } from 'node:test';
import assert from 'node:assert/strict';

import { daysInMonth, monthCoverage, tercileBands, classify, quantile } from '../src/terciles.mjs';
import { outlookFromRaw } from '../src/climate.mjs';
import { pickActiveMonth } from '../src/cli.mjs';

test('daysInMonth handles month lengths and leap years', () => {
  assert.equal(daysInMonth('2026-10'), 31);
  assert.equal(daysInMonth('2026-11'), 30);
  assert.equal(daysInMonth('2026-02'), 28);
  assert.equal(daysInMonth('2024-02'), 29);
});

test('monthCoverage detects a month that starts or ends mid-run', () => {
  const times = ['2026-10-28', '2026-10-29', '2026-11-01', '2026-11-02', '2026-11-03'];
  const cov = monthCoverage(times);
  assert.equal(cov.get('2026-10').complete, false);
  assert.equal(cov.get('2026-10').days_covered, 2);
  assert.equal(cov.get('2026-11').complete, false);
  assert.equal(cov.get('2026-11').days_covered, 3);
});

function syntheticOutlook() {
  const times = [];
  const precip = [];
  for (const d of [28, 29, 30, 31]) {
    times.push(`2026-10-${d}`);
    precip.push(2);
  }
  for (let d = 1; d <= 30; d++) {
    times.push(`2026-11-${String(d).padStart(2, '0')}`);
    precip.push(3.2);
  }
  for (let d = 1; d <= 12; d++) {
    times.push(`2026-12-${String(d).padStart(2, '0')}`);
    precip.push(4);
  }
  const baseline = new Map([
    [10, { p33: 40, p67: 75, n: 20 }],
    [11, { p33: 80, p67: 120, n: 20 }],
    [12, { p33: 35, p67: 80, n: 20 }],
  ]);
  const normals = new Map([
    [10, 57],
    [11, 99],
    [12, 58],
  ]);
  return outlookFromRaw({ forecast: { times, precip }, baseline, normals });
}

test('REGRESSION: a partial month is never classified, so it cannot produce false advice', () => {
  const rows = syntheticOutlook();
  const oct = rows.find((r) => r.month === '2026-10');
  const nov = rows.find((r) => r.month === '2026-11');
  const dec = rows.find((r) => r.month === '2026-12');

  assert.equal(oct.complete, false);
  assert.equal(oct.tercile, 'unknown', 'the Oct 28-31 stub must not be called "below normal"');
  assert.equal(oct.tercile_reason, 'partial_month');
  assert.equal(oct.confidence, 'none');

  assert.equal(nov.complete, true);
  assert.equal(nov.forecast_mm, 96);
  assert.equal(nov.tercile, 'near', '96mm sits between the p33=80 and p67=120 bands');
  assert.equal(nov.confidence, 'high');

  assert.equal(dec.complete, false);
  assert.equal(dec.tercile, 'unknown');
});

test('pickActiveMonth skips partial months and picks the next complete one', () => {
  const rows = syntheticOutlook();
  const picked = pickActiveMonth(rows, new Date('2026-10-28T00:00:00Z'));
  assert.equal(picked.month, '2026-11', 'must not advise on the October stub');
  assert.equal(picked.complete, true);
});

test('pickActiveMonth prefers the current month when it is complete', () => {
  const rows = syntheticOutlook();
  const picked = pickActiveMonth(rows, new Date('2026-11-15T00:00:00Z'));
  assert.equal(picked.month, '2026-11');
});

test('REGRESSION: tercile and the reported anomaly must agree, because rainfall is right-skewed', () => {
  const times = [];
  const precip = [];
  for (let d = 1; d <= 30; d++) {
    times.push(`2026-11-${String(d).padStart(2, '0')}`);
    precip.push(96 / 30);
  }
  const baseline = new Map([[11, { p33: 81, p67: 90, n: 20 }]]);
  const normals = new Map([[11, { mean: 99, median: 85.5, n: 20 }]]);
  const rows = outlookFromRaw({ forecast: { times, precip }, baseline, normals });

  assert.equal(rows[0].tercile, 'above', '96mm exceeds the p67=90 band');
  assert.equal(rows[0].median_mm, 86);
  assert.equal(rows[0].mean_mm, 99);
  assert.ok(rows[0].anomaly_pct > 0, 'anomaly vs median must agree in sign with the tercile');
  assert.equal(rows[0].anomaly_pct, 12);
});

test('skewed real distribution: the mean can sit above the upper tercile, so the median is the reference', () => {
  const history = [28, 45, 60, 70, 75, 78, 80, 81, 83, 84, 85, 86, 88, 90, 92, 95, 110, 180, 250, 357];
  const bands = tercileBands(history);
  const mean = history.reduce((a, b) => a + b, 0) / history.length;
  const median = quantile([...history].sort((a, b) => a - b), 0.5);
  assert.ok(mean > bands.p67, `mean ${mean.toFixed(1)} should exceed p67 ${bands.p67.toFixed(1)} in a tight-cluster-plus-outlier rainfall record`);
  assert.ok(median > bands.p33 && median < bands.p67, 'the median sits inside the near-normal band');
  assert.equal(classify(mean, bands), 'above');
  assert.equal(classify(median, bands), 'near');
});

test('missing baseline is reported as no_baseline, not as a normal-classified month', () => {
  const times = [];
  const precip = [];
  for (let d = 1; d <= 30; d++) {
    times.push(`2026-11-${String(d).padStart(2, '0')}`);
    precip.push(3);
  }
  const rows = outlookFromRaw({
    forecast: { times, precip },
    baseline: new Map(),
    normals: new Map([[11, 99]]),
  });
  assert.equal(rows[0].complete, true);
  assert.equal(rows[0].tercile, 'unknown');
  assert.equal(rows[0].tercile_reason, 'no_baseline');
});
