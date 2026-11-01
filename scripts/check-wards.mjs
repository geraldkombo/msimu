/**
 * Offline integrity check for the committed country-wide boundary and climate assets.
 * Runs in CI without network access; exits non-zero if Kenya would ship broken.
 *
 * Usage:
 *   node scripts/check-wards.mjs                  # all 47 counties + the ward climate pack
 *   node scripts/check-wards.mjs --county kajiado # one county, faster
 */
import { readFileSync, statSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (flag, fallback) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const only = arg('--county', null);

const EXPECTED_COUNTIES = 47;
const EXPECTED_WARDS = 1452;
const MAX_COUNTY_KB = 400;
const MAX_DP = 5;

const failures = [];
const check = (name, ok, detail = '') => {
  if (!ok) console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ''}`);
  else console.log(`PASS  ${name}${detail ? ` - ${detail}` : ''}`);
  if (!ok) failures.push(name);
};

const indexFile = join(root, 'web', 'boundaries', 'index.json');
check('boundaries index exists', existsSync(indexFile), 'run: node scripts/fetch-boundaries.mjs');
if (!existsSync(indexFile)) process.exit(1);

const index = JSON.parse(readFileSync(indexFile, 'utf8'));
let counties = index.counties ?? [];
check('county count', only ? counties.some((c) => c.slug === only.toLowerCase()) : counties.length === EXPECTED_COUNTIES, `${counties.length} in index`);
if (only) counties = counties.filter((c) => c.slug === only.toLowerCase());

const totalWards = counties.reduce((n, c) => n + (c.wards?.length ?? 0), 0);
check('ward count', only ? totalWards > 0 : totalWards === EXPECTED_WARDS, `${totalWards} wards indexed`);
check('every ward has a point', counties.every((c) => (c.wards ?? []).every((w) => w.id && w.name && w.sub_county && w.lat != null && w.lon != null)));

let heaviest = { kb: 0, name: '-' };
let overPreciseTotal = 0;
let coordinateTotal = 0;
for (const c of counties) {
  const file = join(root, 'web', c.file);
  if (!existsSync(file)) {
    check(`${c.name} boundary file`, false, `missing web/${c.file}`);
    continue;
  }
  const kb = statSync(file).size / 1024;
  if (kb > heaviest.kb) heaviest = { kb, name: c.name };
  let gj = null;
  try {
    gj = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    check(`${c.name} valid JSON`, false, err.message);
    continue;
  }
  const props = gj?.properties ?? {};
  const problems = [];
  if (gj?.type !== 'FeatureCollection') problems.push('not a FeatureCollection');
  if ((gj?.features?.length ?? 0) !== (c.wards?.length ?? -1)) problems.push(`features ${gj?.features?.length ?? 0} != index ${c.wards?.length}`);
  if (!/CC BY 4\.0/i.test(String(props.license ?? ''))) problems.push('licence missing');
  if (!/geoBoundaries/i.test(String(props.attribution ?? ''))) problems.push('attribution missing');
  if (!Array.isArray(props.source_urls) || props.source_urls.length === 0) problems.push('source urls missing');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(props.retrieved_at ?? ''))) problems.push('retrieval date missing');
  if (kb > MAX_COUNTY_KB) problems.push(`${kb.toFixed(0)} KB > ${MAX_COUNTY_KB} KB`);

  const coords = [];
  const walk = (node) => {
    if (!Array.isArray(node)) return;
    if (typeof node[0] === 'number') { coords.push(node); return; }
    node.forEach(walk);
  };
  (gj?.features ?? []).forEach((f) => {
    if (!f?.properties?.ward || !f?.properties?.id) problems.push('feature without ward name or id');
    if (!f?.geometry?.coordinates?.length) problems.push('feature without geometry');
    walk(f?.geometry?.coordinates);
  });
  const overPrecise = coords.filter((p) => String(p[0]).split('.')[1]?.length > MAX_DP || String(p[1]).split('.')[1]?.length > MAX_DP);
  overPreciseTotal += overPrecise.length;
  coordinateTotal += coords.length;
  check(`${c.name} boundary file`, problems.length === 0, problems.length ? problems.join('; ') : `${gj.features.length} wards, ${kb.toFixed(0)} KB`);
}
check(`coordinates rounded to <=${MAX_DP} decimals`, overPreciseTotal === 0, `${overPreciseTotal} of ${coordinateTotal} over-precise`);

const packFile = join(root, 'data', 'wards.json');
check('ward climate pack exists', existsSync(packFile), 'run: node scripts/build-normals.mjs');
if (existsSync(packFile) && !only) {
  const pack = JSON.parse(readFileSync(packFile, 'utf8'));
  const wards = pack.wards ?? [];
  const cells = pack.cells ?? {};
  check('pack covers every ward', wards.length === EXPECTED_WARDS, `${wards.length} wards`);
  check('baseline is 2005-2024', JSON.stringify(pack.baseline_years) === '[2005,2024]', JSON.stringify(pack.baseline_years));
  check('grid is the ERA5 native 0.25 degrees', pack.grid_degrees === 0.25, String(pack.grid_degrees));
  const missing = wards.filter((w) => !cells[w.cell]);
  check('every ward points at a built cell', missing.length === 0, `${missing.length} dangling`);
  const labelled = wards.filter((w) => !['own', 'nearest'].includes(w.cell_source));
  check('cell provenance is labelled', labelled.length === 0, `${labelled.length} unlabelled`);
  const thin = Object.values(cells).filter((c) => c.rain_mm?.length !== 12 || c.p33_mm?.length !== 12 || c.p67_mm?.length !== 12 || c.sample_years !== 20);
  check('every cell has 12 months of 20-year normals and tercile bands', thin.length === 0, `${thin.length} incomplete cells`);
  const own = wards.filter((w) => w.cell_source === 'own').length;
  const nearest = wards.filter((w) => w.cell_source === 'nearest').length;
  const worst = wards.reduce((m, w) => Math.max(m, w.cell_distance_km ?? 0), 0);
  check('coverage reported', own + nearest === wards.length, `own cell ${own}, nearest cell ${nearest}, worst borrow ${worst} km, ${Object.keys(cells).length} cells built`);
  const kb = statSync(packFile).size / 1024;
  check('climate pack stays worker-sized', kb < 900, `${kb.toFixed(0)} KB`);
}

console.log('');
if (failures.length) {
  console.log(`${failures.length} failure(s): ${failures.join(', ')}`);
  process.exitCode = 1;
} else {
  const cov = only ? `${counties.length} county checked` : `${counties.length} counties, ${totalWards} wards`;
  console.log(`country assets OK: ${cov}, heaviest county file ${heaviest.name} ${heaviest.kb.toFixed(0)} KB, CC BY 4.0`);
}
