import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  rollingWindow,
  scoreWindow,
  skillScoreboard,
  isCsiSaturated,
  DEFAULT_MODELS,
} from '../src/skill.mjs';

/**
 * The scoreboard is the public artifact the article demands of everyone else,
 * so its arithmetic is pinned offline: scoreWindow and skillScoreboard are pure
 * functions of recorded API payloads, and every test here runs on synthetic
 * payloads with hand-checkable numbers.
 */

const target = { lat: -1.4275, lon: 36.6865, label: 'Kiserian' };

/** Build a synthetic Previous Runs payload: hourly series per model per lead. */
function fakePreviousRuns({ days, perModelLead, models = ['ecmwf_ifs025', 'gfs_seamless'] }) {
  const times = [];
  for (const d of days) {
    for (let h = 0; h < 24; h += 1) times.push(`${d}T${String(h).padStart(2, '0')}:00`);
  }
  const hourly = { time: times };
  for (const [model, byLead] of Object.entries(perModelLead)) {
    for (const [lead, mmPerDay] of Object.entries(byLead)) {
      const key = lead === '0' ? `precipitation_${model}` : `precipitation_previous_day${lead}_${model}`;
      hourly[key] = times.map((t) => {
        const day = days.indexOf(t.slice(0, 10));
        return Number.isFinite(mmPerDay[day]) ? mmPerDay[day] / 24 : null;
      });
    }
  }
  return { latitude: target.lat, longitude: target.lon, elevation: 1842, hourly };
}

function fakeObserved(days, mmPerDay) {
  return {
    times: days,
    values: mmPerDay,
    source: 'fixture',
    snapped: { latitude: target.lat, longitude: target.lon, elevation_m: 1842 },
  };
}

test('rollingWindow ends yesterday UTC and is inclusive', () => {
  const now = new Date('2026-11-01T09:30:00Z');
  const w = rollingWindow({ days: 7, now });
  assert.equal(w.endISO, '2026-10-31', 'today is excluded: its analysis is still settling');
  assert.equal(w.startISO, '2026-10-25');
  assert.equal(w.days.length, 7);
  assert.equal(w.days[6], '2026-10-31');
  const one = rollingWindow({ days: 1, now });
  assert.deepEqual(one.days, ['2026-10-31']);
});

test('scoreWindow scores hand-checked daily totals per lead', () => {
  const days = ['2026-10-29', '2026-10-30'];
  const observed = fakeObserved(days, [10, 2]); // 12 mm total, both days wet at 1 mm
  const previousRuns = fakePreviousRuns({
    days,
    perModelLead: {
      ecmwf_ifs025: { 0: [10, 2], 1: [8, 4] }, // perfect at lead 0; 12 total at lead 1
      gfs_seamless: { 0: [20, 9], 1: [0, 0] }, // 29 mm then 0 mm: the GFS wobble
    },
  });
  const report = scoreWindow({
    target,
    startISO: days[0],
    endISO: days[1],
    observed,
    previousRuns,
    models: ['ecmwf_ifs025', 'gfs_seamless'],
    leadDays: 1,
    threshold: 1,
  });
  assert.equal(report.reference.window_total_mm, 12);
  const lead0 = report.leads[0].models;
  assert.equal(lead0.ecmwf_ifs025.scores.mae_mm, 0);
  assert.equal(lead0.gfs_seamless.scores.bias_mm, 8.5); // ((20-10) + (9-2))/2
  const lead1 = report.leads[1].models;
  assert.equal(lead1.ecmwf_ifs025.window_total_mm, 12);
  assert.equal(lead1.gfs_seamless.scores.mae_mm, 6); // (10 + 2)/2
});

test('scoreWindow reports an all-null long lead as unavailable, not as zero rain', () => {
  const days = ['2026-10-30'];
  const previousRuns = fakePreviousRuns({
    days,
    perModelLead: {
      ecmwf_ifs025: { 0: [5], 1: [null] },
    },
  });
  // fakePreviousRuns turns NaN entries into null; force the whole lead-1 series null
  previousRuns.hourly.precipitation_previous_day1_ecmwf_ifs025 = [null, null];
  const report = scoreWindow({
    target,
    startISO: days[0],
    endISO: days[0],
    observed: fakeObserved(days, [4]),
    previousRuns,
    models: ['ecmwf_ifs025'],
    leadDays: 1,
    threshold: 1,
  });
  assert.equal(report.leads[1].models.ecmwf_ifs025.available, false);
  assert.equal(report.leads[1].any_data, false, 'a lead with no populated series is not scored');
});

test('scoreWindow refuses the identical-totals artifact', () => {
  const days = ['2026-10-29', '2026-10-30'];
  const previousRuns = fakePreviousRuns({
    days,
    perModelLead: {
      ecmwf_ifs025: { 0: [3, 3], 1: [3, 3] },
      gfs_seamless: { 0: [3, 3], 1: [3, 3] },
    },
  });
  assert.throws(
    () =>
      scoreWindow({
        target,
        startISO: days[0],
        endISO: days[1],
        observed: fakeObserved(days, [3, 3]),
        previousRuns,
        models: ['ecmwf_ifs025', 'gfs_seamless'],
        leadDays: 1,
      }),
    /Refusing to report a score that is an artifact/,
    'if every lead returns the same totals the offsets were not parsed; that is a bug, not a perfect forecast',
  );
});

test('scoreWindow throws when the Previous Runs payload is empty', () => {
  assert.throws(
    () =>
      scoreWindow({
        target,
        startISO: '2026-10-30',
        endISO: '2026-10-30',
        observed: fakeObserved(['2026-10-30'], [1]),
        previousRuns: { hourly: { time: [] } },
        models: ['ecmwf_ifs025'],
        leadDays: 0,
      }),
    /no hourly data/,
  );
});

test('skillScoreboard ranks by short-range MAE and keeps the caveat attached', () => {
  const days = ['2026-10-29', '2026-10-30'];
  const previousRuns = fakePreviousRuns({
    days,
    perModelLead: {
      ecmwf_ifs025: { 0: [10, 2], 1: [9, 3], 2: [8, 2] }, // tight all week
      gfs_seamless: { 0: [20, 9], 1: [0, 0], 2: [12, 0] }, // wild
    },
  });
  const report = scoreWindow({
    target,
    startISO: days[0],
    endISO: days[1],
    observed: fakeObserved(days, [10, 2]),
    previousRuns,
    models: ['ecmwf_ifs025', 'gfs_seamless'],
    leadDays: 2,
    threshold: 1,
  });
  const board = skillScoreboard(report);
  assert.equal(board.data_status, 'live_verification');
  assert.equal(board.models[0].key, 'ecmwf_ifs025', 'lowest short-range MAE ranks first');
  assert.equal(board.best_short_range.key, 'ecmwf_ifs025');
  assert.equal(board.best_short_range.mean_mae_mm, 0.67); // (0 + 1 + 1)/3 rounded
  assert.equal(board.observed_total_mm, 12);
  assert.equal(board.wet_days, 2);
  assert.match(board.caveat, /not a rain gauge/, 'every scoreboard payload carries the reference caveat');
  assert.equal(board.csi_saturated, isCsiSaturated(report));
});

test('skillScoreboard flags CSI saturation instead of crowning a meaningless 100%', () => {
  const days = ['2026-10-29', '2026-10-30'];
  // Every model wet on every day at 1 mm threshold: CSI 1.0 everywhere.
  const previousRuns = fakePreviousRuns({
    days,
    perModelLead: {
      ecmwf_ifs025: { 0: [4, 4], 1: [4, 4.5] },
      gfs_seamless: { 0: [9, 9], 1: [30, 1] },
    },
  });
  const report = scoreWindow({
    target,
    startISO: days[0],
    endISO: days[1],
    observed: fakeObserved(days, [5, 5]),
    previousRuns,
    models: ['ecmwf_ifs025', 'gfs_seamless'],
    leadDays: 1,
    threshold: 1,
  });
  const board = skillScoreboard(report);
  assert.equal(board.csi_saturated, true);
  assert.equal(board.models[0].key, 'ecmwf_ifs025', 'ranking still discriminates on MAE');
  assert.match(board.rank_metric, /mean absolute error/, 'the metric is named in the payload');
});

test('scoreWindow handles missing models without inventing data', () => {
  const days = ['2026-10-30'];
  const previousRuns = fakePreviousRuns({
    days,
    perModelLead: { ecmwf_ifs025: { 0: [5] } }, // gfs never returned
  });
  const report = scoreWindow({
    target,
    startISO: days[0],
    endISO: days[0],
    observed: fakeObserved(days, [5]),
    previousRuns,
    models: ['ecmwf_ifs025', 'gfs_seamless'],
    leadDays: 0,
  });
  assert.equal(report.leads[0].models.gfs_seamless, undefined, 'absent series are omitted, not zero-filled');
  const board = skillScoreboard(report);
  assert.deepEqual(board.models.map((mo) => mo.key), ['ecmwf_ifs025']);
});

test('DEFAULT_MODELS is the five scored in the article table', () => {
  assert.deepEqual(DEFAULT_MODELS, [
    'ecmwf_ifs025',
    'gfs_seamless',
    'icon_seamless',
    'meteofrance_seamless',
    'ukmo_seamless',
  ]);
});
