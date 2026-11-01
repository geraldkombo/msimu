import { computeOutlook } from './climate.mjs';
import { buildAdvisory } from './advisory.mjs';
import { supportedLocales } from './i18n.mjs';
import { crops, getSite, siteIds } from './packs.mjs';
import { counties, wardsForCounty, resolveWard, wardSite } from './wards.mjs';

function parseArgs(argv) {
  const out = { site: 'gataka', ward: null, county: null, lang: 'sw', irrigation: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--site') out.site = argv[++i];
    else if (a === '--ward') out.ward = argv[++i];
    else if (a === '--county') out.county = argv[++i];
    else if (a === '--lang') out.lang = argv[++i];
    else if (a === '--irrigation') out.irrigation = true;
    else if (a === '--json') out.json = true;
    else if (a === '--list-counties') out.listCounties = true;
    else if (a === '--list-wards') out.listWards = true;
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

function usage() {
  return [
    'Msimu - last-mile seasonal climate advisory for all 47 counties of Kenya',
    '',
    'Usage: node src/cli.mjs [--ward kajiado--nkaimurunya] [--site gataka] [--lang sw|en] [--irrigation] [--json]',
    '       node src/cli.mjs --list-counties',
    '       node src/cli.mjs --list-wards --county turkana',
    '',
    `Sites:   ${siteIds().join(', ')}`,
    `Wards:   ${counties().reduce((n, c) => n + c.ward_count, 0)} across ${counties().length} counties`,
    `Locales: ${supportedLocales().join(', ')}`,
    '',
    'Data: Open-Meteo seasonal (ECMWF SEAS5) + archive (ERA5 2005-2024). No API key, no cost.',
  ].join('\n');
}

export function pickActiveMonth(months, now = new Date()) {
  const key = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const usable = months.filter((m) => m.complete !== false && m.tercile !== 'unknown');
  const current = usable.find((m) => m.month === key);
  if (current) return current;
  return usable.find((m) => m.month >= key) ?? usable[0] ?? months[0];
}

export async function run(argv) {
  const opts = parseArgs(argv);
  if (opts.help) return usage();

  if (opts.listCounties) {
    return counties().map((c) => `${c.slug.padEnd(22)} ${c.name} (${c.ward_count} wards)`).join('\n');
  }
  if (opts.listWards) {
    if (!opts.county) return 'ERROR: --list-wards needs --county <slug>. See --list-counties.';
    return wardsForCounty(opts.county)
      .map((w) => `${w.slug.padEnd(48)} ${w.name}, ${w.sub_county} | ${w.agro_ecology} | ${w.annual_rain_mm ?? '?'} mm/yr`)
      .join('\n');
  }

  const site = opts.ward ? wardSite(opts.ward) : getSite(opts.site);
  const outlook = await computeOutlook(site);
  const active = pickActiveMonth(outlook.months);

  const advisory = buildAdvisory({
    site,
    tercile: active.tercile,
    confidence: active.confidence,
    month: active.calendar_month,
    locale: opts.lang,
    irrigation: opts.irrigation,
    crops,
  });

  if (opts.json) {
    return JSON.stringify({ outlook, advisory }, null, 2);
  }

  return [
    `=== ${site.name}${site.county ? ` (${site.county})` : ''} | ${outlook.elevation_m} m | baseline ${outlook.baseline_years} yr ===`,
    site.cell
      ? `ERA5 cell ${site.cell.key} (${site.cell.grid_degrees} deg, ${site.cell.source}${site.cell.distance_km ? `, ${site.cell.distance_km} km away` : ''}) | zone ${site.agro_ecology} | ${site.annual.water_balance_pct}% water balance`
      : null,
    '',
    'Month      Forecast  Median  Mean  Anomaly  Tercile      Conf     Days',
    ...outlook.months.map(
      (m) =>
        `${m.month}   ${String(m.forecast_mm).padStart(6)}mm ${String(m.median_mm ?? '-').padStart(6)}mm ` +
        `${String(m.mean_mm ?? '-').padStart(5)}mm ${String(m.anomaly_pct ?? '-').padStart(7)}%  ` +
        `${m.tercile.padEnd(12)} ${m.confidence.padEnd(8)} ` +
        `${m.complete ? '' : 'PARTIAL '}${m.days_covered}/${m.days_expected}`,
    ),
    '',
    `=== ADVISORY (${advisory.locale}) ===`,
    advisory.text,
  ].filter((l) => l !== null).join('\n');
}

if (process.argv[1] && process.argv[1].endsWith('cli.mjs')) {
  run(process.argv.slice(2))
    .then((out) => {
      process.stdout.write(`${out}\n`);
    })
    .catch((err) => {
      process.stderr.write(`ERROR: ${err.message}\n`);
      process.exitCode = 1;
    });
}
