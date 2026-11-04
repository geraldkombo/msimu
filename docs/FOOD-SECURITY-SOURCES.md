# Food-security layer: Kenyan dataset backing

Every constant and gate in `src/foodsecurity.mjs` mapped to the dataset that
supports it. Fetched 2 November 2026. This file exists so no number in the
food-security plan is ever "from memory": if a constant changes, its row here
changes with it.

## Constants

| Module constant | Value | Kenyan / authoritative source | Evidence |
| --- | --- | --- | --- |
| `DRINKING_L_PER_PERSON_DAY` | 15 L | Sphere Handbook 2018, WASH Water Supply Standard 2.1 - https://spherestandards.org/handbook/ and https://interactive.spherestandards.org/ | "The Sphere minimum standard for water quantity is 15 litres per person per day. This baseline covers drinking (2.5-3L), cooking (3-6L), and personal hygiene (6-7L)." Also cited by IFRC/Sphere WASH summaries as "the figure to plan against". |
| `RUNOFF_COEFFICIENT` | 0.8 | Kenyan rainwater-harvesting design practice - https://www.fugaequipment.co.ke/blog-rainwater-harvesting-kenya.html | "Design practice for smooth iron sheet commonly uses about 0.8 to 0.9." Worked example uses 0.85. We take the CONSERVATIVE end (0.8) because the plan sizes a survival buffer, not a sales pitch. Classic reference: Kalibala, "Rainwater Harvesting" (Kenya Ministry of Water Development era), IRC Technical Paper - https://www.ircwash.org/sites/default/files/213.1-91PR-9244.pdf (server 403s bots; download manually to verify). |
| `FIRST_FLUSH_FACTOR` | 0.9 | Same Kenyan practice; first-flush diverters are standard kit in the Fuga and Muithi Engineering guides (muithiengineering.co.ke/rainwater-harvesting/) | 10% loss is the conventional allowance for the diverter that discards the dirty first litres. Labelled heuristic. |
| `CATCH_L_PER_MM_PER_M2` | 0.72 | Product of the two above | 0.8 x 0.9 = 0.72 L per mm per m2. |
| default `people` | KNBS county mean, rounded up (fallback 4) | KNBS 2019 Kenya Population and Housing Census Vol. I p. 9, per-county table saved as `docs/knbs-2019-household-size-by-county.md` (fetched 2 November 2026 via StatsKenya - https://statskenya.co.ke/at-stats-kenya/about/number-of-people-per-household-in-kenya-map-and-data/42/); national: https://www.knbs.or.ke/2019-kenya-population-and-housing-census-results/ | "Average Household Size has declined to 3.9 in 2019 from 4.2 in 2009." Per county: Nairobi 2.9, Kajiado 3.5, Mandera 6.9 (highest). `src/households.mjs` rounds the county mean UP (the safe direction for a water/storage plan) and falls back to the national mean rounded up (4) when the county is unknown; `people_basis` in every payload records which was used. Implemented 2 November 2026. |
| `WET_MONTH_MM` | 30 mm floor | FAO Agro-ecological Land Resources Assessment, Kenya, Technical Annex 1 - https://www.fao.org/4/t0732e/T0732E05.htm | "The beginning of the growing period is taken as the time when moisture supply from rainfall and soil storage is equal to half potential evapotranspiration" (citing Kowal and Kassam 1978; Doorenbos and Kassam 1979). Where a ward has ET0 normals, the module implements this rule: wet month = rain >= max(30 mm, 0.5 x ET0 normal). Points without normals keep the 30 mm floor and the payload says `basis: tercile_only`. |
| `DAYS_PER_MONTH` | 30.44 | Calendar arithmetic (365.25/12) | Not a claim about Kenya. |
| `MAIZE_WATER_BALANCE_FLOOR` | 60% | Heuristic, anchored to `data/crops.json` risk_note (Kajiado: "annual rainfall is 44 percent of crop water demand") and FAO CLIMWAT maize water requirements of roughly 500-800 mm - https://www.fao.org/land-water/databases-and-software/climwat/en/ | Labelled heuristic. The pack already marks maize `rainfed_ok: false`; the floor only changes the stated REASON (water) for cells that cannot carry it. |

## Crop maturity windows (`data/crops.json`)

Official reference: KEPHIS National Crop Variety List (updated January 2022) -
https://www.kephis.org/images/pdf-files/UPDATED_2022_JANUARY_NATIONAL_VARIETY_LIST.pdf
(sorghum p.115, finger millet p.110, pigeon pea p.150, cowpea p.153, dolichos
p.155, mung bean p.156, Rhodes grass p.157, kale p.165). The statutory mirror
is the Seeds and Plant Varieties (National Index of Plant Varieties)
Regulations, Kenya Law -
https://new.kenyalaw.org/akn/ke/act/ln/2006/161/eng@2022-12-31 (page is
JS-rendered; the search index confirms tables with "Duration to maturity
(months)" per variety).

Verified spot checks (2 November 2026):

- Finger millet: Kenya Law table shows P224 (KARI Katumani, released 1981,
  1150-1750 masl) at **3-4 months** to maturity - matches crops.json
  `millet: [90, 120]` days.
- Green gram: KALRO "New improved market-preferred green gram varieties" -
  https://keep.kalro.org/appfiles/media/vc_files/New_improved_market-preferred_green_gram_varieties.pdf
  - "**Maturity: 65-70 days**", "recommended for arid and semi-arid lands" -
  matches crops.json `greengram: [60, 70]`.
- Cowpea: KALRO Cowpea Extension Manual -
  https://kalroerepository.kalro.org/items/aa12c93d-f7be-4f2b-bf3b-5e6056474289/full
  - grown "for grain in the dry lands of Eastern, Coast and Nyanza regions",
  consistent with the pack's 60-70 day, high drought tolerance profile.
- KALRO Selector (https://selector.kalro.org/) is the live per-county variety
  recommender to cross-check any future crop-pack change.

GAP: the remaining maturity ranges (sorghum Seredo, pigeon pea ICEAP lines,
cassava, sweet potato, dolichos, Boma Rhodes, kales, tomato) are drawn from
the county extension literature already cited in `data/crops.json`
`_provenance`; a full row-by-row check against the KEPHIS PDF is pending a
manual download (the PDF blocks automated fetch).

## Lean season and bridge actions

- FEWS NET Kenya Food Security Outlook, June 2026 -
  https://fews.net/east-africa/kenya/food-security-outlook/june-2026 -
  "needs expected to peak between September and October, during the typical
  height of the lean season"; marginal agricultural areas: "Food stocks from
  the long rains production will support household food availability from June
  through late August to early September... green harvests anticipated in
  December and early dry harvests in January." This is the operational
  definition of the lean months the plan bridges.
- NDMA National Drought Early Warning Bulletin (monthly, per-county drought
  phases) - https://knowledgeweb.ndma.go.ke/ - e.g. the July 2026 bulletin.
  The authority a household or extension officer checks against this plan.
- IPC phase classifications for Kenya appear in both FEWS NET and NDMA
  products; the plan does not reproduce them (licensing + freshness), it
  points at them.

## Forecast and baseline inputs (already in the stack)

- ERA5 2005-2024 monthly normals, tercile bands (p33/p67) and ET0: precomputed
  per 0.25-degree cell in `data/wards.json` (403 cells, 1452 wards, 100% own
  cell), via Open-Meteo Archive. No key, no cost.
- ECMWF SEAS5 seasonal forecast: Open-Meteo Seasonal API, classified against
  the cell's own bands in `src/climate.mjs`.
- Kenya's official seasonal outlook comes from KMD with ICPAC (Greater Horn of
  Africa Climate Outlook Forum); Msimu complements, not replaces, it, and the
  plan caveat says so.

## What this changed in the code (2 November 2026)

1. `wetThresholdMm(site, month)`: wards now use the FAO Kenya AEZ half-ET0
   rule (rain >= 0.5 x ET0 normal, floor 30 mm); points keep the 30 mm floor.
2. `SOURCES` export + `sources` in every `/food-security` payload: the
   evidence travels with the plan, so a dashboard, a USSD screen or a printed
   handout can show where the numbers come from.
3. This dossier, referenced from the module header.
4. `dwelling=flat` mode (second pass, same day): the flat route keeps the
   Sphere 15 L/person/day demand - the allowance does not shrink because the
   household rents - but swaps the private-roof harvest for the bought-water
   storage line (`tank_bought`) and adds a boil-or-treat safety line
   (`flat_water`), consistent with the Sphere Handbook's water-supply
   standards for drinking water quality. A stated roof share
   (`dwelling=flat&roof=12`) restores the harvested-rain route. The
   container-growing line (`balcony`) is always offered to flats: most urban
   Kenyan households have no field, and the plan must not assume one.
