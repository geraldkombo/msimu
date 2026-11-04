# KNBS 2019 average household size by county (saved artifact)

Fetched 2 November 2026 from StatsKenya, "Number of People per Household in Kenya |
Map and Data" (14 July 2024) -
https://statskenya.co.ke/at-stats-kenya/about/number-of-people-per-household-in-kenya-map-and-data/42/
- which reproduces KNBS (2022), *2019 Kenya Population and Housing Census: Population
by county and subcounty*, Vol. I, p. 9. Household counts exclude the special
population (travellers, outdoor sleepers, persons in hotels/lodges and institutions).
National average: 3.9 (12,143,913 households; 47,213,282 usual residents).

This table is the source of every number in `src/households.mjs`. If a figure there
changes, this file changes with it.

| County | Households | Average household size |
| --- | --- | --- |
| Mombasa | 378,422 | 3.1 |
| Kwale | 173,176 | 5.0 |
| Kilifi | 298,472 | 4.8 |
| Tana River | 68,242 | 4.6 |
| Lamu | 37,963 | 3.7 |
| Taita Taveta | 96,429 | 3.5 |
| Garissa | 141,394 | 5.9 |
| Wajir | 127,932 | 6.1 |
| Mandera | 125,763 | 6.9 |
| Marsabit | 77,495 | 5.8 |
| Isiolo | 58,072 | 4.6 |
| Meru | 426,360 | 3.6 |
| Tharaka Nithi | 109,860 | 3.6 |
| Embu | 182,743 | 3.3 |
| Kitui | 262,942 | 4.3 |
| Machakos | 402,466 | 3.5 |
| Makueni | 244,669 | 4.0 |
| Nyandarua | 179,686 | 3.5 |
| Nyeri | 248,050 | 3.0 |
| Kirinyaga | 204,188 | 3.0 |
| Murang'a | 318,105 | 3.3 |
| Kiambu | 795,241 | 3.0 |
| Turkana | 164,519 | 5.6 |
| West Pokot | 116,182 | 5.3 |
| Samburu | 65,910 | 4.7 |
| Trans Nzoia | 223,808 | 4.4 |
| Uasin Gishu | 304,943 | 3.8 |
| Elgeyo Marakwet | 99,861 | 4.5 |
| Nandi | 199,426 | 4.4 |
| Baringo | 142,518 | 4.7 |
| Laikipia | 149,271 | 3.4 |
| Nakuru | 616,046 | 3.5 |
| Narok | 241,125 | 4.8 |
| Kajiado | 316,179 | 3.5 |
| Kericho | 206,036 | 4.4 |
| Bomet | 187,641 | 4.7 |
| Kakamega | 433,207 | 4.3 |
| Vihiga | 143,365 | 4.1 |
| Bungoma | 358,796 | 4.6 |
| Busia | 198,152 | 4.5 |
| Siaya | 250,698 | 3.9 |
| Kisumu | 300,745 | 3.8 |
| Homa Bay | 262,036 | 4.3 |
| Migori | 240,168 | 4.6 |
| Kisii | 308,054 | 4.1 |
| Nyamira | 150,669 | 4.0 |
| Nairobi | 1,506,888 | 2.9 |
| **Total** | **12,143,913** | **3.9** |

## How the module uses this

- Default household size for the food-security plan = the county mean ROUNDED UP
  (`Math.ceil`), because overstating a household is the safe direction for a water
  or storage plan (Nairobi 2.9 plans for 3; Kajiado 3.5 plans for 4; Mandera 6.9
  plans for 7).
- Unknown county (or a bare point that cannot be located) falls back to the
  national 3.9, rounded up to 4 - the previous flat default.
- An explicit `people=` parameter always wins; the payload records which basis was
  used in `people_basis` (`requested`, `knbs_2019_county`, `knbs_2019_national`).
- County-name spellings in `data/wards.json` differ slightly from KNBS ("Tharaka"
  for Tharaka Nithi, "Murang'a", "Elgeyo-Marakwet"); `normalizeCounty` plus the
  alias table bridges them.
