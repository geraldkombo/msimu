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
    const leafJs = await fetch(`${base}/vendor/leaflet/leaflet.js`);
    const leafCss = await fetch(`${base}/vendor/leaflet/leaflet.css`);
    check(
      'dashboard serves its own Leaflet copy, no CDN at runtime',
      leafJs.ok && leafCss.ok && homeBody.includes('/vendor/leaflet/') && !homeBody.includes('unpkg.com'),
      `js ${leafJs.status}, css ${leafCss.status}`,
    );
    check('dashboard has county and ward pickers', homeBody.includes('id="county"') && homeBody.includes('id="ward"'));
    check('dashboard loads the county list from the API', homeBody.includes("fetch('/counties')"));
    check('dashboard uses the county choropleth feed', /\/county-outlook\?county=/.test(homeBody));
    check('dashboard loads boundary files lazily per county', homeBody.includes('boundaries/'));
    check('no county is hardcoded into the dashboard', !homeBody.includes('kajiado-wards.geojson'));
    check('dashboard has legend + attribution nodes', homeBody.includes('id="legend"') && homeBody.includes('id="ward-attrib"'));
    check('dashboard has the food-security planner', homeBody.includes('id="bfood"') && homeBody.includes('id="fdwelling"') && homeBody.includes('id="bshare"') && homeBody.includes('id="fmat"') && homeBody.includes('id="bphoto"') && homeBody.includes('id="bsat"') && homeBody.includes('id="pnoon"') && homeBody.includes('id="surround-status"') && homeBody.includes('id="base-sat"') && homeBody.includes('/food-security?'));
    check('dashboard defaults to English', homeBody.includes('id="en" aria-pressed="true"') && homeBody.includes("let lang = 'en'"));
    check('dashboard attributes geoBoundaries', homeBody.includes('geoBoundaries'));
    check('dashboard has a main landmark and live status regions', homeBody.includes('<main>') && homeBody.includes('aria-live="polite"'));
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

    const ussdFood = await fetch(`${base}/ussd`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'text=4&ward=kajiado--nkaimurunya',
    });
    const ufb = await ussdFood.text();
    check('USSD option 4 returns the food and water plan', ussdFood.ok && /^END /.test(ufb.trim()) && /chakula|Food|mpango|plan/i.test(ufb), ufb.trim().slice(0, 50));
    const ussdSack = await fetch(`${base}/ussd`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'ward=kajiado--nkaimurunya&text=5&lang=en',
    });
    const usb = await ussdSack.text();
    check('USSD option 5 answers sack and container gardening', ussdSack.ok && /^END /.test(usb.trim()) && /sack|container/i.test(usb) && /wk \d/.test(usb), usb.trim().slice(0, 60));
    check('USSD food screen fits one screen', ufb.length <= 330, `${ufb.length} chars`);

    const health = await (await fetch(`${base}/health`)).json();
    check('GET /health lists sites', Array.isArray(health?.sites) && health.sites.includes('gataka'), JSON.stringify(health?.sites ?? null));
    check('GET /health reports country coverage', health?.coverage?.counties === 47 && health?.coverage?.wards === 1452, JSON.stringify(health?.coverage ?? null));
    check('GET /health advertises the point routes', (health?.routes ?? []).some((r) => r.startsWith('/locate')) && (health?.routes ?? []).some((r) => r.startsWith('/kitchen')) && (health?.routes ?? []).some((r) => r.startsWith('/skill')), (health?.routes ?? []).length + ' routes');

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
    check('kitchen advice declares its verification status and caveat', kj?.data_status === 'partially_verified' && Boolean(kj?.caveat), kj?.data_status ?? '?');
    check('kitchen advice says what will NOT grow in a container', (kj?.unsuitable ?? []).length > 0, `${kj?.unsuitable?.length ?? 0} excluded`);

    const kitchenSw = await fetch(`${base}/kitchen?lat=-1.28496&lon=36.89468&aspect=full_sun&lang=sw`);
    const ksw = await kitchenSw.json().catch(() => null);
    check('kitchen advice localises to Swahili', kitchenSw.ok && (ksw?.recommended ?? []).some((r) => /Terere|Sukuma|Kunde|Nyanya/.test(r.name)), (ksw?.recommended ?? []).map((r) => r.name).join(','));

    const kitchenBad = await fetch(`${base}/kitchen?lat=-1.28496&lon=36.89468&tercile=bogus`);
    check('/kitchen validates the tercile', kitchenBad.status === 400, `status ${kitchenBad.status}`);

    const skill = await fetch(`${base}/skill?lat=-1.4275&lon=36.6865&days=3`);
    const sj = await skill.json().catch(() => null);
    check('GET /skill returns the model accuracy scoreboard', skill.ok && (sj?.models?.length ?? 0) > 0 && sj?.data_status === 'live_verification', `status ${skill.status}, ${sj?.models?.length ?? 0} models scored`);
    check('scoreboard names its rank metric and its best model', Boolean(sj?.best_short_range?.label) && /mean absolute error/.test(sj?.rank_metric ?? ''), sj?.best_short_range ? `${sj.best_short_range.label} ${sj.best_short_range.mean_mae_mm}mm` : 'none');
    check('scoreboard keeps the not-a-rain-gauge caveat attached', /not a rain gauge/.test(sj?.caveat ?? ''), sj?.caveat ? 'caveat present' : 'MISSING');
    check('scoreboard reports the observed window itself', Number.isFinite(sj?.observed_total_mm) && Object.keys(sj?.observed_daily_mm ?? {}).length === 3, `total ${sj?.observed_total_mm} mm, ${sj?.wet_days ?? '?'} wet days`);
    const skillBad = await fetch(`${base}/skill?lat=-1.4275&lon=36.6865&days=999`);
    check('/skill validates the window length', skillBad.status === 400, `status ${skillBad.status}`);

    const foodWard = await fetch(`${base}/food-security?ward=kajiado--nkaimurunya&roof=30&people=4&lang=en`);
    const fw = await foodWard.json().catch(() => null);
    check('GET /food-security builds a ward household plan', foodWard.ok && fw?.data_status === 'planning_heuristic' && (fw?.lines?.length ?? 0) > 2, `status ${foodWard.status}, ${fw?.lines?.length ?? 0} lines`);
    check('ward plan uses the normals-based lean analysis', fw?.lean?.basis === 'rain_vs_et0_normals' && Number.isFinite(fw?.lean?.longest_streak), `${fw?.lean?.basis ?? '?'} streak ${fw?.lean?.longest_streak ?? '?'}`);
    check('the plan ships its Kenyan dataset sources', (fw?.sources ?? []).length >= 6 && (fw?.sources ?? []).some((s) => /spherestandards/.test(s.url ?? '')), `${(fw?.sources ?? []).length} sources`);

    const foodPoint = await fetch(`${base}/food-security?lat=-1.28496&lon=36.89468&lang=en&roof=0&people=2`);
    const fp = await foodPoint.json().catch(() => null);
    check('point plans degrade honestly to tercile_only', foodPoint.ok && fp?.lean?.basis === 'tercile_only', `status ${foodPoint.status}, basis ${fp?.lean?.basis ?? '?'}`);

    const foodDefault = await fetch(`${base}/food-security?ward=kajiado--nkaimurunya&lang=en`);
    const fd = await foodDefault.json().catch(() => null);
    check('household size defaults to the KNBS 2019 county mean, rounded up', foodDefault.ok && fd?.people_basis === 'knbs_2019_county' && fd?.inputs?.people === 4, `basis ${fd?.people_basis ?? '?'}, people ${fd?.inputs?.people ?? '?'}`);
    check('an explicit people= overrides the county default', fp?.people_basis === 'requested' && fp?.inputs?.people === 2, `basis ${fp?.people_basis ?? '?'}`);

    const foodFlat = await fetch(`${base}/food-security?ward=kajiado--nkaimurunya&dwelling=flat&lang=en`);
    const ff = await foodFlat.json().catch(() => null);
    check('flat dwellers get a bought-water plan, not a tank they cannot fill', foodFlat.ok && ff?.inputs?.dwelling === 'flat' && ff?.inputs?.roof_m2 === 0 && (ff?.lines ?? []).some((l) => /boil or treat/.test(l)), `dwelling ${ff?.inputs?.dwelling ?? '?'}, roof ${ff?.inputs?.roof_m2 ?? '?'}`);
    check('the flat plan swaps the private-roof chore for containers', !(ff?.lines ?? []).some((l) => /Clean the roof/.test(l)) && (ff?.lines ?? []).some((l) => /containers/.test(l)));
    const foodDwellBad = await fetch(`${base}/food-security?ward=kajiado--nkaimurunya&dwelling=castle`);
    check('/food-security validates the dwelling type', foodDwellBad.status === 400, `status ${foodDwellBad.status}`);

    const foodThatch = await fetch(`${base}/food-security?ward=kajiado--nkaimurunya&roof_material=thatch&lang=en`);
    const ft = await foodThatch.json().catch(() => null);
    check('a thatch roof sends the plan down the bought-water route', foodThatch.ok && ft?.inputs?.roof_m2 === 0 && (ft?.lines ?? []).some((l) => /thatch roof cannot harvest/.test(l)), `roof ${ft?.inputs?.roof_m2 ?? '?'}`);
    const foodMatBad = await fetch(`${base}/food-security?ward=kajiado--nkaimurunya&roof_material=gold`);
    check('/food-security validates the roof material', foodMatBad.status === 400, `status ${foodMatBad.status}`);
    check('the plan ships the verification desk', (fw?.verify_with ?? []).length >= 4 && (fw?.verify_with ?? []).some((v) => v.id === 'kephis_seed') && Boolean(fw?.verify_with?.[0]?.how?.sw), `${(fw?.verify_with ?? []).length} desk entries`);

    const photoBad = await fetch(`${base}/photo-roof`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ image: 'not-a-data-url' }) });
    check('POST /photo-roof validates the image payload', photoBad.status === 400, `status ${photoBad.status}`);
    const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const photoTiny = await fetch(`${base}/photo-roof`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ image: tinyPng }),
    });
    const pj = await photoTiny.json().catch(() => null);
    check('POST /photo-roof answers or admits the free lane shed', [200, 429, 503].includes(photoTiny.status) && (photoTiny.status !== 200 || ['iron_sheet', 'tiles', 'thatch', 'other'].includes(pj?.material)), `status ${photoTiny.status}, material ${pj?.material ?? '-'}`);
    const photoSat = await fetch(`${base}/photo-roof`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ image: tinyPng, source: 'satellite' }),
    });
    const psj = await photoSat.json().catch(() => null);
    check('POST /photo-roof takes the satellite source and echoes it', [200, 429, 503].includes(photoSat.status) && (photoSat.status !== 200 || psj?.source === 'satellite'), `status ${photoSat.status}, source ${psj?.source ?? '-'}`);

    const foodSw = await fetch(`${base}/food-security?ward=kajiado--nkaimurunya&lang=sw`);
    const fsw = await foodSw.json().catch(() => null);
    check('food plan localises to Swahili', foodSw.ok && (fsw?.lines ?? []).some((l) => /Mpango wa usalama wa chakula/.test(l)), String(fsw?.lines?.[0] ?? 'none').slice(0, 60));

    const foodBad = await fetch(`${base}/food-security?ward=kajiado--nkaimurunya&roof=99999`);
    check('/food-security validates the roof size', foodBad.status === 400, `status ${foodBad.status}`);
    const foodBad2 = await fetch(`${base}/food-security?ward=kajiado--nkaimurunya&people=0`);
    check('/food-security validates the household size', foodBad2.status === 400, `status ${foodBad2.status}`);

    check('GET /health advertises /food-security', (health?.routes ?? []).some((r) => r.startsWith('/food-security')), `${(health?.routes ?? []).length} routes`);

    const surrBad = await fetch(`${base}/surroundings`);
    check('/surroundings requires coordinates', surrBad.status === 400, `status ${surrBad.status}`);
    const surr = await fetch(`${base}/surroundings?lat=-1.286&lon=36.818`);
    const srj = await surr.json().catch(() => null);
    check(
      '/surroundings analyses the mapped neighbourhood or degrades honestly',
      surr.ok && srj?.data_status === 'osm_heuristic' && typeof srj?.buildings?.count === 'number' && 'suggestion' in srj && Boolean(srj?.caveat),
      `status ${surr.status}, buildings ${srj?.buildings?.count ?? '?'}, dwelling ${srj?.suggestion?.dwelling ?? 'null'}`,
    );
    check('GET /health advertises /surroundings', (health?.routes ?? []).some((r) => r.startsWith('/surroundings')), `${(health?.routes ?? []).length} routes`);
    const iploc = await fetch(`${base}/ip-location`);
    const ij = await iploc.json().catch(() => null);
    check(
      '/ip-location answers from the request metadata or admits it cannot',
      (iploc.status === 200 && ij?.basis === 'cloudflare_ip' && Number.isFinite(ij?.latitude)) || iploc.status === 404,
      `status ${iploc.status}, lat ${ij?.latitude ?? '-'}`,
    );

    const geoBad = await fetch(`${base}/geocode`);
    check('/geocode requires a query', geoBad.status === 400, `status ${geoBad.status}`);
    const geo = await fetch(`${base}/geocode?q=${encodeURIComponent('Gitanga Road Nairobi')}`);
    const gj = await geo.json().catch(() => null);
    check(
      '/geocode finds Kenyan places or admits the upstream is down',
      [200, 502, 503].includes(geo.status) && (geo.status !== 200 || ((gj?.results ?? []).length > 0 && Number.isFinite(gj.results[0].latitude))),
      `status ${geo.status}, results ${gj?.results?.length ?? '-'}`,
    );
    check('GET /health advertises /geocode', (health?.routes ?? []).some((r) => r.startsWith('/geocode')), `${(health?.routes ?? []).length} routes`);
    check('the dashboard offers place-name search', homeBody.includes('id="psearch"') && homeBody.includes('id="psearchgo"'), 'search row present');

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
