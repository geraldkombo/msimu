import { computeOutlook, fetchSeasonalMulti, outlookFromRaw, baselineFromCell, normalsFromCell } from '../src/climate.mjs';
import { buildAdvisory } from '../src/advisory.mjs';
import { supportedLocales } from '../src/i18n.mjs';
import { ussdResponse } from '../src/ussd.mjs';
import { crops, getSite, siteIds } from '../src/packs.mjs';
import { counties as allCounties, wardsForCounty, resolveWard, wardSite, cellFor, coverage as wardCoverage } from '../src/wards.mjs';
import { locatePoint, pointSite, workerGeometryLoader } from '../src/point.mjs';
import { buildKitchenAdvisory } from '../src/kitchen.mjs';
import { buildFoodSecurityPlan } from '../src/foodsecurity.mjs';
import { defaultHouseholdPeople } from '../src/households.mjs';
import { analyzeSurroundings, osmXmlToElements } from '../src/surroundings.mjs';
import {
  DEFAULT_MODELS,
  rollingWindow,
  scoreWindow,
  skillScoreboard,
  previousRunVariables,
} from '../src/skill.mjs';

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const cache = new Map();

/**
 * Roof-material classification from a photo. Bounded question, bounded answers:
 * the model may only say iron_sheet, tiles, thatch or other, and its verdict is
 * labelled a photo estimate the user confirms by eye. Every failure mode (rate
 * limit, timeout, unparsable answer, next model down, next lane down) falls
 * through, and the route answers 503 so the dashboard tells the user to pick
 * the material themselves. No key, no cost, no secrets.
 *
 * Lane order, decided 4 November 2026 after live probing:
 * 1. Cloudflare Workers AI free allowance via the AI binding - runs inside the
 *    Worker itself, no CORS, no third-party gateway, no retirement date. The
 *    binding wants the raw { image: bytes, prompt } shape; the OpenAI-style
 *    messages shape can silently return null content for the vision model.
 *    Llama 3.2 Vision has a one-time Meta licence gate, so the code answers it
 *    (prompt "agree") once and retries; LLaVA behind it has no gate.
 * 2. The keyless Kilo gateway lane as the off-platform fallback. Its dots
 *    model is a thinking model that needs a 1500-token budget or the answer is
 *    swallowed by hidden reasoning, and it carries a published 2026-12-31
 *    retirement date; the Nemotron VL free models either reason away small
 *    budgets or 422 with "media could not be screened", so they sit last.
 */
const CF_VISION_MODELS = [
  // json_object is honoured by the Llama vision model and, per the Workers AI
  // binding's documented behaviour, may come back as an already-parsed object
  // rather than a string - both shapes are handled below. LLaVA gets the plain
  // prompt because it does not implement response_format.
  { model: '@cf/meta/llama-3.2-11b-vision-instruct', json: true },
  { model: '@cf/llava-hf/llava-1.5-7b-hf', json: false },
];
const ROOF_VISION_MODELS = [
  { model: 'dots-studio/dots-3-note-preview:free', maxTokens: 1500, tries: 2 },
  { model: 'nvidia/nemotron-3.5-super-vl:free', maxTokens: 900, tries: 1 },
  { model: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free', maxTokens: 900, tries: 1 },
];
const ROOF_MATERIALS = ['iron_sheet', 'tiles', 'thatch', 'other'];
const ROOF_VISION_PROMPT =
  'Classify the roof in this photo into exactly one material: iron_sheet, tiles, thatch, other. Reply with JSON only, no prose: {"material":"...","confidence":"low|medium|high"}';
/**
 * Aerial imagery is a different problem from a phone photo: the model looks
 * straight down at a whole block, so the prompt has to say what the frame is,
 * where to look (the crosshair the dashboard draws), what each answer looks
 * like from above, and that roads, cars, shadows and yards are not roofs.
 * Without this the model answers "other" or guesses thatch on rust-coloured
 * mabati, which is exactly the failure mode seen in live testing on 5 Nov.
 */
const ROOF_SATELLITE_PROMPT =
  'This is a top-down satellite photograph of a neighbourhood in Kenya, about 30 to 60 metres across, at very high resolution. A thin white crosshair at the centre marks one spot. Classify the roofing material of the building under the crosshair; if the crosshair falls on a road, yard or open ground, classify the nearest building roof instead. Choose exactly one: iron_sheet = corrugated metal sheeting, by far the most common roof here, in rust red, brown, orange, blue, grey or white, showing thin parallel ridges; tiles = clay or concrete roof tiles, or a flat concrete slab; thatch = dry grass or makuti, dull yellow-brown, fuzzy irregular texture, mostly in rural areas; other = only if no building roof is visible anywhere near the crosshair. Roads, cars, trees, walls and shadows are not roofs. Reply with JSON only, no prose: {"material":"...","confidence":"low|medium|high"}';
const ROOF_SATELLITE_RETRY_PROMPT =
  'Look again at this top-down satellite photograph of Kenya. If there is a building roof at or very near the white crosshair at the centre, classify it as exactly one of: iron_sheet (corrugated metal sheeting in any colour: rust red, brown, orange, blue, grey, white), tiles (clay or concrete tiles or a flat concrete slab), thatch (dry grass). Answer other only if the area truly shows no buildings at all - open water, dense forest, or bare empty land. Reply with JSON only, no prose: {"material":"...","confidence":"low|medium|high"}';

function parseRoofVerdict(raw) {
  const text = String(raw ?? '');
  let parsed = null;
  const found = /\{[\s\S]*\}/.exec(text);
  if (found) {
    try {
      parsed = JSON.parse(found[0]);
    } catch {
      parsed = null;
    }
  }
  if (!parsed || !ROOF_MATERIALS.includes(parsed?.material)) {
    const bare = /\b(iron_sheet|tiles|thatch|other)\b/.exec(text);
    if (bare) parsed = { material: bare[1], confidence: 'low' };
  }
  if (!parsed || !ROOF_MATERIALS.includes(parsed?.material)) {
    // Models answer in natural language more often than in the requested enum:
    // "corrugated iron sheets", "clay tiles", "grass roof". Map the words, but
    // only ever to the four allowed answers, and only at low confidence.
    const nl = [
      [/\bthatch|makuti|straw roof|grass roof\b/i, 'thatch'],
      [/\btiles?\b|vigae|clay roof\b/i, 'tiles'],
      [/iron sheet|corrugated|\bmabati\b|metal roof|tin roof/i, 'iron_sheet'],
    ];
    for (const [re, material] of nl) {
      if (re.test(text)) {
        parsed = { material, confidence: 'low' };
        break;
      }
    }
  }
  if (!parsed || !ROOF_MATERIALS.includes(parsed?.material)) return null;
  return {
    material: parsed.material,
    confidence: ['low', 'medium', 'high'].includes(parsed?.confidence) ? parsed.confidence : 'low',
  };
}

function dataUrlToBytes(dataUrl) {
  const m = /^data:image\/[a-z+.-]+;base64,([\s\S]+)$/i.exec(String(dataUrl ?? ''));
  if (!m) return null;
  const bin = atob(m[1].replace(/\s+/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return [...bytes];
}

async function workersAiRoofVerdict(env, image, failures, prompt = ROOF_VISION_PROMPT) {
  if (typeof env?.AI?.run !== 'function') {
    failures.push('workers-ai:no_binding');
    return null;
  }
  const bytes = dataUrlToBytes(image);
  if (!bytes) {
    failures.push('workers-ai:bad_image');
    return null;
  }
  for (const { model, json } of CF_VISION_MODELS) {
    let agreed = false;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const input = { image: bytes, prompt, max_tokens: 200 };
        if (json) input.response_format = { type: 'json_object' };
        const out = await env.AI.run(model, input);
        const resp = out?.response;
        // With response_format the binding can hand back an already-parsed
        // object instead of a string; stringify so one parser sees one shape.
        const verdict = parseRoofVerdict(resp && typeof resp === 'object' ? JSON.stringify(resp) : resp);
        if (verdict) return { ...verdict, model, data_status: 'photo_estimate' };
        failures.push(`${model}:no_verdict`);
        break;
      } catch (err) {
        const msg = String(err?.message ?? err);
        if (!agreed && /agree|licen[cs]e/i.test(msg) && attempt === 1) {
          agreed = true;
          try {
            await env.AI.run(model, { prompt: 'agree', max_tokens: 8 });
          } catch {
            // consent refused at binding level: fall through to the next model
          }
          continue;
        }
        failures.push(`${model}:${msg.slice(0, 40)}`);
        break;
      }
    }
  }
  return null;
}

async function classifyRoofPhoto(image, env = {}, source = 'photo', promptOverride = null) {
  const failures = [];
  const prompt = promptOverride ?? (source === 'satellite' ? ROOF_SATELLITE_PROMPT : ROOF_VISION_PROMPT);
  const cf = await workersAiRoofVerdict(env, image, failures, prompt);
  if (cf) return { result: cf, failures };
  for (const { model, maxTokens, tries } of ROOF_VISION_MODELS) {
    for (let attempt = 1; attempt <= tries; attempt += 1) {
      try {
        const res = await fetch('https://api.kilo.ai/api/gateway/chat/completions', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model,
            max_tokens: maxTokens,
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'text', text: prompt },
                  { type: 'image_url', image_url: { url: image } },
                ],
              },
            ],
          }),
          signal: AbortSignal.timeout(30000),
        });
        if (!res.ok) {
          failures.push(`${model}:http_${res.status}`);
          break;
        }
        const j = await res.json();
        const finish = j?.choices?.[0]?.finish_reason ?? 'none';
        let raw = j?.choices?.[0]?.message?.content;
        if (Array.isArray(raw)) raw = raw.map((p) => (typeof p === 'string' ? p : p?.text ?? '')).join('');
        const verdict = parseRoofVerdict(raw);
        if (!verdict) {
          failures.push(`${model}:no_verdict:${finish}`);
          continue;
        }
        return { result: { ...verdict, model, data_status: 'photo_estimate' }, failures };
      } catch (err) {
        // shed, timeout or garbage: try again or fall through to the next model
        failures.push(`${model}:${String(err?.message ?? err).slice(0, 40)}`);
      }
    }
  }
  return { result: null, failures };
}

/**
 * Live climate at an exact coordinate.
 *
 * A point deserves its own data. The precomputed normals pack is incomplete, and
 * wards borrowing a distant cell would otherwise describe an Embakasi balcony
 * with numbers from 80 km away. So the point routes read ET0 and elevation
 * straight from Open-Meteo at the requested coordinate, and hand back a site with
 * no precomputed cell attached. computeOutlook then fetches the archive for that
 * exact point instead of reusing a neighbour's.
 */
async function pointClimate(lat, lon) {
  const qs = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    daily: 'et0_fao_evapotranspiration,precipitation_sum',
    forecast_days: '7',
    timezone: 'auto',
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${qs}`);
  if (!res.ok) throw Object.assign(new Error(`open-meteo HTTP ${res.status}`), { status: 502 });
  const data = await res.json();
  const et0Series = (data.daily?.et0_fao_evapotranspiration ?? []).filter((v) => Number.isFinite(v));
  return {
    elevation_m: data.elevation ?? null,
    grid: { latitude: data.latitude, longitude: data.longitude },
    et0_next7_mean: et0Series.length ? Math.round((et0Series.reduce((a, b) => a + b, 0) / et0Series.length) * 100) / 100 : null,
    et0_today: et0Series[0] ?? null,
  };
}

/** Resolve ?lat=&lon= into a point target, with its administrative unit attached. */
async function resolvePointTarget(url, env = {}) {
  const lat = Number(url.searchParams.get('lat'));
  const lon = Number(url.searchParams.get('lon'));
  if (!url.searchParams.has('lat') || !url.searchParams.has('lon')) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw Object.assign(new Error('lat and lon must be numbers'), { status: 400 });
  }
  const location = await locatePoint(lat, lon, workerGeometryLoader(url.origin, env?.ASSETS));
  const climate = await pointClimate(lat, lon);
  const site = pointSite({
    lat,
    lon,
    label: url.searchParams.get('label') ?? location.ward ?? `${lat}, ${lon}`,
    location: { ...location, elevation_m: climate.elevation_m },
  });
  return { key: `point:${lat.toFixed(4)},${lon.toFixed(4)}`, kind: 'point', site, location, climate };
}

/**
 * Two ways to address a place:
 *   ?site=gataka        curated pilot site with its own verified normals
 *   ?ward=<id|slug>     any of Kenya's 1452 wards, via its ERA5 grid cell
 * A ward outlook costs one seasonal request because the 2005-2024 baseline ships in the pack.
 */
export function resolveTarget({ ward, site } = {}) {
  if (ward) {
    const resolved = resolveWard(ward);
    if (!resolved) throw Object.assign(new Error(`unknown ward "${ward}"`), { status: 404 });
    return { key: `ward:${resolved.id}`, kind: 'ward', site: wardSite(resolved) };
  }
  const id = site ?? 'gataka';
  try {
    return { key: `site:${id}`, kind: 'site', site: getSite(id) };
  } catch (err) {
    throw Object.assign(new Error(err.message), { status: 404 });
  }
}

async function outlookFor(target) {
  const hit = cache.get(target.key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return { site: target.site, outlook: hit.value };
  const outlook = await computeOutlook(target.site);
  cache.set(target.key, { at: Date.now(), value: outlook });
  return { site: target.site, outlook };
}

function pickActive(months) {
  const usable = months.filter((m) => m.complete && m.tercile !== 'unknown');
  const key = new Date().toISOString().slice(0, 7);
  return usable.find((m) => m.month === key) ?? usable.find((m) => m.month >= key) ?? usable[0] ?? months[0];
}

async function advisoryFor({ target, lang, irrigation }) {
  const { site, outlook } = await outlookFor(target);
  const active = pickActive(outlook.months);
  const advisory = buildAdvisory({
    site,
    tercile: active?.tercile ?? 'unknown',
    confidence: active?.confidence ?? 'none',
    month: active?.calendar_month ?? new Date().getUTCMonth() + 1,
    locale: lang,
    irrigation,
    crops,
  });
  return { site, outlook, active, advisory };
}

const json = (data, init = {}) =>
  new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', ...init.headers },
  });

const text = (body, init = {}) =>
  new Response(body, {
    ...init,
    headers: { 'content-type': 'text/plain; charset=utf-8', ...init.headers },
  });

/**
 * Choropleth feed for one county: a single multi-point seasonal request over the county's distinct
 * ERA5 cells, classified against each cell's precomputed 2005-2024 tercile bands. Wards sharing a
 * cell share a forecast, which is exactly what a 0.25-degree reanalysis can support.
 */
async function countyOutlook(countyRef) {
  const wards = wardsForCounty(countyRef);
  if (wards.length === 0) throw Object.assign(new Error(`unknown county "${countyRef}"`), { status: 404 });
  const slug = wards[0].county_slug;
  const cacheKey = `county:${slug}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const cellKeys = [...new Set(wards.map((w) => w.cell))];
  const coords = cellKeys.map((k) => {
    const [lat, lon] = k.split(',').map(Number);
    return { lat, lon };
  });
  const forecasts = await fetchSeasonalMulti(coords);

  const monthsByCell = new Map();
  cellKeys.forEach((key, i) => {
    const ward = wards.find((w) => w.cell === key);
    const cell = cellFor(ward);
    const forecast = forecasts[i];
    if (!cell || !forecast) return;
    monthsByCell.set(key, outlookFromRaw({ forecast, baseline: baselineFromCell(cell), normals: normalsFromCell(cell) }));
  });

  const value = {
    county: wards[0].county,
    county_slug: slug,
    baseline_years: wards[0].sample_years ?? 20,
    models: { seasonal: 'ecmwf_seas5' },
    retrieved_at: new Date().toISOString(),
    cells: cellKeys.length,
    wards: wards.map((w) => {
      const months = monthsByCell.get(w.cell) ?? [];
      const active = pickActive(months) ?? null;
      return {
        id: w.id,
        slug: w.slug,
        name: w.name,
        sub_county: w.sub_county,
        latitude: w.latitude,
        longitude: w.longitude,
        agro_ecology: w.agro_ecology,
        cell: w.cell,
        cell_source: w.cell_source,
        cell_distance_km: w.cell_distance_km,
        month: active?.month ?? null,
        tercile: active?.tercile ?? 'unknown',
        tercile_reason: active?.tercile_reason ?? 'no_data',
        confidence: active?.confidence ?? 'none',
        forecast_mm: active?.forecast_mm ?? null,
        median_mm: active?.median_mm ?? null,
        anomaly_pct: active?.anomaly_pct ?? null,
      };
    }),
  };
  cache.set(cacheKey, { at: Date.now(), value });
  return value;
}

/**
 * Live model-skill scoreboard for any point, ward or site.
 *
 * Scores what five global models said BEFORE the rain against what fell, over a
 * rolling window ending yesterday (today's analysis blend is still settling).
 * Same pure core as scripts/verify-event.mjs, so the CLI and this route can
 * never drift apart. Cached 6h: the reference analysis does not change inside
 * an hour, so re-fetching would cost quota and buy nothing.
 */
async function skillFor({ lat, lon, label, ward, county, days, threshold, leadDays = 7 }) {
  const win = rollingWindow({ days });
  const key = `skill:${lat.toFixed(4)},${lon.toFixed(4)}:${win.endISO}:${days}:${threshold}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const obsQs = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    daily: 'precipitation_sum',
    start_date: win.startISO,
    end_date: win.endISO,
    timezone: 'auto',
  });
  const obsRes = await fetch(`https://api.open-meteo.com/v1/forecast?${obsQs}`);
  if (!obsRes.ok) {
    throw Object.assign(new Error(`open-meteo observed HTTP ${obsRes.status}`), { status: 502 });
  }
  const obsData = await obsRes.json();

  const prQs = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    hourly: previousRunVariables(leadDays).join(','),
    models: DEFAULT_MODELS.join(','),
    start_date: win.startISO,
    end_date: win.endISO,
    timezone: 'auto',
  });
  const prRes = await fetch(`https://previous-runs-api.open-meteo.com/v1/forecast?${prQs}`);
  if (!prRes.ok) {
    throw Object.assign(new Error(`open-meteo previous-runs HTTP ${prRes.status}`), { status: 502 });
  }
  const previousRuns = await prRes.json();

  const report = scoreWindow({
    target: { lat, lon, label, county, ward },
    startISO: win.startISO,
    endISO: win.endISO,
    observed: {
      times: obsData.daily?.time ?? [],
      values: obsData.daily?.precipitation_sum ?? [],
      snapped: {
        latitude: obsData.latitude ?? null,
        longitude: obsData.longitude ?? null,
        elevation_m: obsData.elevation ?? null,
      },
      source: 'Open-Meteo forecast API, daily precipitation_sum (best_match analysis)',
    },
    previousRuns,
    leadDays,
    threshold,
  });

  const value = {
    place: { label, latitude: lat, longitude: lon, ward, county },
    models_requested: DEFAULT_MODELS,
    sanity: report.sanity,
    ...skillScoreboard(report),
    generated_at: new Date().toISOString(),
  };
  cache.set(key, { at: Date.now(), value });
  return value;
}

export async function handle(request, env = {}) {
  const url = new URL(request.url);
  const siteId = url.searchParams.get('site') ?? 'gataka';
  const wardRef = url.searchParams.get('ward');
  const lang = url.searchParams.get('lang') ?? 'sw';
  const irrigation = url.searchParams.get('irrigation') === 'true';

  try {
    if (url.pathname === '/' || url.pathname === '/health') {
      const cov = wardCoverage();
      return json({
        service: 'msimu',
        status: 'ok',
        sites: siteIds(),
        coverage: {
          counties: allCounties().length,
          wards: cov.wards,
          era5_cells: cov.cells,
          wards_own_cell: cov.own,
          wards_nearest_cell: cov.nearest,
          baseline_years: cov.baseline_years,
        },
        locales: supportedLocales(),
        data: 'Open-Meteo Seasonal (ECMWF SEAS5) + Archive (ERA5 2005-2024). Boundaries: geoBoundaries gbOpen KEN, CC BY 4.0. No API key, no cost.',
        routes: [
          '/counties',
          '/wards?county=kajiado',
          '/locate?lat=-1.28496&lon=36.89468',
          '/forecast?ward=kajiado--nkaimurunya',
          '/forecast?lat=-1.28496&lon=36.89468',
          '/advisory?ward=kajiado--nkaimurunya&lang=sw',
          '/advisory?site=gataka&lang=sw',
          '/kitchen?lat=-1.28496&lon=36.89468&aspect=shaded&water=purchased&lang=en',
          '/skill?lat=-1.4275&lon=36.6865&days=7',
          '/food-security?ward=kajiado--nkaimurunya&roof=30&people=4&lang=en',
          '/surroundings?lat=-1.286&lon=36.818',
          '/ip-location',
          '/geocode',
          'POST /photo-roof',
          'POST /ussd',
        ],
        generated_at: new Date().toISOString(),
      });
    }

    if (url.pathname === '/counties') {
      return json({ counties: allCounties(), wards: wardCoverage() });
    }

    if (url.pathname === '/wards') {
      const county = url.searchParams.get('county');
      if (!county) return json({ error: 'county is required, see /counties' }, { status: 400 });
      const wards = wardsForCounty(county);
      if (wards.length === 0) return json({ error: `unknown county "${county}"` }, { status: 404 });
      return json({ county: wards[0].county, county_slug: wards[0].county_slug, ward_count: wards.length, wards });
    }

    if (url.pathname === '/county-outlook') {
      const county = url.searchParams.get('county');
      if (!county) return json({ error: 'county is required, see /counties' }, { status: 400 });
      return json(await countyOutlook(county));
    }

    if (url.pathname === '/forecast') {
      const target = (await resolvePointTarget(url, env)) ?? resolveTarget({ ward: wardRef, site: siteId });
      const { site, outlook } = await outlookFor(target);
      return json({
        place:
          target.kind === 'point'
            ? { kind: 'point', latitude: site.latitude, longitude: site.longitude, ward: target.location?.ward ?? null, sub_county: target.location?.sub_county ?? null, county: target.location?.county ?? null, boundary_exact: target.location?.exact ?? null }
            : target.kind === 'ward'
              ? { kind: 'ward', id: site.id, slug: site.slug, ward: site.ward, county: site.county, sub_county: site.sub_county, agro_ecology: site.agro_ecology, cell: site.cell }
              : { kind: 'site', id: siteId, name: site.name },
        site,
        site_name: site.name,
        elevation_m: outlook.elevation_m,
        baseline_years: outlook.baseline_years,
        baseline_source: outlook.baseline_source,
        models: outlook.models,
        retrieved_at: outlook.retrieved_at,
        months: outlook.months,
      });
    }

    if (url.pathname === '/advisory') {
      const target = (await resolvePointTarget(url, env)) ?? resolveTarget({ ward: wardRef, site: siteId });
      const { site, outlook, active, advisory } = await advisoryFor({ target, lang, irrigation });
      if (url.searchParams.get('format') === 'text') return text(advisory.text);
      return json({
        site: site.name,
        county: target.location?.county ?? site.county ?? null,
        sub_county: target.location?.sub_county ?? site.sub_county ?? null,
        ward: target.location?.ward ?? site.ward ?? null,
        agro_ecology: site.agro_ecology ?? null,
        cell: site.cell ?? null,
        month: active?.month ?? null,
        tercile: active?.tercile ?? 'unknown',
        confidence: active?.confidence ?? 'none',
        forecast_mm: active?.forecast_mm ?? null,
        median_mm: active?.median_mm ?? null,
        advisory: advisory.lines,
        structured: advisory.structured,
        outlook: outlook.months,
      });
    }

    if (url.pathname === '/ussd') {
      if (request.method !== 'POST') return text('POST only', { status: 405 });
      const raw = await request.text();
      const params = new URLSearchParams(raw);
      const target = resolveTarget({
        ward: params.get('ward') ?? wardRef,
        site: params.get('site') ?? siteId,
      });
      const { site, outlook, advisory } = await advisoryFor({ target, lang: params.get('lang') ?? lang, irrigation: false });
      // USSD cannot ask for a roof size or household count, so option 4 plans
      // with the standard 30 m2 roof and the KNBS county household default.
      // A failure here must not take the menu down: food degrades to null.
      let food = null;
      try {
        const { people } = defaultHouseholdPeople(site?.county ?? null);
        food = buildFoodSecurityPlan({
          site,
          outlook,
          crops,
          roof_m2: 30,
          people,
          locale: lang,
          now: new Date().toISOString().slice(0, 7),
        });
      } catch {
        food = null;
      }
      const result = ussdResponse(params.get('text') ?? '', { site, advisory, outlook, crops, food, locale: lang });
      return text(`${result.end ? 'END' : 'CON'} ${result.body}`);
    }

    if (url.pathname === '/locate') {
      const lat = Number(url.searchParams.get('lat'));
      const lon = Number(url.searchParams.get('lon'));
      if (!url.searchParams.has('lat') || !url.searchParams.has('lon')) {
        return json({ error: 'lat and lon are required, e.g. /locate?lat=-1.28496&lon=36.89468' }, { status: 400 });
      }
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        return json({ error: 'lat and lon must be numbers' }, { status: 400 });
      }
      const location = await locatePoint(lat, lon, workerGeometryLoader(url.origin, env?.ASSETS));
      const climate = await pointClimate(lat, lon).catch(() => null);
      return json({
        requested: { latitude: lat, longitude: lon },
        grid_point: climate?.grid ?? null,
        elevation_m: climate?.elevation_m ?? null,
        ...location,
        et0_today_mm: climate?.et0_today ?? null,
      });
    }

    /**
     * IP-based location from Cloudflare's own request metadata: free, keyless,
     * no external call, and it works indoors where a GPS fix will not. Accuracy
     * is city-level at best, so the payload says so and the dashboard labels it
     * as approximate and invites correction.
     */
    if (url.pathname === '/ip-location') {
      const cf = request.cf ?? null;
      const lat = Number(cf?.latitude);
      const lon = Number(cf?.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        return json({ error: 'IP location is unavailable on this request; enter coordinates manually' }, { status: 404 });
      }
      return json({
        latitude: lat,
        longitude: lon,
        basis: 'cloudflare_ip',
        accuracy: 'city_approx',
        note: 'City-level estimate from your internet connection, not a GPS fix. Check the pin before trusting the plan.',
      });
    }

    /**
     * Place-name search: "Canopy Residence Gitanga" in, coordinates out. Free
     * and keyless via OpenStreetMap Nominatim, proxied through the worker so
     * the page's CSP stays same-origin-only and the upstream sees one stable
     * user agent. Kenya-scoped on purpose: this is the Kenya pack, and a hard
     * country filter beats a confident pin in the wrong country. Results carry
     * the OSM display name so the user picks with their eyes, and the
     * dashboard still asks for confirmation - a search hit is a suggestion,
     * not a fix.
     */
    if (url.pathname === '/geocode') {
      const q = (url.searchParams.get('q') ?? '').trim();
      if (!q || q.length > 120) {
        return json({ error: 'q is required, at most 120 characters' }, { status: 400 });
      }
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=3&countrycodes=ke&addressdetails=0&q=${encodeURIComponent(q)}`,
          {
            headers: {
              'user-agent': 'Msimu seasonal advisory (https://msimu.shikunyi.workers.dev; geraldshikunyi@gmail.com)',
              'accept-language': 'en,sw',
            },
            signal: AbortSignal.timeout(10000),
          },
        );
        if (!res.ok) {
          return json({ error: 'place search upstream is unhappy', upstream_status: res.status }, { status: 502 });
        }
        const arr = await res.json();
        const results = (Array.isArray(arr) ? arr : [])
          .map((r) => ({
            name: String(r?.name ?? r?.display_name ?? '').split(',')[0],
            display_name: String(r?.display_name ?? ''),
            latitude: Number(r?.lat),
            longitude: Number(r?.lon),
            kind: [r?.class, r?.type].filter(Boolean).join(':'),
          }))
          .filter((r) => Number.isFinite(r.latitude) && Number.isFinite(r.longitude));
        return json(
          {
            query: q,
            results,
            source: 'nominatim_openstreetmap',
            note: 'Place search from OpenStreetMap. Confirm the pin before trusting the plan.',
          },
          { headers: { 'cache-control': 'public, max-age=86400' } },
        );
      } catch (err) {
        return json({ error: 'place search unavailable right now', detail: String(err?.message ?? err).slice(0, 60) }, { status: 503 });
      }
    }

    /**
     * What is mapped around a point: buildings and land use from OpenStreetMap
     * (Overpass), place name from Nominatim - both free and keyless. The pure
     * analyzer turns it into a dwelling/material suggestion for the food plan.
     * OSM coverage is uneven, so every failure degrades to an honest partial
     * answer rather than a 5xx.
     */
    if (url.pathname === '/surroundings') {
      const lat = Number(url.searchParams.get('lat'));
      const lon = Number(url.searchParams.get('lon'));
      if (!url.searchParams.has('lat') || !url.searchParams.has('lon')) {
        return json({ error: 'lat and lon are required, e.g. /surroundings?lat=-1.286&lon=36.818' }, { status: 400 });
      }
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
        return json({ error: 'lat and lon must be numbers within -90..90 and -180..180' }, { status: 400 });
      }
      const key = `surr:${lat.toFixed(3)},${lon.toFixed(3)}`;
      const hit = cache.get(key);
      if (hit && Date.now() - hit.at < hit.ttl) return json(hit.value);

      const UA = 'Msimu food-security planner (https://msimu.shikunyi.workers.dev; geraldshikunyi@gmail.com)';
      const notes = [];
      let elements = [];
      let sourceOk = false;
      // Source order, decided 4 November 2026 after live probing from both a
      // workstation and the deployed Worker: the official OSM API answers a
      // small bbox in ~2 s every time, while every public Overpass mirror was
      // shedding (overpass-api.de 521s datacenter IPs, kumi and private.coffee
      // timed out, osm.ch returned an incomplete planet). So the bbox call is
      // primary and the mirrors are the fallback, not the other way round.
      const half = 0.0055; // ~610 m: covers the 300 m building ring and the 550 m land ring
      try {
        const bbox = [lon - half, lat - half, lon + half, lat + half].map((n) => n.toFixed(5)).join(',');
        const res = await fetch(`https://api.openstreetmap.org/api/0.6/map?bbox=${bbox}`, {
          headers: { 'user-agent': UA },
          signal: AbortSignal.timeout(15000),
        });
        if (res.ok) {
          elements = osmXmlToElements(await res.text(), lat, lon);
          sourceOk = true;
        } else {
          notes.push(`osm_api:http_${res.status}`);
        }
      } catch (err) {
        notes.push(`osm_api:${String(err?.message ?? err).slice(0, 30)}`);
      }
      if (!sourceOk) {
        const query = `[out:json][timeout:10];(way["building"](around:300,${lat},${lon});way["landuse"~"farmland|farmyard|orchard|meadow|greenhouse_horticulture"](around:550,${lat},${lon});way["leisure"~"garden|park"](around:550,${lat},${lon}););out tags center 80;`;
        for (const endpoint of [
          'https://overpass.kumi.systems/api/interpreter',
          'https://overpass-api.de/api/interpreter',
          'https://overpass.private.coffee/api/interpreter',
        ]) {
          try {
            const res = await fetch(endpoint, {
              method: 'POST',
              headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': UA },
              body: `data=${encodeURIComponent(query)}`,
              signal: AbortSignal.timeout(12000),
            });
            if (res.ok) {
              elements = (await res.json())?.elements ?? [];
              sourceOk = true;
              break;
            }
            notes.push(`overpass:${new URL(endpoint).hostname}:http_${res.status}`);
          } catch (err) {
            notes.push(`overpass:${new URL(endpoint).hostname}:${String(err?.message ?? err).slice(0, 30)}`);
          }
        }
      }
      let reverse = null;
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=jsonv2&zoom=16`,
          { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(9000) },
        );
        if (res.ok) reverse = await res.json();
        else notes.push(`nominatim:http_${res.status}`);
      } catch (err) {
        notes.push(`nominatim:${String(err?.message ?? err).slice(0, 40)}`);
      }
      const value = {
        requested: { latitude: lat, longitude: lon },
        ...analyzeSurroundings({ elements, reverse }),
        ...(notes.length ? { upstream_notes: notes } : {}),
      };
      // A complete answer (a map source responded) is stable data: cache 24 h.
      // A degraded one only gets 10 minutes so a source retry can heal it soon.
      cache.set(key, { at: Date.now(), ttl: sourceOk ? 24 * 60 * 60 * 1000 : 10 * 60 * 1000, value });
      return json(value);
    }

    if (url.pathname === '/kitchen') {
      const point = await resolvePointTarget(url, env);
      if (!point) {
        return json(
          { error: 'lat and lon are required, e.g. /kitchen?lat=-1.28496&lon=36.89468&aspect=shaded&water=purchased&lang=en' },
          { status: 400 },
        );
      }
      const tercile = url.searchParams.get('tercile') ?? 'near';
      if (!['below', 'near', 'above'].includes(tercile)) {
        return json({ error: 'tercile must be below, near or above' }, { status: 400 });
      }
      const advisory = buildKitchenAdvisory({
        site: point.site,
        et0: point.climate.et0_next7_mean ?? point.climate.et0_today,
        tercile,
        month: Number(url.searchParams.get('month')) || new Date().getUTCMonth() + 1,
        aspect: url.searchParams.get('aspect') ?? 'unknown',
        waterSource: url.searchParams.get('water') ?? 'unknown',
        locale: lang,
        crops,
      });
      return json({
        ...advisory,
        location: point.location,
        grid_point: point.climate.grid,
        elevation_m: point.climate.elevation_m,
        et0_next7_mean_mm: point.climate.et0_next7_mean,
      });
    }

    if (url.pathname === '/skill') {
      const days = Number(url.searchParams.get('days') ?? '7');
      if (!Number.isFinite(days) || days < 2 || days > 30) {
        return json({ error: 'days must be a number from 2 to 30' }, { status: 400 });
      }
      const threshold = Number(url.searchParams.get('threshold') ?? '1');
      if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 50) {
        return json({ error: 'threshold must be a number above 0 and at most 50 mm' }, { status: 400 });
      }
      let lat;
      let lon;
      let label = null;
      let wardName = null;
      let countyName = null;
      if (url.searchParams.has('lat') || url.searchParams.has('lon')) {
        lat = Number(url.searchParams.get('lat'));
        lon = Number(url.searchParams.get('lon'));
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
          return json({ error: 'lat and lon must be numbers' }, { status: 400 });
        }
        const location = await locatePoint(lat, lon, workerGeometryLoader(url.origin, env?.ASSETS)).catch(() => null);
        wardName = location?.ward ?? null;
        countyName = location?.county ?? null;
        label = wardName ? `${wardName} (${lat}, ${lon})` : `${lat}, ${lon}`;
      } else {
        const target = resolveTarget({ ward: wardRef, site: siteId });
        const s = target.site;
        if (!s) return json({ error: `unknown site "${siteId}"` }, { status: 404 });
        lat = s.latitude;
        lon = s.longitude;
        label = s.name;
        wardName = s.ward ?? null;
        countyName = s.county ?? null;
      }
      return json(await skillFor({ lat, lon, label, ward: wardName, county: countyName, days, threshold }));
    }

    /**
     * Household food-security plan: stance, lean months, planting window with
     * harvest dates, and a water-storage size. Works for wards (full normals
     * analysis), curated sites, and bare points (honest tercile_only degrade).
     * roof=0 is valid: bought-water households get a storage number too.
     */
    if (url.pathname === '/food-security') {
      const target = (await resolvePointTarget(url, env)) ?? resolveTarget({ ward: wardRef, site: siteId });
      const { site, outlook } = await outlookFor(target);
      const dwelling = url.searchParams.get('dwelling') ?? 'house';
      if (!['house', 'flat'].includes(dwelling)) {
        return json({ error: 'dwelling must be house or flat' }, { status: 400 });
      }
      const roofMaterial = url.searchParams.get('roof_material') ?? 'iron';
      if (!['iron', 'tiles', 'thatch'].includes(roofMaterial)) {
        return json({ error: 'roof_material must be iron, tiles or thatch' }, { status: 400 });
      }
      // A flat has no roof of its own: unless the caller states a shared-roof
      // share, the plan runs the bought-water route instead of a tank size.
      const roof = Number(url.searchParams.get('roof') ?? (dwelling === 'flat' ? '0' : '30'));
      if (!Number.isFinite(roof) || roof < 0 || roof > 1000) {
        return json({ error: 'roof must be a number of square metres from 0 to 1000' }, { status: 400 });
      }
      // An explicit people= always wins. Without it the plan defaults to the
      // KNBS 2019 county household mean rounded up (national 4 when the county
      // is unknown), and the payload says which basis was used.
      let people;
      let peopleBasis;
      const peopleParam = url.searchParams.get('people');
      if (peopleParam !== null && peopleParam !== '') {
        people = Number(peopleParam);
        if (!Number.isFinite(people) || people < 1 || people > 30) {
          return json({ error: 'people must be a number from 1 to 30' }, { status: 400 });
        }
        peopleBasis = 'requested';
      } else {
        const county = (target.kind === 'point' ? target.location?.county : site?.county) ?? null;
        const dflt = defaultHouseholdPeople(county);
        people = dflt.people;
        peopleBasis = dflt.basis;
      }
      const plan = buildFoodSecurityPlan({
        site,
        outlook,
        crops,
        roof_m2: roof,
        people,
        dwelling,
        roof_material: roofMaterial,
        locale: lang,
        now: new Date().toISOString().slice(0, 7),
      });
      return json({
        place:
          target.kind === 'point'
            ? { kind: 'point', latitude: site.latitude, longitude: site.longitude, ward: target.location?.ward ?? null, county: target.location?.county ?? null }
            : target.kind === 'ward'
              ? { kind: 'ward', id: site.id, ward: site.ward, county: site.county, sub_county: site.sub_county, agro_ecology: site.agro_ecology }
              : { kind: 'site', id: siteId, name: site.name },
        ...plan,
        people_basis: peopleBasis,
      });
    }

    /**
     * Photo assist: what is the roof made of? The one photo question whose
     * answer changes the water plan. Free keyless vision lane, enum-locked
     * answers, honest fallback when the lane sheds.
     */
    if (url.pathname === '/photo-roof') {
      if (request.method !== 'POST') return text('POST only', { status: 405 });
      const body = await request.json().catch(() => null);
      const image = String(body?.image ?? '');
      if (!/^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=\s]+$/.test(image) || image.length > 2000000) {
        return json({ error: 'send {"image": "data:image/png;base64,..."} of at most about 1.5 MB' }, { status: 400 });
      }
      const source = body?.source === 'satellite' ? 'satellite' : 'photo';
      let { result, failures } = await classifyRoofPhoto(image, env, source);
      if (result && source === 'satellite' && result.material === 'other') {
        // "other" from orbit is almost always the model shrugging at a frame it
        // was never told how to read. Ask once more, insisting a roof is there,
        // before admitting defeat - and record that a retry happened.
        failures.push('satellite:other_retry');
        const retry = await classifyRoofPhoto(image, env, source, ROOF_SATELLITE_RETRY_PROMPT);
        failures = failures.concat(retry.failures);
        if (retry.result && retry.result.material !== 'other') result = retry.result;
      }
      if (!result) {
        return json(
          { error: 'photo check unavailable right now; pick the roof material yourself', detail: failures },
          { status: 503 },
        );
      }
      return json({ ...result, source, ...(failures.length ? { lane_notes: failures } : {}) });
    }

    return json({ error: 'not found', routes: ['/health', '/counties', '/wards', '/locate', '/forecast', '/advisory', '/kitchen', '/skill', '/food-security', '/surroundings', '/ip-location', '/geocode', '/photo-roof', '/ussd'] }, { status: 404 });
  } catch (err) {
    return json(
      { error: String(err?.message ?? err), site: wardRef ? null : siteId, ward: wardRef ?? null },
      { status: err?.status === 404 ? 404 : 500 },
    );
  }
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET,POST,OPTIONS',
          'access-control-allow-headers': 'content-type',
        },
      });
    }
    return handle(request, env);
  },
};
