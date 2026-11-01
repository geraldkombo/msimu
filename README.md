# Msimu

**Forecast in, farming decision out.**

Msimu turns a raw seasonal climate forecast into a specific instruction a smallholder in any of Kenya's 1452 wards can act on today - what to plant, how long it takes to mature, what *not* to plant, and what to do about livestock water - delivered in Swahili on the basic phone already in the farmer's pocket.

Most climate products in the region are dashboards. They show rainfall to a user who then has to do the agronomy themselves. Msimu does the agronomy and delivers the decision.

<!-- Replace OWNER with your GitHub username, then delete this comment. -->
[![CI](https://github.com/OWNER/msimu/actions/workflows/ci.yml/badge.svg)](https://github.com/OWNER/msimu/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Dependencies: zero](https://img.shields.io/badge/dependencies-zero-brightgreen)](./package.json)

**Live:** <https://msimu.shikunyi.workers.dev> - dashboard, JSON API and USSD endpoint on one Cloudflare Worker. Country-wide build (version `8cbfc681`, deployed 2026-10-29) verified with `npm run probe:live` (59/59 checks).

---

## Run it in two commands

No `npm install`. There is nothing to install - the engine uses only Node built-ins.

```bash
node --test "tests/*.test.mjs"                 # 84 tests, all offline, no network
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
npm run probe                                               # 59 end-to-end HTTP checks: dashboard + API + USSD
npm run probe:live                                          # the same 59 checks against the deployed Worker
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

Colouring every polygon is honest here because every ward does have a computed outlook - but the map still refuses to overstate *where* the numbers come from. ERA5 resolves climate at 0.25 degrees (~25 km), so wards are snapped to grid cells: 365 wards sit on their own cell, 1087 currently borrow the nearest built cell and say so in the popup, the table note and the API (`cell.source`, `cell.distance_km`). A ward whose cell has no normals is grey and labelled "no data yet" rather than guessed. Filling the remaining cells is `npm run normals`, which is resumable, and the map upgrades itself with no code change.

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
| `worker/index.mjs` | Cloudflare Worker: `/health`, `/counties`, `/wards`, `/county-outlook`, `/forecast`, `/advisory`, `POST /ussd` |
| `web/index.html` | Extension-officer dashboard: county and ward pickers, Leaflet ward choropleth + OpenStreetMap, 7-month table, SW/EN, no build step |
| `web/boundaries/*.geojson` | 47 county ward files + a simplified national county layer, geoBoundaries CC BY 4.0, attribution stamped in each file |
| `web/data/wards-index.json` | dashboard registry: counties, ward slugs and their ERA5 cells (no geometry) |
| `data/wards.json` | the climate pack: ERA5 2005-2024 normals and tercile bands per 0.25-degree cell, plus every ward's cell assignment |
| `scripts/fetch-boundaries.mjs` | Reproducible country-wide boundary fetch: ADM1/ADM2/ADM3, county split, attribution stamping, cached downloads |
| `scripts/build-normals.mjs` | Builds ERA5 normals per grid cell, resumable and cached, with nearest-cell fallback labelled by distance |
| `scripts/check-wards.mjs` | Offline integrity check: 47 counties, 1452 wards, licences, sizes, precision, pack coverage |
| `scripts/probe-local.mjs` | 59 end-to-end HTTP checks against the local server or the deployed Worker (`--base`) |
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
- **Country-wide does not mean cell-wide.** Every one of the 1452 wards has an outlook, but only 96 of the 403 ERA5 grid cells over Kenya are built so far (Open-Meteo rate-limited the archive calls with HTTP 429). 365 wards sit on their own cell; 1087 borrow the nearest built cell, up to 308 km away in the worst case, and every response labels that (`cell.source`, `cell.distance_km`). `npm run normals` resumes where it stopped; nothing about the engine changes when the cache fills.
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
- [x] Deployed to Cloudflare: <https://msimu.shikunyi.workers.dev> - Worker + dashboard assets on one origin, verified live with `npm run probe:live` (59/59)
- [x] House style enforced by code: `npm run dedash:check` fails the build if a long dash appears anywhere
- [ ] Finish the ERA5 cell cache (96 of 403 cells built; `npm run normals` is resumable and rate-limit aware)
- [ ] County-specific crop packs beyond Kajiado, sourced per agro-ecological zone
- [ ] Browser-verify the dashboard render and capture a screenshot (the API contract and served HTML are verified; the rendered pixels are not)
- [ ] Extension-officer feedback view (farmer reply  D1  aggregated by ward)
- [ ] USSD sandbox walkthrough recording and screenshots
- [ ] Native-speaker review of all Swahili strings
- [ ] Maa and Kikuyu localization for pastoralist and mixed-farming communities


---

## Data provenance

See [docs/DATA-PROVENANCE.md](./docs/DATA-PROVENANCE.md) for every dataset, its access date, and its caveats. See [docs/ADVISORY-RULES.md](./docs/ADVISORY-RULES.md) for the agronomy and its sources.

## Licence

MIT. See [LICENSE](./LICENSE).
