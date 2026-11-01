/**
 * Offline tests for the leave-one-out tercile-band verification.
 * Deterministic synthetic data only - no network, no ERA5 calls.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CATEGORIES,
  NOT_SKILL_CAVEAT,
  buildRows,
  crossValidateTerciles,
  emptyContingency,
  fullSampleBands,
  heidkeSkillScore,
  leaveOneOutBands,
  shortBaselineAgreement,
} from '../src/verification.mjs';

/** Deterministic pseudo-monthly totals: 12 months x `years` years. */
function syntheticRows(years = 20, startYear = 2005) {
  const rows = [];
  for (let y = startYear; y < startYear + years; y++) {
    for (let m = 1; m <= 12; m++) {
      const seasonal = 20 + 60 * Math.sin((m / 12) * Math.PI); // wet mid-year, dry ends
      const wobble = ((y * 7 + m * 13) % 9) - 4; // -4..+4 mm, varies by year
      rows.push({ key: `${y}-${String(m).padStart(2, '0')}`, year: y, month: m, total: Math.round((seasonal + wobble) * 100) / 100 });
    }
  }
  return rows;
}

/** Deterministic daily series of real calendar dates starting 2005-01-01. */
function dailySeries(days, value = 2) {
  const times = [];
  const values = [];
  const start = Date.UTC(2005, 0, 1);
  for (let d = 0; d < days; d++) {
    times.push(new Date(start + d * 86400000).toISOString().slice(0, 10));
    values.push(value);
  }
  return { times, values };
}

test('buildRows keeps only complete calendar months', () => {
  const { times, values } = dailySeries(41); // all of Jan (31 days) + 10 days of Feb
  const rows = buildRows(times, values);
  assert.equal(rows.length, 1, 'partial February must be dropped');
  assert.equal(rows[0].key, '2005-01');
  assert.equal(rows[0].total, 62);
  assert.equal(rows[0].year, 2005);
  assert.equal(rows[0].month, 1);
});

test('buildRows returns an empty list for an empty series', () => {
  assert.deepEqual(buildRows([], []), []);
});

test('leave-one-out bands use one year fewer than the full sample', () => {
  const rows = syntheticRows(20);
  const full = fullSampleBands(rows);
  const loo = leaveOneOutBands(rows, 2010);
  for (const m of [1, 6, 12]) {
    assert.equal(full.get(m).n, 20);
    assert.equal(loo.get(m).n, 19);
    assert.ok(loo.get(m).p33 <= loo.get(m).p67, 'bands must stay ordered');
  }
});

test('crossValidateTerciles reports stable bands as near-perfect agreement', () => {
  const result = crossValidateTerciles(syntheticRows(20));
  assert.equal(result.n, 240, '20 years x 12 months');
  assert.equal(result.baseline_years, 20);
  assert.ok(result.agreement_pct >= 95, `expected stable bands, got ${result.agreement_pct}%`);
  assert.ok(result.hss >= 0.9, `expected high HSS, got ${result.hss}`);
  assert.equal(result.per_month.length, 12);
  for (const m of result.per_month) assert.equal(m.n, 20);
});

test('crossValidateTerciles records disagreements with both band sets', () => {
  // Adversarial bimodal 6-year sample: three dry Junes at 10 mm, three wet at 20 mm.
  // Full-sample bands (p33=10, p67=20) put every year in "near". Hold one year out
  // and the bands move off that value, so every classification flips - exactly the
  // instability this metric exists to expose.
  const totals = [10, 10, 10, 20, 20, 20];
  const rows = totals.map((total, i) => ({
    key: `${2005 + i}-06`,
    year: 2005 + i,
    month: 6,
    total,
  }));

  const result = crossValidateTerciles(rows);
  assert.equal(result.n, 6, 'one comparison per held-out observation');
  assert.equal(result.disagreements.length, 6);
  assert.equal(result.agreement_pct, 0);

  for (const d of result.disagreements) {
    assert.equal(d.shipped, 'near', 'the full sample classifies every year as near');
    assert.ok(['below', 'above'].includes(d.leave_one_out));
    assert.equal(d.shipped_bands.n, 6);
    assert.equal(d.loo_bands.n, 5);
    assert.ok(
      d.loo_bands.p33_mm !== d.shipped_bands.p33_mm || d.loo_bands.p67_mm !== d.shipped_bands.p67_mm,
      'the flip must be explained by a shifted band',
    );
  }
  const dry = result.disagreements.find((d) => d.key === '2005-06');
  const wet = result.disagreements.find((d) => d.key === '2008-06');
  assert.equal(dry.leave_one_out, 'below', 'a dry year must fall out of the band when held out');
  assert.equal(wet.leave_one_out, 'above', 'a wet year must rise out of the band when held out');

  assert.equal(
    result.n,
    CATEGORIES.reduce((s, a) => s + CATEGORIES.reduce((t, b) => t + result.contingency[a][b], 0), 0),
    'contingency table must account for every comparison',
  );
});

test('tercile counts stay near a third each when bands are well formed', () => {
  const { tercile_counts, n } = crossValidateTerciles(syntheticRows(20));
  for (const c of CATEGORIES) {
    const share = tercile_counts[c] / n;
    assert.ok(share > 0.2 && share < 0.47, `${c} share ${share.toFixed(2)} is not tercile-like`);
  }
});

test('heidkeSkillScore is 1 for perfect agreement and ~0 for chance', () => {
  const perfect = emptyContingency();
  for (const c of CATEGORIES) perfect[c][c] = 40;
  assert.equal(heidkeSkillScore(perfect), 1);

  const chance = emptyContingency();
  for (const a of CATEGORIES) for (const b of CATEGORIES) chance[a][b] = 10;
  assert.ok(Math.abs(heidkeSkillScore(chance)) < 1e-9, 'uniform table must score 0');
});

test('heidkeSkillScore returns null for an empty table', () => {
  assert.equal(heidkeSkillScore(emptyContingency()), null);
});

test('shortBaselineAgreement quantifies sensitivity to baseline length', () => {
  const rows = syntheticRows(20);
  const short = shortBaselineAgreement(rows, 10);
  assert.equal(short.baseline_years, 10);
  assert.equal(short.n, 240);
  assert.ok(short.agreement_pct >= 90, `10-year bands drifted too far: ${short.agreement_pct}%`);
});

test('crossValidateTerciles flags months whose bands collapse', () => {
  // A month where every year is bone dry: p33 === p67 === 0, so every year is "near".
  const dry = [2005, 2006, 2007, 2008, 2009].map((year) => ({ key: `${year}-07`, year, month: 7, total: 0 }));
  const wet = [2005, 2006, 2007, 2008, 2009].map((year, i) => ({
    key: `${year}-04`,
    year,
    month: 4,
    total: 40 + i * 15,
  }));
  const result = crossValidateTerciles([...dry, ...wet]);
  assert.equal(result.collapsed_bands.count, 1);
  assert.deepEqual(result.collapsed_bands.months, [7]);
  assert.equal(result.tercile_counts.near >= 5, true, 'collapsed months pile into "near"');

  const stable = crossValidateTerciles(syntheticRows(20));
  assert.equal(stable.collapsed_bands.count, 0, 'varied rainfall must not collapse');
});

test('crossValidateTerciles degrades safely on empty input', () => {
  const result = crossValidateTerciles([]);
  assert.equal(result.n, 0);
  assert.equal(result.agreement_pct, null);
  assert.equal(result.hss, null);
  assert.deepEqual(result.per_month, []);
  assert.deepEqual(result.collapsed_bands, { count: 0, months: [] });
  assert.ok(result.caveat.length > 0);
});

test('the caveat always denies SEAS5 forecast skill', () => {
  assert.match(NOT_SKILL_CAVEAT, /NOT a measure of ECMWF SEAS5/i);
  assert.match(crossValidateTerciles(syntheticRows(5)).caveat, /leave-one-out band stability/i);
  assert.match(shortBaselineAgreement(syntheticRows(5), 3).baseline_years.toString(), /3/);
});
