import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  categoricalScores,
  dateRange,
  detectionNarrative,
  hourlyKey,
  isCsiSaturated,
  previousRunVariables,
  resolveTarget,
  summariseByLead,
  toDailyTotals,
} from '../scripts/verify-event.mjs';

test('dateRange is inclusive and rejects nonsense', () => {
  assert.deepEqual(dateRange('2026-10-30', '2026-10-31'), ['2026-10-30', '2026-10-31']);
  assert.deepEqual(dateRange('2026-10-30', '2026-10-30'), ['2026-10-30']);
  assert.deepEqual(dateRange('2026-10-29', '2026-11-02'), [
    '2026-10-29',
    '2026-10-30',
    '2026-10-31',
    '2026-11-01',
    '2026-11-02',
  ]);
  assert.throws(() => dateRange('2026-11-02', '2026-10-29'), /must not be after/);
  assert.throws(() => dateRange('nope', '2026-10-29'), /bad --start/);
});

test('toDailyTotals sums hourly values by local date and ignores nulls', () => {
  const times = ['2026-10-30T00:00', '2026-10-30T12:00', '2026-10-31T00:00'];
  const values = [3, 4, null];
  const daily = toDailyTotals(times, values);
  assert.equal(daily.get('2026-10-30'), 7);
  assert.equal(daily.get('2026-10-31'), 0, 'a null hour counts as zero, not as missing');
});

/**
 * The Previous Runs API encodes lead time in the VARIABLE NAME.
 * Getting this wrong returns the latest run at every lead and yields a
 * meaningless perfect score, so the naming is pinned by a test.
 */
test('hourlyKey matches the observed Open-Meteo variable naming', () => {
  assert.equal(hourlyKey('ecmwf_ifs025', 0), 'precipitation_ecmwf_ifs025');
  assert.equal(hourlyKey('ecmwf_ifs025', 1), 'precipitation_previous_day1_ecmwf_ifs025');
  assert.equal(hourlyKey('gfs_seamless', 7), 'precipitation_previous_day7_gfs_seamless');
});

test('previousRunVariables requests lead 0 plus every offset up to the max', () => {
  assert.deepEqual(previousRunVariables(0), ['precipitation']);
  assert.deepEqual(previousRunVariables(2), [
    'precipitation',
    'precipitation_previous_day1',
    'precipitation_previous_day2',
  ]);
});

test('categoricalScores reproduces a hand-checked contingency table', () => {
  // obs: wet, wet, dry. forecast: wet, dry, dry => 1 hit, 1 miss, 0 false alarm, 1 correct negative
  const s = categoricalScores(
    [
      { f: 5, o: 8 },
      { f: 0, o: 6 },
      { f: 0, o: 0.2 },
    ],
    1,
  );
  assert.equal(s.hits, 1);
  assert.equal(s.misses, 1);
  assert.equal(s.false_alarms, 0);
  assert.equal(s.correct_negatives, 1);
  assert.equal(s.pod, 0.5);
  assert.equal(s.far, 0);
  assert.equal(s.csi, 0.5);
  assert.equal(s.threshold_mm, 1);
});

test('categoricalScores penalises a false alarm and handles an empty window', () => {
  const fa = categoricalScores([{ f: 9, o: 0 }], 1);
  assert.equal(fa.false_alarms, 1);
  assert.equal(fa.pod, null, 'POD is undefined with no wet reference days');
  assert.equal(fa.far, 1);
  assert.equal(fa.csi, 0);
  const empty = categoricalScores([], 1);
  assert.equal(empty.n, 0);
  assert.equal(empty.csi, null);
  assert.equal(empty.hss, null);
});

test('categoricalScores depends on the threshold, and the threshold is recorded', () => {
  const pairs = [{ f: 7, o: 7 }];
  assert.equal(categoricalScores(pairs, 1).csi, 1, 'a 7 mm day is wet at a 1 mm threshold');
  // At 10 mm neither side is wet, so the CSI denominator is zero. Undefined is the
  // honest answer: a window with no wet days and no false alarms cannot
  // discriminate between models. Reporting 0 here would imply a forecast miss.
  assert.equal(categoricalScores(pairs, 10).csi, null, 'CSI is undefined for an all-dry window');
  assert.equal(categoricalScores(pairs, 10).correct_negatives, 1);
  assert.equal(categoricalScores(pairs, 10).threshold_mm, 10);
  // A forecast that calls rain when none falls is a false alarm, and CSI does score it.
  assert.equal(categoricalScores([{ f: 15, o: 7 }], 10).csi, 0);
  assert.equal(categoricalScores([{ f: 15, o: 7 }], 10).false_alarms, 1);
});

test('resolveTarget reads coordinates from a curated site', () => {
  const t = resolveTarget({ siteId: 'gataka' });
  assert.match(t.label, /^Gataka/, 'the curated label carries the ward suffix');
  assert.ok(Number.isFinite(t.lat) && Number.isFinite(t.lon));
  assert.match(t.source, /sites\.json/);
  assert.throws(() => resolveTarget({ siteId: 'atlantis' }), /unknown site/);
  assert.throws(() => resolveTarget({}), /pass --lat and --lon/);
  assert.throws(() => resolveTarget({ lat: 200, lon: 0 }), /latitude must be within/);
});

const mkReport = (totals, { allSameCsi = false } = {}) => ({
  event: { threshold_mm: 1 },
  leads: totals.map((t, i) => ({
    lead_days: i,
    any_data: true,
    observed_mm: 12.7,
    models: {
      ecmwf_ifs025: {
        label: 'ECMWF IFS 0.25',
        available: true,
        window_total_mm: t,
        scores: { csi: allSameCsi ? 1 : 0.8, bias_mm: t - 12.7, mae_mm: Math.abs(t - 12.7), pod: 1, far: 0 },
      },
      gfs_seamless: {
        label: 'NOAA GFS',
        available: true,
        window_total_mm: t + 20,
        scores: { csi: allSameCsi ? 1 : 0.4, bias_mm: t + 20 - 12.7, mae_mm: Math.abs(t + 20 - 12.7), pod: 1, far: 1 },
      },
      icon_seamless: { label: 'DWD ICON', available: false },
    },
  })),
});

test('summariseByLead ranks on CSI normally and reports unavailable models', () => {
  const s = summariseByLead(mkReport([12, 13]));
  assert.equal(s.length, 2);
  assert.equal(s[0].rank_metric, 'csi');
  assert.equal(s[0].best.label, 'ECMWF IFS 0.25');
  assert.deepEqual(s[0].unavailable, ['DWD ICON']);
});

test('saturated CSI is detected and ranking falls back to MAE', () => {
  const report = mkReport([12, 40], { allSameCsi: true });
  assert.equal(isCsiSaturated(report), true);
  const s = summariseByLead(report);
  assert.equal(s[0].rank_metric, 'mae_mm', 'a saturated CSI must not be used to pick a winner');
  assert.equal(isCsiSaturated(mkReport([12])), false);
  assert.equal(isCsiSaturated({ leads: [] }), false);
});

test('detectionNarrative separates what was called from what was missed', () => {
  // Fixture gives ECMWF totals [0.2, 15] and GFS totals [+20], i.e. [20.2, 35].
  const n = detectionNarrative(mkReport([0.2, 15]));
  assert.deepEqual(n[0].detected, ['NOAA GFS'], 'GFS clears the 1 mm wet-day threshold');
  assert.deepEqual(n[0].missed, ['ECMWF IFS 0.25'], 'a 0.2 mm forecast is not a wet-day call');
  assert.equal(n[0].spread_mm, 20);
  assert.deepEqual(n[1].detected, ['ECMWF IFS 0.25', 'NOAA GFS']);
  assert.deepEqual(n[1].missed, []);
});
