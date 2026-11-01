/**
 * End-to-end probe of the real HTTP surface: dashboard, ward asset, and every API route.
 *
 * Local mode (default): starts the zero-dependency server (Worker handler + static dashboard
 * on one origin), probes it, then shuts it down.
 *   node scripts/probe-local.mjs [--port 8091]
 *
 * Remote mode: probe an already-deployed Worker without starting anything.
 *   node scripts/probe-local.mjs --base https://msimu.shikunyi.workers.dev
 *
 * Exit code 0 = every check passed, 1 = at least one failure.
 * This is the "prove it works" script: it exercises the real HTTP surface, not mocks.
 */
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (flag, fallback) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const external = arg('--base', '').replace(/\/$/, '');
const port = Number(arg('--port', 8091));
const base = external || `http://localhost:${port}`;

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}`);
}

async function waitForServer(tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

const server = external
  ? null
  : spawn(process.execPath, [resolve(root, 'scripts', 'serve-local.mjs')], {
      cwd: root,
      env: { ...process.env, PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
let serverError = '';
server?.stderr.on('data', (c) => (serverError += c));

try {
  const up = external ? await waitForServer(10) : await waitForServer();
  if (!up) {
    check('server reachable', false, `no /health response on ${base}. ${serverError ? `stderr: ${serverError.slice(0, 200)}` : ''}`);
    process.exitCode = 1;
  } else {
    check('server reachable', true, external ? `${base} (deployed Worker)` : `${base} (PORT=${port})`);

    // Dashboard HTML: country-wide, no county hardcoded
    const home = await fetch(`${base}/`);
    const homeBody = await home.text();
    check('GET / serves the dashboard', home.ok && homeBody.includes('<div id="map"'), `status ${home.status}, ${homeBody.length} B`);
    check('dashboard has county and ward pickers', homeBody.includes('id="county"') && homeBody.includes('id="ward"'));
    check('dashboard loads the county list from the API', homeBody.includes("fetch('/counties')"));
    check('dashboard uses the county choropleth feed', /\/county-outlook\?county=/.test(homeBody));
    check('dashboard loads boundary files lazily per county', homeBody.includes('boundaries/'));
    check('no county is hardcoded into the dashboard', !homeBody.includes('kajiado-wards.geojson'));
    check('dashboard has legend + attribution nodes', homeBody.includes('id="legend"') && homeBody.includes('id="ward-attrib"'));
    check('dashboard attributes geoBoundaries', homeBody.includes('geoBoundaries'));
    check('dashboard discloses borrowed ERA5 cells', /nearestCell/.test(homeBody));

    // Country-wide catalogue
    const counties = await (await fetch(`${base}/counties`)).json().catch(() => null);
    check('GET /counties lists all 47 counties', counties?.counties?.length === 47, `${counties?.counties?.length ?? 0} counties`);
    check('/counties reports ward coverage', counties?.wards?.wards === 1452, JSON.stringify(counties?.wards ?? null));

    const kajiadoWards = await (await fetch(`${base}/wards?county=kajiado`)).json().catch(() => null);
    check('GET /wards?county=kajiado', kajiadoWards?.wards?.length === 25, `${kajiadoWards?.wards?.length ?? 0} wards`);
    check('ward rows carry zone and water balance', (kajiadoWards?.wards ?? []).every((w) => w.agro_ecology && w.water_balance_pct != null && w.slug && w.cell));
    check('pilot ward is addressable', (kajiadoWards?.wards ?? []).some((w) => /nkaimurunya/i.test(w.name) && w.slug === 'kajiado--nkaimurunya'));

    const badWards = await fetch(`${base}/wards?county=atlantis`);
    check('unknown county 404s', badWards.status === 404, `status ${badWards.status}`);

    // Boundary assets served per county
    for (const [slug, expected] of [['kajiado', 25], ['nairobi', 85], ['turkana', null]]) {
      const res = await fetch(`${base}/boundaries/${slug}-wards.geojson`);
      const body = await res.text();
      let fc = null;
      try { fc = JSON.parse(body); } catch { /* checked below */ }
      check(`GET /boundaries/${slug}-wards.geojson`, res.ok && Boolean(fc), `status ${res.status}, ${(body.length / 1024).toFixed(1)} KB`);
      if (!fc) continue;
      check(`${slug} content type is geo+json`, (res.headers.get('content-type') ?? '').startsWith('application/geo+json'), res.headers.get('content-type') ?? 'none');
      check(`${slug} ward count`, expected == null ? fc.features.length > 0 : fc.features.length === expected, `${fc.features.length} features`);
      check(`${slug} carries CC BY 4.0 attribution`, /CC BY 4\.0/i.test(String(fc.properties.license)) && /geoBoundaries/i.test(String(fc.properties.attribution)));
      check(`${slug} file is phone-sized (<400 KB)`, body.length / 1024 < 400, `${(body.length / 1024).toFixed(1)} KB`);
      check(`${slug} features are identified`, fc.features.every((f) => f.properties?.ward && f.properties?.id));
    }
    const pilotWard = await (await fetch(`${base}/boundaries/kajiado-wards.geojson`)).json();
    check('pilot ward polygon present', pilotWard.features.some((f) => /nkaimurunya/i.test(f.properties.ward)));

    // Choropleth feed: one call colours a whole county
    const co = await (await fetch(`${base}/county-outlook?county=kajiado`)).json().catch(() => null);
    check('GET /county-outlook colours every ward', co?.wards?.length === 25, `${co?.wards?.length ?? 0} wards from ${co?.cells ?? '?'} cells`);
    check('choropleth wards have a tercile and a month', (co?.wards ?? []).every((w) => w.tercile && w.month && w.confidence));
    check('choropleth never classifies without a reason', (co?.wards ?? []).every((w) => w.tercile !== 'unknown' || w.tercile_reason));
    const coTurkana = await (await fetch(`${base}/county-outlook?county=turkana`)).json().catch(() => null);
    check('choropleth works in a second county', (coTurkana?.wards?.length ?? 0) > 0, `${coTurkana?.wards?.length ?? 0} Turkana wards`);

    // Ward-level API: the country-wide path
    const wardForecast = await fetch(`${base}/forecast?ward=kajiado--nkaimurunya&lang=en`);
    const wj = await wardForecast.json().catch(() => null);
    check('GET /forecast?ward= returns ward months', wardForecast.ok && Array.isArray(wj?.months) && wj.months.length > 0, `status ${wardForecast.status}, ${wj?.months?.length ?? 0} months`);
    check('ward forecast uses the precomputed baseline', wj?.baseline_source === 'era5_2005_2024_precomputed' && wj?.baseline_years === 20, `${wj?.baseline_source ?? '?'} / ${wj?.baseline_years ?? '?'} yr`);
    check('ward forecast names its ERA5 cell', Boolean(wj?.site?.cell?.key) && ['own', 'nearest'].includes(wj?.site?.cell?.source), JSON.stringify(wj?.site?.cell ?? null));
    check('ward months keep tercile + partial-month fields', (wj?.months ?? []).every((m) => 'tercile' in m && 'tercile_reason' in m && 'days_covered' in m));
    check('ward forecast partial months stay unknown', (wj?.months ?? []).every((m) => m.complete || m.tercile === 'unknown'));

    const wardAdvisory = await fetch(`${base}/advisory?ward=turkana--kalokol&lang=sw`);
    const waj = await wardAdvisory.json().catch(() => null);
    check('GET /advisory?ward= gives Swahili advice', wardAdvisory.ok && (waj?.advisory?.length ?? 0) > 0, `status ${wardAdvisory.status}, ${waj?.advisory?.length ?? 0} lines`);
    check('ward advisory names county and zone', waj?.county === 'Turkana' && Boolean(waj?.agro_ecology), `${waj?.county ?? '?'} / ${waj?.agro_ecology ?? '?'}`);
    check('ward advisory carries a crop decision', (waj?.structured?.recommended?.length ?? 0) + (waj?.structured?.avoid?.length ?? 0) > 0);

    const badWard = await fetch(`${base}/advisory?ward=nowhere--nothing`);
    check('unknown ward 404s', badWard.status === 404, `status ${badWard.status}`);

    // Curated pilot site still works (backwards compatibility)
    const forecast = await fetch(`${base}/forecast?site=gataka&lang=en`);
    const fj = await forecast.json().catch(() => null);
    check('GET /forecast?site=gataka returns the site object', forecast.ok && Boolean(fj?.site?.latitude), `status ${forecast.status}`);
    check('site carries county + ward for the choropleth', fj?.site?.county === 'Kajiado' && Boolean(fj?.site?.ward), `${fj?.site?.county ?? '?'} / ${fj?.site?.ward ?? '?'}`);
    check('site forecast reports its own baseline length', fj?.baseline_years === 20, `${fj?.baseline_years} years`);

    const advisory = await fetch(`${base}/advisory?site=gataka&lang=en`);
    const aj = await advisory.json().catch(() => null);
    check('GET /advisory returns advice lines', advisory.ok && Array.isArray(aj?.advisory) && aj.advisory.length > 0, `status ${advisory.status}, ${aj?.advisory?.length ?? 0} lines`);
    check(
      'advisory outlook drives the dashboard table',
      Array.isArray(aj?.outlook) && aj.outlook.every((m) => 'tercile' in m && 'confidence' in m && 'complete' in m),
      `${aj?.outlook?.length ?? 0} months`,
    );
    check('partial months are never classified', (aj?.outlook ?? []).every((m) => m.complete || m.tercile === 'unknown'), 'no tercile on a partial month');

    const ussd = await fetch(`${base}/ussd`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'text=1&ward=kajiado--nkaimurunya',
    });
    const ub = await ussd.text();
    check('POST /ussd answers a menu selection for a ward', ussd.ok && /^(CON|END) /.test(ub.trim()), `status ${ussd.status}, ${ub.trim().slice(0, 40)}`);
    check('farmer USSD shows no millimetres', !/\d+\s*mm/.test(ub), ub.match(/\d+\s*mm/)?.[0] ?? 'clean');

    const health = await (await fetch(`${base}/health`)).json();
    check('GET /health lists sites', Array.isArray(health?.sites) && health.sites.includes('gataka'), JSON.stringify(health?.sites ?? null));
    check('GET /health reports country coverage', health?.coverage?.counties === 47 && health?.coverage?.wards === 1452, JSON.stringify(health?.coverage ?? null));
    check('GET /health advertises the point routes', (health?.routes ?? []).some((r) => r.startsWith('/locate')) && (health?.routes ?? []).some((r) => r.startsWith('/kitchen')), (health?.routes ?? []).length + ' routes');

    // Precise point lookup: coordinate in, administrative unit out.
    const locate = await fetch(`${base}/locate?lat=-1.28496&lon=36.89468`);
    const lj = await locate.json().catch(() => null);
    check('GET /locate resolves a coordinate to an exact ward', locate.ok && lj?.exact === true && lj?.ward === 'Umoja II', `status ${locate.status}, ${lj?.county ?? '?'}/${lj?.ward ?? '?'}`);
    // The real regression guard. A loader that cannot reach the boundary assets
    // still returns a plausible ward from the centroid fallback, so `exact` alone
    // is not enough: assert the polygons were actually read.
    check('locate matched against real boundary geometry', (lj?.geometry_loaded ?? []).length > 0 && (lj?.geometry_errors ?? []).length === 0, `loaded ${(lj?.geometry_loaded ?? []).length}, errors ${JSON.stringify(lj?.geometry_errors ?? [])}`);
    check('locate names the sub-county and county', lj?.sub_county === 'Embakasi West' && lj?.county === 'Nairobi', `${lj?.sub_county ?? '?'} / ${lj?.county ?? '?'}`);
    check('locate returns a real elevation from the grid point', Number.isFinite(lj?.elevation_m) && lj.elevation_m > 1000 && lj.elevation_m < 2500, `${lj?.elevation_m ?? '?'} m`);
    check('locate carries the boundary attribution', typeof lj?.attribution === 'string' && lj.attribution.includes('CC BY 4.0'), String(lj?.attribution ?? '').slice(0, 40));

    const locateBad = await fetch(`${base}/locate?lat=abc&lon=1`);
    check('/locate rejects non-numeric coordinates', locateBad.status === 400, `status ${locateBad.status}`);
    const locateMissing = await fetch(`${base}/locate`);
    check('/locate requires lat and lon', locateMissing.status === 400, `status ${locateMissing.status}`);

    // A point in open water matches no ward polygon and must say so rather than guess silently.
    const locateWater = await fetch(`${base}/locate?lat=-0.4&lon=34.0`);
    const lwj = await locateWater.json().catch(() => null);
    check('/locate falls back honestly outside any ward', locateWater.ok && lwj?.exact === false && Number.isFinite(lwj?.distance_to_nearest_ward_centroid_km), `exact=${lwj?.exact}, ${lwj?.distance_to_nearest_ward_centroid_km ?? '?'} km`);

    const kitchen = await fetch(`${base}/kitchen?lat=-1.28496&lon=36.89468&aspect=shaded&water=purchased&tercile=below&lang=en`);
    const kj = await kitchen.json().catch(() => null);
    check('GET /kitchen returns container advice for a point', kitchen.ok && (kj?.recommended?.length ?? 0) > 0, `status ${kitchen.status}, ${kj?.recommended?.length ?? 0} crops`);
    check('kitchen advice schedules watering from ET0', Boolean(kj?.watering?.detail) && kj.watering.basis === 'heuristic_from_fao_et0', kj?.watering?.frequency ?? '?');
    check('a shaded balcony is not offered fruiting crops', (kj?.recommended ?? []).every((r) => r.crop_id !== 'tomato'), (kj?.recommended ?? []).map((r) => r.crop_id).join(','));
    check('kitchen advice flags bought water and a dry outlook', (kj?.warnings ?? []).some((w) => w.code === 'bought_water') && (kj?.warnings ?? []).some((w) => w.code === 'dry_season_outlook'), (kj?.warnings ?? []).map((w) => w.code).join(','));
    check('kitchen advice declares its data is an unverified draft', kj?.data_status === 'unverified_draft' && Boolean(kj?.caveat), kj?.data_status ?? '?');
    check('kitchen advice says what will NOT grow in a container', (kj?.unsuitable ?? []).length > 0, `${kj?.unsuitable?.length ?? 0} excluded`);

    const kitchenSw = await fetch(`${base}/kitchen?lat=-1.28496&lon=36.89468&aspect=full_sun&lang=sw`);
    const ksw = await kitchenSw.json().catch(() => null);
    check('kitchen advice localises to Swahili', kitchenSw.ok && (ksw?.recommended ?? []).some((r) => /Terere|Sukuma|Kunde|Nyanya/.test(r.name)), (ksw?.recommended ?? []).map((r) => r.name).join(','));

    const kitchenBad = await fetch(`${base}/kitchen?lat=-1.28496&lon=36.89468&tercile=bogus`);
    check('/kitchen validates the tercile', kitchenBad.status === 400, `status ${kitchenBad.status}`);

    const missing = await fetch(`${base}/nope`);
    check('unknown route 404s', missing.status === 404, `status ${missing.status}`);
  }
} catch (err) {
  check('probe run', false, String(err?.message ?? err));
  process.exitCode = 1;
} finally {
  server?.kill();
}

const failed = results.filter((r) => !r.ok);
console.log('');
console.log(`${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log(`failures: ${failed.map((f) => f.name).join(', ')}`);
  process.exitCode = 1;
}
