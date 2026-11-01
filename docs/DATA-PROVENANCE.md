# Data provenance

Every dataset Msimu uses, where it came from, when it was accessed, and what it cannot tell you.

All access dates are **2026-10-28** unless stated otherwise. Nothing here is assumed - each row was executed against the live source.

---

## Live APIs

### Open-Meteo Seasonal API - the forecast

| Property | Value |
|---|---|
| Base URL | `https://seasonal-api.open-meteo.com/v1/forecast` |
| Auth | None. No key, no signup, no cost |
| Models used | `ecmwf_seas5` (7-month), `ecmwf_ec46` (46-day) |
| Valid `models=` values | `ecmwf_seas5`, `ecmwf_ec46`, `ecmwf_ifs04`, `best_match` - bare `SEAS5`/`EC46` are **rejected** |
| Resolution | ~36 km, 51 ensemble members |
| Variables | `daily=precipitation_sum,temperature_2m_mean&forecast_days=210` → 210 daily points |
| Aggregation | Daily → monthly is computed locally; `monthly=precipitation_sum` is **not a valid variable** (only `monthly=temperature_2m_mean` works) |

**Wrong host to avoid:** `seasonal-forecast-api.open-meteo.com` appears in some documentation but **does not resolve in DNS**.

**Caveat (from Open-Meteo's own docs):** SEAS5 data "are not bias-corrected and may not accurately reflect local conditions" and should be read as **area forecasts** indicating wetter/drier than average. This is why Msimu expresses terciles and confidence and never promises absolute rainfall.

**Not used:** the docs advertise anomaly, EFI and SOT parameters. **These did not resolve on the free endpoint when probed.** Msimu computes terciles itself from ERA5 rather than claiming native EFI. Do not state otherwise.

### Open-Meteo Archive API - the baseline

| Property | Value |
|---|---|
| Base URL | `https://archive-api.open-meteo.com/v1/archive` |
| Auth | None |
| Reanalysis | ERA5 |
| Period used | 2005-01-01 → 2024-12-31 (20 years, 7,305 daily points at the pilot site) |
| Purpose | Per-calendar-month tercile bands (p33/p67), median and mean |

Cross-check: 2024 at the pilot site returned **728 mm rain** and **1,590 mm ET0**, consistent with the 20-year normals of 684 mm / 1,540 mm recorded independently in `..\..\docs\kenya-kajiado\FARM-PLAN-KAJIADO-NORTH.md`.

**Independent elevation confirmation:** the seasonal API returned `elevation=1800m` for the pilot coordinates without being told the site's elevation. This matches the documented value. It is the strongest single signal that the API is resolving the correct location rather than returning a generic grid point.

---

### `web/boundaries/` - ward boundaries for all 47 counties

| Property | Value |
|---|---|
| Source | geoBoundaries gbOpen KEN ADM1 (counties) + ADM2 (sub-counties) + ADM3 (wards), William & Mary GeoLab |
| Files pulled | `geoBoundaries-KEN-ADM3.geojson` (full resolution, 5.37 MB), `geoBoundaries-KEN-ADM2.geojson` (full, 10.38 MB), `geoBoundaries-KEN-ADM1_simplified.geojson` (0.82 MB). Downloads are cached under `cache/geoboundaries/` (gitignored) so re-runs are offline |
| Route used | `media.githubusercontent.com/media/wmgeolab/geoBoundaries/main/releaseData/gbOpen/KEN/...` - the repo stores these under Git LFS, so the plain `raw.githubusercontent.com` path returns an LFS pointer, not geometry. `www.geoboundaries.org` itself was unreachable from the build machine (connect timeout) |
| Licence | **Creative Commons Attribution 4.0 International (CC BY 4.0)**; attribution required. Recorded in `boundaryLicense` of the upstream metadata and embedded in every output file's `properties.license`, `properties.attribution` and `properties.source_urls` |
| Boundary year | 2020 (upstream `boundaryYear`) |
| Upstream data | Benedict Aboki Omare and George Omare, `github.com/benaboki/Kenya-County-Assembly-Boundaries` |
| Citation | Runfola D, Anderson A, Baier H, Crittenden M, Dowker E, Fuhrig S, et al. (2020) geoBoundaries: A global database of political administrative boundaries. *PLoS ONE* 15(4): e0231866 |
| Processing | Full-resolution ADM3 wards (coordinates rounded to 5 decimals, ~1.1 m, so nothing is lost against upstream) split into one file per county by ADM1 containment, with ADM2 giving each ward its sub-county. Wards whose vertex-average centroid falls outside their county (islands and crescents: Kipevu, Mkomani, Faza, Miritini) are placed using a representative interior point instead, which is why the unassigned count is 0. The national county layer uses ADM1 simplified at 4 decimals |
| Output | 47 county files holding **1452 wards** (2.56 MB total, heaviest county file 140 KB, Murang'a), `kenya-counties.geojson` (750 KB, simplified, not loaded by the dashboard), `index.json` registry, retrieved 2026-10-28 |
| Reproduce | `npm run wards` (or `node scripts/fetch-boundaries.mjs`), then `npm run check-wards` |

**Why not GADM.** GADM 4.1 `KEN_3` is smaller (2.28 MB national, same 25 Kajiado wards) and was reachable, but `gadm.org/license.html` (checked 2026-10-28) states the data are for academic and other non-commercial use and that **"Redistribution or commercial use is not allowed without prior permission."** Committing a derived file into a public MIT repository is redistribution, so GADM was rejected on licence grounds, not quality grounds. geoBoundaries' CC BY 4.0 permits exactly this use with attribution.

**Why not OCHA COD-AB.** The Kenya COD-AB set covers ADM0-ADM2 only - counties and sub-counties, no wards. A sub-county choropleth would be 5 polygons for 1.2 million people and would not match the ward-level extension service this product claims to support.

**Honesty constraint enforced by tests.** `tests/contract.test.mjs` asserts that the index covers 47 counties and exactly 1452 wards, that every county file exists and agrees with the index on ward count, that each file carries the CC BY 4.0 licence, the geoBoundaries attribution and its upstream source URLs, that every feature has a ward name, an id and geometry, that no county file exceeds 400 KB, and that the dashboard loads counties and boundaries from the API instead of hardcoding one county. `scripts/check-wards.mjs` re-checks all of it offline in CI. So a renamed ward, a dropped attribution or a silently truncated county fails the build.

---

### `data/wards.json` - ward climate normals (ERA5, 2005-2024)

| Property | Value |
|---|---|
| Source | Open-Meteo Archive API (ERA5), the same endpoint used for the pilot site baseline |
| Request | daily `precipitation_sum` and `et0_fao_evapotranspiration`, 2005-01-01 to 2024-12-31, `timezone=Africa/Nairobi`, batched with comma-separated coordinates |
| Second pass | daily `temperature_2m_min` only for cells at or above 1900 m, to derive frost risk |
| Grid | ward centroids snapped to ERA5's native **0.25 degrees** (~25 km): 1452 wards collapse to **403 unique cells**, so coverage costs a third of the requests and neighbouring wards are not given fake precision |
| Statistics stored per cell | monthly mean and median rainfall, monthly mean ET0, tercile band edges `p33`/`p67`, `sample_years` (20), annual rainfall, annual ET0, water-balance percentage, monthly minimum temperature where fetched, frost risk |
| Coverage at build time | **96 of 403 cells built (24 %)**. Open-Meteo answered the archive batches with HTTP 429 beyond that, so the build stopped rather than hammering the endpoint. 365 wards sit on their own cell; 1087 borrow the nearest built cell (worst case 308 km) and every one of them records `cell_source: "nearest"` plus `cell_distance_km`, surfaced in the API, the CLI header, the dashboard popup and the table note |
| Resumable | `npm run normals` skips cached cells, so each run extends coverage; the nearest-cell wards are replaced by their own cell automatically as the cache fills. Flags: `--max-cells`, `--batch`, `--concurrency`, `--no-fetch`, `--force` |
| Cost | $0, no API key. Per-cell derived statistics are cached under `cache/era5/` (gitignored); only the compact pack is committed (347 KB, 74 KB gzipped inside the Worker bundle) |
| Not stored | raw daily series (kept out of the repo on purpose), and no bias correction: ERA5 is used as-published, exactly like the pilot baseline |

---

## Verification method

`npm run verify-bands` (`scripts/verify-terciles.mjs` → `src/verification.mjs`) runs leave-one-out cross-validation over the ERA5 baseline:

| Step | Method |
|---|---|
| Input | ERA5 daily precipitation 2005-01-01 → 2024-12-31 at the site, aggregated to monthly totals; **only complete calendar months** are kept (240 of them) |
| Shipped classification | p33/p67 from all 20 years for that calendar month - the same code path the product uses |
| Held-out classification | p33/p67 rebuilt from the other 19 years, then the held-out year's observed total classified against them |
| Agreement | share of the 240 month-years where both classifications match; a random 3-way guess scores 33.3 % |
| Heidke Skill Score | `(Po - Pe) / (1 - Pe)` over the 3×3 contingency table of held-out vs shipped classes |
| Short-baseline sensitivity | bands from the first 10 years only, compared against the shipped 20-year classification |
| Degenerate-band detection | any calendar month where `p33 === p67` (all years identical, common in very dry months) is reported, because such a month silently classifies every year as `near` |

Result for the pilot site on 2026-10-28: **100 % agreement (240/240), HSS 1.000, 0 flips, tercile balance 84/72/84, 10-year bands agree 78.8 %, 0 collapsed months.**

**This is NOT a measure of ECMWF SEAS5 forecast skill.** Skill requires archived seasonal hindcasts issued before each season; the free Open-Meteo endpoint does not serve them. What is verified is the stability of the baseline bands the forecast is compared against. `src/verification.mjs` carries that sentence as `NOT_SKILL_CAVEAT`, prints it on every run, and `tests/verification.test.mjs` asserts it is present - the claim cannot be quietly upgraded.

---

## Static data

### `data/sites.json` - pilot site

| Field | Source |
|---|---|
| Coordinates `-1.37271746, 36.71575633` | `DEVICE-LOCATION.md` (device location at the pilot farm) |
| 20-year monthly normals (rain, Tmax, Tmin, ET0) | ERA5 via Open-Meteo Archive API, computed in `FARM-PLAN-KAJIADO-NORTH.md` |
| Annual 684 mm rain / 1,540 mm ET0 / **44 % water balance** | Same; the ratio of rainfall to potential evapotranspiration |
| Season totals and peaks (long rains 290 mm Apr, short rains 213 mm Nov) | Same |
| Elevation 1800 m | Cross-confirmed independently by the seasonal API |
| Agro-ecology "semi-arid to dry sub-humid" | `FARM-PLAN-KAJIADO-NORTH.md` |

The `normals_2005_2024` block is retained for reference and documentation. At runtime the engine **recomputes** the baseline from the Archive API rather than trusting the stored numbers, so the two can be compared.

### `data/crops.json` - crop list

| Field | Source |
|---|---|
| County crop list | Kajiado County official crop list via `kajiado.go.ke`, as recorded in `WHAT-GROWS-HERE-KAJIADO-NORTH.md` |
| Maturity windows | `FARM-PLAN-KAJIADO-NORTH.md` §2, short-cycle rainfed-tolerant list |
| Extension guidance | Night Opunga, Sub-County Agricultural Officer Kajiado North, public statement 2026-10-18 (seedfarm.co.ke) |
| Exclusions | Strawberry and raspberry are **not** on the Kajiado County list and are excluded: they require grow bags, a greenhouse and reliable water |

`drought_tolerance`, `water_need` and `rainfed_ok` per crop are **classification judgements** derived from the sources above, not measured coefficients. See `docs/ADVISORY-RULES.md` §10.

---

## Derived at runtime (never stored as fact)

| Quantity | Method |
|---|---|
| Monthly forecast totals | Sum of daily `precipitation_sum` per calendar month |
| Tercile bands | p33 / p67 of the 20-year monthly distribution for each calendar month |
| Tercile classification | Forecast total vs those bands - below / near / above |
| Anomaly % | Against the **median**, not the mean (rainfall is right-skewed here; the November mean of 99 mm sits above the p67 of 90 mm) |
| Confidence | From baseline sample size |
| Month coverage | Days present vs days in that calendar month → `partial_month` months are excluded from classification |

---

## Planned but not yet used

Listed so the repo does not overstate itself:

| Dataset | Intended use | Status |
|---|---|---|
| CHIRPS | Independent precipitation verification against station data | Not integrated |
| HDX Kenya admin boundaries | Ward polygons | **Superseded** - HDX/OCHA COD-AB stops at ADM2, so geoBoundaries ADM3 is used instead (see above) |
| SEAS5 hindcasts | True forecast-skill scoring (ROC, HSS against observations) | **Unavailable** on the free endpoint; this is why `verify-bands` reports band stability and not skill |
| MODIS / Sentinel NDVI via GEE | Rangeland condition for the pastoralist track | Not integrated |
| Second ward data pack | Prove the pack/engine separation on a real second ward | **Superseded** - every ward in Kenya now resolves through `data/wards.json`; the curated `data/sites.json` pilot remains as the verified reference site |
| Remaining ERA5 cells | Own-cell normals for the 1087 wards currently borrowing a neighbour cell | Pending - `npm run normals` is resumable; blocked only by Open-Meteo archive rate limits (HTTP 429) |

---

## Reproduce everything

```bash
node src/cli.mjs --site gataka --json            # pilot site outlook + advisory, machine-readable
node src/cli.mjs --ward turkana--kalokol         # any ward, from the country-wide pack
node scripts/smoke-worker.mjs                    # every HTTP and USSD route against live APIs
npm run verify-bands                             # leave-one-out band verification against live ERA5
npm run wards                                    # re-fetch all 47 county boundary files
npm run normals                                  # build/extend ERA5 normals per grid cell (resumable)
npm run check-wards                              # offline integrity check of boundaries + climate pack
npm run dedash:check                             # house style: no long dashes anywhere
node --test "tests/*.test.mjs"                   # 84 offline tests, no network
npm run probe                                    # 59 end-to-end HTTP checks against the local server
npm run probe:live                               # the same 59 checks against the deployed Worker
```

The validation table in the README is generated by the first command and is not hand-maintained.
