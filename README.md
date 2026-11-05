# Msimu

**Forecast in, farming decision out.**

Msimu turns a raw seasonal climate forecast into a specific instruction a smallholder in any of Kenya's 1452 wards can act on today - what to plant, how long it takes to mature, what *not* to plant, and what to do about livestock water - delivered in Swahili on the basic phone already in the farmer's pocket.

Most climate products in the region are dashboards. They show rainfall to a user who then has to do the agronomy themselves. Msimu does the agronomy and delivers the decision.

[![CI](https://github.com/geraldkombo/msimu/actions/workflows/ci.yml/badge.svg)](https://github.com/geraldkombo/msimu/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Dependencies: zero](https://img.shields.io/badge/dependencies-zero-brightgreen)](./package.json)

**Live:** <https://msimu.shikunyi.workers.dev> - dashboard, JSON API and USSD endpoint on one Cloudflare Worker. Country-wide build on the finished 403-cell normals pack (version `0d99597b`): food-security plan with KNBS county household defaults, flat-dweller mode, roof length x width with material and photo check, the verification desk, WhatsApp sharing, English-first dashboard, USSD food screen, roof-photo material check on the Cloudflare Workers AI free allowance, GPS-with-IP-fallback location that works indoors, and OpenStreetMap surroundings analysis that auto-suggests the food-form inputs - verified with `npm run probe:live` (107/107 checks).

---

## Run it in two commands

No `npm install`. There is nothing to install - the engine uses only Node built-ins.

```bash
node --test "tests/*.test.mjs"                 # 168 tests, all offline, no network
node src/cli.mjs --ward kajiado--nkaimurunya   # live advisory for any ward in Kenya
```

Other entry points:

```bash
node src/cli.mjs --list-counties                            # all 47 counties and their ward counts
node src/cli.mjs --list-wards --county turkana              # every ward in a county, with its zone
node src/cli.mjs --ward turkana--kalokol --lang sw          # any ward, by slug, id or "county/name"
node src/cli.mjs --site gataka --lang en                    # the curated pilot site, in English
node src/cli.mjs --site gataka --irrigation                 # assume irrigation access
node src/cli.mjs --site gataka --json                       # machine-readable
node scripts/smoke-worker.mjs                               # exercise every HTTP + USSD route
npm run verify-bands                                        # leave-one-out verification of the tercile bands
npm run probe                                               # 107 end-to-end HTTP checks: dashboard + API + USSD
npm run probe:live                                          # the same 107 checks against the deployed Worker
npm run deploy:dry                                          # bundle check, no upload (needs wrangler login)
npm run deploy                                              # deploy Worker + dashboard assets to Cloudflare
npm run serve                                               # dashboard + API on http://localhost:8080
npm run wards                                               # re-fetch all 47 county boundary files (geoBoundaries)
npm run normals                                             # build/extend ERA5 normals per grid cell (resumable)
npm run check-wards                                         # offline integrity check of boundaries + climate pack
npm run dedash:check                                        # style guard: no long dashes anywhere
npm run dev                                                 # Cloudflare Worker locally (needs wrangler)
```

Requires **Node 22+** (developed on Node 24). Uses the global `fetch` and `node:test`.

`npm run serve` starts a zero-dependency server that mounts the Worker handler and the static dashboard on one origin - the same topology used in production, so the page's relative `fetch('/advisory')` needs no CORS config. Override the port with `PORT=3000 npm run serve`.

---

## What it actually outputs

Real output from a live run on 2026-10-28, unedited:

```
=== Gataka, Nkaimurunya Ward (Kajiado) | 1800 m | baseline 20 yr ===

Month      Forecast  Median  Mean  Anomaly  Tercile      Conf     Days
2026-10        8mm     33mm    57mm     -77%  unknown      none     PARTIAL 4/31
2026-11       96mm     86mm    99mm      12%  above        high     30/30
2026-12       54mm     42mm    58mm      28%  near         high     31/31
2027-01       31mm     18mm    36mm      73%  above        high     31/31
2027-02        9mm     23mm    42mm     -59%  below        high     28/28
2027-03      144mm     43mm    67mm     237%  above        high     31/31
2027-04      186mm    157mm   142mm      19%  above        high     30/30
2027-05       10mm     80mm    81mm     -88%  unknown      none     PARTIAL 25/31

=== ADVISORY (sw) ===
Ushauri wa Gataka, Nkaimurunya Ward, Kajiado North.
Mvua za vuli: mvua zinatarajiwa kuwa juu ya kawaida - Uhakika wa juu.
Mbegu: Terere (Amaranth), Kunde (Cowpea), Ndengu (Green gram) - panda wiki hii.
- Terere (Amaranth): 30-45 siku
- Kunde (Cowpea): 60-70 siku
- Ndengu (Green gram): 60-70 siku
Mvua ya mwaka hapa ni 44% tu ya maji yanayohitajika na mimea. Mahindi ya mvua pekee ni kamari.
Onyo (uangalizi): Mvua inatarajiwa kuwa juu ya kawaida. Hatari kuu ni mafuriko kwenye ardhi ya chini na magonjwa ya mimea.
...
Chanzo: ECMWF SEAS5 via Open-Meteo, tercile vs ERA5 2005-2024.
```

The same engine renders a USSD session for a feature phone:

```
CON Karibu Msimu - Gataka, Nkaimurunya Ward.
    1. Ushauri wa kupanda
    2. Hali ya mvua msimu huu
    3. Kuhusu huduma hii

> 1
END Mvua za vuli: mvua zinatarajiwa kuwa juu ya kawaida - Uhakika wa juu.
    Panda: Terere (30-45 siku), Kunde (60-70 siku), Ndengu (60-70 siku).
    Onyo (uangalizi): Mvua inatarajiwa kuwa juu ya kawaida.
```

---

## Independent validation of the forecast source

The pilot site's coordinates were sent to a free, keyless API that has never been told anything about this location. It returned an elevation of **1800 m**, matching the independently documented site elevation, and a seasonal outlook that reproduces the site's real bimodal rainfall regime: short-rains peak in **November**, long-rains peak in **April**, dry **January-February**.

| Month | SEAS5 | ERA5 median | Anomaly | Tercile | Confidence |
|---|---|---|---|---|---|
| Nov 2026 | 96 mm | 86 mm | +12 % | above | high |
| Dec 2026 | 54 mm | 42 mm | +28 % | near | high |
| Jan 2027 | 31 mm | 18 mm | +73 % | above | high |
| Feb 2027 | 9 mm | 23 mm | -59 % | below | high |
| Mar 2027 | 144 mm | 43 mm | +237 % | above | high |
| Apr 2027 | 186 mm | 157 mm | +19 % | above | high |

Reproduce it yourself: `node src/cli.mjs --site gataka`.

### The accuracy scoreboard: published, rolling, free

Msimu publishes the number the industry does not: a live model-accuracy scoreboard. `GET /skill?lat=...&lon=...&days=7` (also by ward or site) reconstructs what five global models - ECMWF IFS 0.25, NOAA GFS, DWD ICON, MeteoFrance, UKMO - said *before* the rain, from the free Open-Meteo Previous Runs API, and scores it against what fell over a rolling window ending yesterday. Every payload ranks models by mean absolute error in millimetres, reports CSI alongside it, flags when the categorical score saturates, names the reference series as an analysis blend and not a rain gauge, and refuses to report a score if the lead-time offsets look unparsed (identical totals across leads are rejected as an artifact). The dashboard has a button for it; the CLI equivalent is `scripts/verify-event.mjs`. Both share one pure scoring core, `src/skill.mjs`, so the API and the CLI can never drift apart. Example live output for Kiserian over 25-31 October 2026: DWD ICON best at 0-2 day leads (1.76 mm mean error), ECMWF worst on bias (+2.87 mm) - the opposite of its one-event win on 30-31 October, which is exactly why a rolling public scoreboard matters more than any single table.

### The food-security plan: surviving the lean season

`GET /food-security?ward=<slug>` (or `?lat=&lon=`, plus `roof=` m2 and `people=`) turns the same outlook into a household survival plan: a stance (prepare now / caution / good season), the lean-month calendar, a planting window with plant-by and harvest months for every hardy staple, and a drinking-water storage size computed from roof catchment. It is the lockdown-lesson safety net: buffer water, bridge the hungry months, buy before prices rise, dry and store properly, and grow in containers when there is no land. Wards get the full analysis - lean months measured from the cell's 20-year rain median versus ET0 median, circular longest streak included - and the wet-month rule follows the FAO Kenya AEZ growing-period definition (rain >= 0.5 x ET0, floor 30 mm). Points without precomputed normals degrade honestly to `basis: tercile_only`. `roof=0` is valid: bought-water households get a storage number instead of a tank size. Every constant is backed by a public Kenyan or authoritative dataset (Sphere 15 L/person/day, KNBS 2019 average household size 3.9, KEPHIS/KALRO maturity windows, FEWS NET/NDMA lean-season calendars), mapped with verbatim evidence in `docs/FOOD-SECURITY-SOURCES.md` and shipped inside every payload as `sources`. The payload keeps `data_status: planning_heuristic` and its caveat attached: a planning tool, never a guarantee. When `people=` is omitted the plan defaults to the KNBS 2019 county household mean rounded up (Nairobi 3, Kajiado 4, Mandera 7; national 4 when the county is unknown) and records the basis in `people_basis` - table and provenance in `docs/knbs-2019-household-size-by-county.md`. `dwelling=flat` is the reality for most urban Kenya: the roof is shared, so the plan drops the private-roof chores, runs the bought-water storage route (or a stated roof share), always offers the container-growing line, and adds a boil-or-treat water-safety line; `inputs.dwelling` echoes the choice. The dashboard is English-first with a SW/EN switch, a dwelling selector, auto-rebuild when the ward or point target changes (no stale plans for the wrong location), readable month names in the planting table, and a Share button that hands the plan to WhatsApp/SMS via the Web Share API with clipboard fallback. USSD option 4 serves the same plan on a feature phone within one screen. `roof_material=` (iron, tiles, thatch) gates the harvesting route: thatch cannot harvest water at all, so the plan switches to bought water and says so in plain words, and the dashboard takes roof size as length x width of the footprint, not the slope. `POST /photo-roof` answers the one photo question that changes the plan - what the roof is made of - on Cloudflare Workers AI's free allowance (Llama 3.2 Vision, LLaVA behind it, keyless vision gateways last), enum-locked to four answers, labelled `photo_estimate`, and confirmed by the user's own eyes; phone photos are downscaled in the browser before upload, and when every lane sheds, the dashboard falls back to picking the material by hand. And because "confirm with your ward extension officer" is useless unless the household knows who that is, every plan ships `verify_with`: the sub-county agriculture office, the KEPHIS certified-seed sticker check, the KALRO variety selector, the NDMA drought bulletin and county-published contact pages, all from saved public sources with no invented phone numbers (`docs/KENYA-VERIFICATION-DESK.md`).

### Two statistical decisions worth defending

**1. Anomaly is measured against the median, not the mean.** Rainfall at this site is strongly right-skewed. November's 20-year record has p33 = 81 mm, **mean = 99 mm**, p67 = 90 mm, max = 357 mm - one extreme year pulls the mean *above* the upper tercile. Against the mean, a 96 mm November reads "-2 %, below average" while the tercile method correctly calls it above-normal. Reporting both would contradict itself, so the engine classifies by tercile (the WMO-standard, distribution-based method) and reports anomaly against the median, which agrees with it in sign. This is regression-tested in `tests/climate.test.mjs`.

**2. Partially-covered months are never classified.** A forecast run started 28 October contains 4 of October's 31 days. Comparing that stub against a full-month normal produced a spurious -87 % "below-normal" October - and the advisory engine then used it to tell farmers to *delay planting*. That was a real bug found by running the system, not a hypothetical. Partial months are now `tercile: unknown`, `tercile_reason: partial_month`, `confidence: none`, and the month picker skips them.

---

## Verification: does the answer depend on which 20 years we picked?

Every tercile in this product comes from a 20-year ERA5 baseline. The obvious challenge is that a classification could be an artifact of that particular sample. `npm run verify-bands` answers it with leave-one-out cross-validation: for each of the 240 complete month-years, the p33/p67 bands are rebuilt from the **other 19 years only**, the held-out year is classified against them, and the result is compared with the classification the product actually ships.

Real output for the pilot site, run 2026-10-28:

| Check | Result | Reference |
|---|---|---|
| Leave-one-out agreement with shipped terciles | **100 %** (240/240) | a random 3-way guess scores 33.3 % |
| Heidke Skill Score | **1.000** | 0 = chance, 1 = perfect |
| Classifications that flip when their year is held out | **0 of 240** | - |
| Tercile balance (below / near / above) | 84 / 72 / 84 | ~80 / 80 / 80 expected |
| Bands built from only the first 10 years | **78.8 %** agreement with the 20-year bands | - |

Two rows matter more than the headline:

- **The 10-year row is the interesting one.** The 20-year baseline is not a stylistic choice: with 10 years, about one month-year in five would be classified differently. A ward service claiming skill off a short baseline is guessing. This is the concrete argument for using the ERA5 archive instead of recent memory.
- **`near` comes out under-filled (72 vs 84) by construction, not by bug.** `classify` treats a value sitting exactly on a cut as `near` (`value < p33` → below, `value > p67` → above), and dry months with repeated identical totals put several years exactly on a band edge. The verifier reports this instead of hiding it, and flags any month whose bands collapse entirely (`p33 === p67`) - which at a wetter site would silently push every year into `near`.

**What this does not measure.** This is **NOT a measure of ECMWF SEAS5 forecast skill**. Skill would require archived seasonal hindcasts issued before each season, which the free Open-Meteo endpoint does not serve. What is measured is the stability of the baseline bands - the denominator of the product, not the forecast. That sentence is printed by the verifier on every run and asserted by a test, so no future edit can quietly upgrade the claim.

Reproduce: `npm run verify-bands` - add `--json` for machine-readable output, or `--short-baseline 15` to test a different baseline length.

---

## The ward map, and what it refuses to show

The dashboard covers the whole country: pick any of the 47 counties and it draws that county's wards from a per-county geoBoundaries ADM3 file (CC BY 4.0, full resolution rounded to 5 decimals, heaviest county file 140 KB, so a phone on mobile data never downloads the 3 MB national layer). Every ward is coloured by its next usable month's tercile, from a single `/county-outlook` call per county.

Colouring every polygon is honest here because every ward does have a computed outlook - but the map still refuses to overstate *where* the numbers come from. ERA5 resolves climate at 0.25 degrees (~25 km), so wards are snapped to grid cells: all 1,452 wards now sit on their own cell (403 of 403 cells built 1 November 2026). The borrow-nearest machinery stays in place for any future gap and labels itself in the popup, the table note and the API (`cell.source`, `cell.distance_km`). A ward whose cell has no normals is grey and labelled "no data yet" rather than guessed. `npm run normals` is resumable, and the map upgrades itself with no code change.

---


## Architecture

```
Open-Meteo Seasonal API ──┐
(ECMWF SEAS5, 7 months)   │
                          ├─► terciles  ─► rules  ─► i18n  ─► advisory ─┬─► CLI
Open-Meteo Archive API ───┘   (pure)      (pure)    (pure)    (pure)    ├─► Worker HTTP
(ERA5 2005-2024 baseline)                                             └─► USSD / SMS
```

Every stage is a pure function over plain data. No database, no framework, no build step, no dependencies. The consequence is that the agronomy is testable in isolation and the whole service is auditable by reading a few hundred lines.

| Path | Role |
|---|---|
| `src/climate.mjs` | fetch + aggregate SEAS5 and ERA5, compute tercile baselines |
| `src/terciles.mjs` | quantiles, tercile bands, classification, month-coverage detection |
| `src/rules.mjs` | crop selection, livestock advice, early-warning levels - the agronomy |
| `src/i18n.mjs` | Swahili and English strings; nothing user-facing is hardcoded elsewhere |
| `src/advisory.mjs` | renders the decision as one-line-per-entry text, safe for SMS chunking |
| `src/ussd.mjs` | USSD session flow as a pure function |
| `src/packs.mjs` | curated site and crop data packs |
| `src/wards.mjs` | all 1452 wards: slug/id/county-name resolution, ERA5 cell lookup, agro-ecology zone, ward site objects |
| `src/verification.mjs` | leave-one-out band verification, Heidke Skill Score, short-baseline sensitivity |
| `src/skill.mjs` | pure model-skill core: rolling windows, Previous Runs scoring, CSI/MAE, artifact refusal, public scoreboard payload |
| `src/foodsecurity.mjs` | pure food-security planning core: lean-month analysis, FAO half-ET0 wet windows, staple planting plan, roof-catchment water plan, dwelling-aware lines (house vs flat), bilingual lines, dataset sources |
| `src/households.mjs` | KNBS 2019 average household size per county: default `people` for the food plan, rounded up, with the basis recorded in every payload |
| `src/helpdesk.mjs` | the verification desk: who confirms the plan (sub-county agriculture office, KEPHIS seed sticker check, KALRO selector, NDMA bulletin, county contacts page), bilingual, linked, no invented phone numbers; shipped as `verify_with` in every food payload |
| `src/surroundings.mjs` | pure surroundings analyzer: OSM API XML to elements, building and land-use rings, dwelling and roof-material suggestions labelled `osm_heuristic` with reasons, honest null when nothing is mapped |
| `worker/index.mjs` | Cloudflare Worker: `/health`, `/counties`, `/wards`, `/county-outlook`, `/locate`, `/forecast`, `/advisory`, `/kitchen`, `/skill`, `/food-security`, `/surroundings`, `/ip-location`, `POST /photo-roof`, `POST /ussd` (14 routes) |
| `web/index.html` | Extension-officer dashboard: county and ward pickers, Leaflet ward choropleth + OpenStreetMap, 7-month table, point lookup (GPS with a labelled city-level IP fallback when no fix, e.g. indoors), surroundings auto-suggest for the food form (dwelling and roof material from what OSM has mapped around the point, always confirm-by-eye), kitchen-garden advice, model accuracy scoreboard, food-security planner, SW/EN, no build step |
| `web/boundaries/*.geojson` | 47 county ward files + a simplified national county layer, geoBoundaries CC BY 4.0, attribution stamped in each file |
| `web/data/wards-index.json` | dashboard registry: counties, ward slugs and their ERA5 cells (no geometry) |
| `data/wards.json` | the climate pack: ERA5 2005-2024 normals and tercile bands per 0.25-degree cell, plus every ward's cell assignment |
| `scripts/fetch-boundaries.mjs` | Reproducible country-wide boundary fetch: ADM1/ADM2/ADM3, county split, attribution stamping, cached downloads |
| `scripts/build-normals.mjs` | Builds ERA5 normals per grid cell, resumable and cached, with nearest-cell fallback labelled by distance |
| `scripts/check-wards.mjs` | Offline integrity check: 47 counties, 1452 wards, licences, sizes, precision, pack coverage |
| `scripts/probe-local.mjs` | 107 end-to-end HTTP checks against the local server or the deployed Worker (`--base`) |
| `docs/FOOD-SECURITY-SOURCES.md` | every food-security constant and gate mapped to its Kenyan dataset, with verbatim evidence and fetch dates |
| `docs/KENYA-VERIFICATION-DESK.md` | every verification-desk entry mapped to its public, fetchable source, with fetch dates |
| `docs/knbs-2019-household-size-by-county.md` | KNBS 2019 census household-size table for all 47 counties behind the `people=` defaults, with provenance |
| `scripts/dedash.mjs` | House-style sweeper: no em dash, en dash or unicode minus anywhere (`--check` in CI) |
| `scripts/serve-local.mjs` | Zero-dependency local server for the dashboard and API on one origin |
| `scripts/verify-terciles.mjs` | Runs the verification against live ERA5 and prints the table above |
| `scripts/smoke-worker.mjs` | Exercises every HTTP and USSD route end to end |
| `data/sites.json` | curated pilot site: normals, coordinates, water balance, season calendar |
| `data/crops.json` | crop list, maturity windows, drought tolerance, sources |

### Zero-cost stack

The service is free to *run* as well as free to *use* - which is the actual sustainability argument for a ward-level climate service. An SMS-gateway product dies when the grant does.

| Need | Choice | Cost |
|---|---|---|
| Forecast + baseline | Open-Meteo Seasonal & Archive APIs | $0, no key, no signup |
| Runtime | Node 22+ built-ins only | $0, no dependencies |
| API host | Cloudflare Workers free tier | $0 |
| Static dashboard | Served from the **same** Worker via `[assets]` - one `*.workers.dev` URL, no separate project, no domain purchase | $0 |
| Feedback store | Cloudflare D1 free tier | $0 |
| Maps | Leaflet + OpenStreetMap | $0 |
| Ward boundaries | geoBoundaries ADM1/ADM2/ADM3 (CC BY 4.0), split into 47 county files and committed | $0, no key |
| Ward climate normals | ERA5 archive, batched per 0.25-degree cell, cached and resumable | $0, no key |
| Baseline verification | ERA5 archive + leave-one-out cross-validation in `src/verification.mjs` | $0, no stats package |
| CI | GitHub Actions on a public repo | $0 |
| USSD demo | AfricasTalking **sandbox simulator** | $0 - a real shortcode is the one genuinely paid item, and the demo does not use one |
| Pilot reach | WhatsApp groups + `wa.me` click-to-chat | $0, no per-message fees |

---

## Honesty and limitations

Stated plainly, because a climate service that overstates itself is worse than no service:

- **SEAS5 is not bias-corrected.** Open-Meteo's own documentation says seasonal data "are not bias-corrected and may not accurately reflect local conditions" and should be read as area forecasts. Msimu therefore expresses **terciles and confidence**, and never promises absolute millimetres. Farmer-facing screens deliberately omit mm values - this is asserted by a test, not just a convention.
- **Unknown is a valid answer.** A month with no usable tercile yields `no_data` and refers the farmer to their ward extension officer rather than guessing.
- **The EFI/SOT parameters advertised in the docs did not resolve** on the free endpoint when probed on 2026-10-28. Msimu computes terciles itself from ERA5 and does not claim native EFI.
- **20 years is a small sample.** Confidence is derived from sample size and labelled accordingly. Leave-one-out verification shows the bands are stable at 20 years and *not* stable at 10 (78.8 % agreement) - so the baseline length is load-bearing, and shrinking it would be a real regression.
- **The verification measures the baseline, not the forecast.** `npm run verify-bands` reports band stability and Heidke Skill Score against a leave-one-out baseline. It is **NOT a measure of ECMWF SEAS5 forecast skill**, and no output, doc or slide should present it as one.
- **Country-wide does not mean cell-wide.** Every one of the 1452 wards has an outlook, and the ERA5 cache is complete: 403 of 403 grid cells over Kenya, built 1 November 2026 across repeated rate-limit-aware runs (Open-Meteo meters the archive calls with HTTP 429; each run ends on the limit and `npm run normals` resumes from the cache). The final run exited with zero fetch failures, including the last frost-pass minimum-temperature fetch (cell 0.50,35.25, 2,087 m) that two earlier runs lost to the rate limit. Every ward sits on its own cell; the nearest-cell fallback, labelled with `cell.source` and `cell.distance_km`, stays in place for any future gap.
- **Resolution is the model's, not the ward's.** ERA5 is a 0.25-degree reanalysis (~25 km). Wards smaller than a cell share that cell's climate, so Msimu reports terciles for an area and never claims a field-scale forecast.
- **The agronomy is local, not generic.** Crop lists, maturity windows and the 44 % water-balance deficit come from Kajiado County sources for this specific sub-county. Elsewhere the zone classification (arid, semi-arid, sub-humid, humid, highland) and each cell's own water balance drive the same rules, but county-specific crop lists still need re-sourcing per county.
- **No pilot users yet.** The engine runs and is verified against live data; farmer-facing delivery has not been field-tested. Do not claim pilot results that have not happened.

---

## Roadmap

- [x] Tercile engine, crop and livestock rules, Swahili/English localization, CLI
- [x] Partial-month exclusion, median-based anomaly, unknown-tercile handling
- [x] Cloudflare Worker with `/forecast`, `/advisory`, `POST /ussd`
- [x] Ward dashboard: Leaflet + OpenStreetMap map, 7-month tercile table with median markers, localized advisory, SW/EN toggle - no build step, served from the same Worker origin
- [x] Ward choropleth: all 47 counties and 1452 wards from geoBoundaries (CC BY 4.0), full-resolution per-county files, every ward coloured from one `/county-outlook` call
- [x] Country-wide climate pack: ERA5 2005-2024 normals and tercile bands per 0.25-degree cell, ward-to-cell assignment, agro-ecology zones, nearest-cell provenance
- [x] Leave-one-out verification of the tercile bands (agreement, Heidke Skill Score, short-baseline sensitivity, collapsed-band detection)
- [x] Deployed to Cloudflare: <https://msimu.shikunyi.workers.dev> - Worker + dashboard assets on one origin, verified live with `npm run probe:live` (107/107)
- [x] House style enforced by code: `npm run dedash:check` fails the build if a long dash appears anywhere
- [x] Finish the ERA5 cell cache (403 of 403 cells built 1 November 2026; `npm run normals` is resumable and rate-limit aware)
- [ ] County-specific crop packs beyond Kajiado, sourced per agro-ecological zone
- [ ] Browser-verify the dashboard render and capture a screenshot (the API contract and served HTML are verified; the rendered pixels are not)
- [ ] Extension-officer feedback view (farmer replies aggregated by ward)
- [ ] USSD sandbox walkthrough recording and screenshots
- [ ] Native-speaker review of all Swahili strings
- [ ] Maa and Kikuyu localization for pastoralist and mixed-farming communities


---

## Data provenance

See [docs/DATA-PROVENANCE.md](./docs/DATA-PROVENANCE.md) for every dataset, its access date, and its caveats. See [docs/ADVISORY-RULES.md](./docs/ADVISORY-RULES.md) for the agronomy and its sources.

## Licence

MIT. See [LICENSE](./LICENSE).
