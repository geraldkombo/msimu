/**
 * Leave-one-out verification of the shipped tercile bands for one site.
 *
 * Pulls ERA5 daily precipitation for 2005-2024 from the free Open-Meteo archive
 * API, rebuilds each calendar month's p33/p67 bands with one year held out, and
 * reports how often the held-out classification matches the classification the
 * product actually ships.
 *
 * Usage:
 *   node scripts/verify-terciles.mjs                # gataka, human table
 *   node scripts/verify-terciles.mjs --site gataka --json
 *   node scripts/verify-terciles.mjs --short-baseline 10
 *
 * Costs nothing but bandwidth: no API key, no paid service.
 */
import { fetchArchive } from '../src/climate.mjs';
import { getSite, siteIds } from '../src/packs.mjs';
import {
  NOT_SKILL_CAVEAT,
  buildRows,
  crossValidateTerciles,
  shortBaselineAgreement,
} from '../src/verification.mjs';

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const asJSON = argv.includes('--json');

const siteId = flag('site', 'gataka');
const site = getSite(siteId);
if (!site) {
  console.error(`unknown site "${siteId}". available: ${siteIds().join(', ')}`);
  process.exit(2);
}
const shortBaseline = Number(flag('short-baseline', '10'));

const archive = await fetchArchive(site);
const rows = buildRows(archive.times, archive.precip);
const result = crossValidateTerciles(rows);
const short = shortBaselineAgreement(rows, shortBaseline);

const report = {
  site: { id: site.id, name: site.name, county: site.county, ward: site.ward ?? null },
  baseline: {
    source: 'ERA5 via Open-Meteo archive API (2005-2024)',
    complete_months: rows.length,
    years: result.years.length,
    year_range: result.years.length ? `${result.years[0]}-${result.years.at(-1)}` : null,
  },
  leave_one_out: {
    comparisons: result.n,
    agreement: result.agreement,
    agreement_pct: result.agreement_pct,
    hss: result.hss === null ? null : Math.round(result.hss * 1000) / 1000,
    random_reference_pct: 33.3,
    tercile_counts: result.tercile_counts,
    collapsed_bands: result.collapsed_bands,
    per_month: result.per_month,
    disagreements: result.disagreements,
  },
  short_baseline_check: short,
  caveat: NOT_SKILL_CAVEAT,
};

if (asJSON) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`Msimu tercile-band verification - ${site.name} (${site.county})`);
  console.log(`baseline: ${report.baseline.year_range} ERA5, ${rows.length} complete months`);
  console.log('');
  console.log(`leave-one-out comparisons : ${result.n}`);
  console.log(`agreement with shipped    : ${result.agreement_pct}%  (random 3-way guess = 33.3%)`);
  console.log(`Heidke Skill Score        : ${report.leave_one_out.hss}`);
  console.log(`tercile balance           : below=${result.tercile_counts.below} near=${result.tercile_counts.near} above=${result.tercile_counts.above}`);
  console.log(`bands flip when held out  : ${result.disagreements.length} of ${result.n}`);
  console.log(
    `collapsed bands (p33=p67): ${result.collapsed_bands.count} month(s)` +
      (result.collapsed_bands.months.length ? ` -> months ${result.collapsed_bands.months.join(', ')}` : ''),
  );
  console.log('');
  console.log('month  n   agreement');
  for (const m of result.per_month) {
    console.log(`${String(m.month).padStart(5)}  ${String(m.n).padStart(2)}  ${String(m.agreement_pct).padStart(8)}%`);
  }
  console.log('');
  console.log(`short-baseline check      : ${short.baseline_years}-year bands agree ${short.agreement_pct}% with 20-year bands (n=${short.n})`);
  console.log('');
  if (result.disagreements.length) {
    console.log('disagreements (held-out year sits close to a tercile cut):');
    for (const d of result.disagreements) {
      console.log(`  ${d.key}  ${String(d.total_mm).padStart(7)} mm  shipped=${d.shipped}  loo=${d.leave_one_out}`);
    }
    console.log('');
  }
  console.log(`CAVEAT: ${NOT_SKILL_CAVEAT}`);
}
