# Advisory rules - the agronomy, and where each rule comes from

Every rule below is implemented in [`src/rules.mjs`](../src/rules.mjs) as a pure function and covered by tests in [`tests/advisory.test.mjs`](../tests/advisory.test.mjs).

**Status: heuristic decision rules, not a crop model.** They encode documented local agronomy and a measured water balance. They have not been validated against yield trials. Where a rule is a judgement call rather than a sourced fact, it is marked as such below.

---

## 1. Season calendar

Kajiado North has a bimodal rainfall regime. Month → season:

| Months | Season | Planting window |
|---|---|---|
| Mar, Apr, May | `long_rains` | yes - 290 mm total, peak April |
| Oct, Nov, Dec | `short_rains` | yes - 213 mm total, peak November |
| Jun-Sep | `dry_jun_sep` | no - 103 mm |
| Jan, Feb | `dry_jan_feb` | no - 78 mm |

Source: `data/sites.json` `seasons` block, derived from ERA5 2005-2024 normals in `..\..\docs\kenya-kajiado\FARM-PLAN-KAJIADO-NORTH.md`.

Outside a planting window, cropping advice is suppressed entirely and only fodder establishment is considered. The advisory says so explicitly rather than returning an empty list.

## 2. Crop selection

Each crop in `data/crops.json` carries `maturity_days`, `water_need`, `drought_tolerance`, `rainfed_ok`, `county_listed` and `fodder_value`.

Drought tolerance is ranked `low: 0, medium: 1, high: 2, very_high: 3`. The tercile sets the minimum acceptable rank:

| Season tercile | Minimum drought tolerance | Rationale |
|---|---|---|
| `below` | `high` (2) | A dry season punishes anything less |
| `near` | `medium` (1) | Normal risk, normal choices |
| `above` | any (0) | Wet seasons widen the option set |
| `unknown` | `high` (2), and see §6 | Fail safe, never fail optimistic |

Decision order per crop, within a planting window:

1. **Needs water and no irrigation** (`irrigation_required === true` or `water_need === 'high'`) → avoided with reason `needs_irrigation`.
2. **Drought tolerance below the tercile minimum** → avoided with reason `drought_risk`, *unless* the tercile is `above`.
3. Otherwise → recommended.

With `--irrigation`, rule 1 is waived: irrigation access genuinely changes what is growable, and tomato and kales become candidates.

Recommended crops are then sorted **shortest maturity first**, tie-broken by higher drought tolerance. This is deliberate: when the rain is uncertain, the crop that reaches harvest soonest is the one most likely to actually be harvested.

## 3. The water-balance override

At the pilot site, annual rainfall is 684 mm against potential evapotranspiration of 1,540 mm - **44 % of crop water demand** (ERA5 2005-2024, `..\..\docs\kenya-kajiado\FARM-PLAN-KAJIADO-NORTH.md`).

When `water_balance_pct < 60` and the farmer has no irrigation:

- **Rainfed maize is actively avoided** with reason `water_balance`, even if it survived the tercile filter.
- A standing warning is emitted: *"Annual rainfall here is 44 % of crop water demand. Rainfed maize is a gamble, not a plan."*

This rule fires in every season, including above-normal ones. Maize is the crop farmers most want to plant and the one most likely to fail here; a seasonal outlook that says "wetter than normal" is not enough to make it safe.

## 4. Tercile-conditional warnings

| Tercile | Warning | Content |
|---|---|---|
| `above` | `excess_rain` | Waterlogging, fungal disease, pest pressure; plant on ridges, scout weekly |
| `below` | `deficit` | Prefer shortest-maturity drought-tolerant crop; consider not planting if the window is closing |
| any, when water balance < 60 % | `water_balance` | See §3 |

Note the asymmetry: above-normal rain in a semi-arid ward is a *risk*, not only good news. The advisory says so.

## 5. Livestock advice

Kajiado North is agro-pastoral; a cropping-only service would miss half the livelihood. Advice keys:

| Trigger | Advice |
|---|---|
| Any dry season, **or** tercile `below` | Fill water pans and secure borehole access now; buy or cut hay while it is available; destock weak animals early rather than late |
| Tercile `above` | Move livestock off low ground and black cotton soil before it becomes impassable; tick and worm pressure rises - dip or spray on schedule |
| Any planting season | Establish or top up Boma Rhodes so there is hay to cut in the next dry season |

The "act while inputs are still available" framing is intentional: the value of a seasonal forecast is that it arrives *before* the decision becomes urgent.

## 6. Unknown is a valid answer

When the tercile is `unknown` - a partially-covered month, or no usable baseline - `earlyWarning` returns level `no_data` and the text tells the farmer:

> *"Hakuna taarifa ya kutegemewa kwa kipindi hiki. Usipange kwa kutegemea huduma hii pekee; uliza afisa kilimo wa kata."*
> (No usable outlook for this period. Do not plan on this service alone; ask your ward extension officer.)

The system never fills a gap with a guess, and never presents itself as the only source. This is tested, including at the USSD layer.

## 7. Early-warning levels

| Condition | Level | Swahili label |
|---|---|---|
| tercile `unknown` | `no_data` | hakuna taarifa |
| `below` during a planting season | `watch` | uangalizi |
| `below` entering a dry season | `alert` | tahadhari |
| `above` | `watch` | uangalizi |
| otherwise | `normal` | kawaida |

Levels are rendered through `i18n.levels`. Raw codes never reach the user - asserted by test.

`below` entering a dry season escalates to `alert` because that is the compound hazard: no rain now, and no recovery afterwards.

## 8. Localization

All user-facing text lives in [`src/i18n.mjs`](../src/i18n.mjs). Swahili is the primary locale; English is complete. No string is hardcoded in the rule or rendering layers.

Two rules govern the text:

- **Sentences are complete and capitalized.** Season and confidence labels are capitalized at render time via `cap()`, so template fragments stay reusable without producing lowercase mid-sentence output.
- **One line per entry.** `advisory.lines` contains no embedded newlines, so any downstream channel can chunk safely for SMS segment limits. Tested.

Swahili strings still require review by a native speaker before submission - this is an open item, not a completed one.

## 9. What is deliberately excluded

- **Strawberry and raspberry** are not on the Kajiado County crop list and are excluded from `crops.json`. They require grow bags, a greenhouse and reliable water.
- **Absolute rainfall promises.** Farmer-facing USSD screens show terciles only, never millimetres. Asserted by test. The mm figures exist in the API and CLI output for analysts and extension officers, who can interpret them.

## 10. Known limitations

- Rules are **heuristics over documented local agronomy**, not calibrated against local yield trials.
- Drought-tolerance ranks and `water_need` classes are **judgement calls** based on the cited sources, not measured coefficients.
- The tercile minimums (`below`→high, `near`→medium, `above`→any) are a **defensible default, not a fitted parameter**.
- No soil-type, slope or seed-availability layer yet; two farms in the same ward get the same advice.
- Every ward in Kenya resolves to a climate cell, but only Kajiado's crop list is county-sourced. Elsewhere the crop list is the same national list filtered by the ward's own water balance, tercile and drought tolerance - defensible, but not yet re-sourced per county.

## 11. Country-wide resolution: wards, cells and zones

How a ward becomes an advisory, and what each step is allowed to claim:

1. **Ward to cell.** Ward centroids are snapped to ERA5's native 0.25-degree grid (~25 km), so 1452 wards collapse to 403 cells. Wards inside one cell share one climate: that is the model's resolution, not a shortcut, and the API says which cell a ward used.
2. **Own cell or nearest cell.** Where a ward's own cell has not been built yet it borrows the nearest built cell and is labelled `cell_source: "nearest"` with `cell_distance_km`. The dashboard popup, the table note and the CLI header all repeat that disclosure, because an unlabelled interpolation is how a climate service starts lying.
3. **Agro-ecological zone.** Derived in `src/wards.mjs` from the cell's own numbers, in this order: `highland` if frost risk or elevation at or above 2400 m; otherwise `humid` at 1200 mm/yr and above; `sub_humid` at 900 mm and above; `semi_arid` at 600 mm and above; `arid` below that. The thresholds are coarse on purpose: they exist to tell a farmer in Kabete from a farmer in Lodwar, not to replace a soil survey.
4. **Crop rules are unchanged.** Zone does not override the agronomy in sections 2 to 4. The same tercile-conditional drought-tolerance gate, the same water-balance override and the same planting-window logic run for Turkana as for Kajiado, using each ward's own annual water balance. Zone is reported for context and for future county-specific crop packs.
5. **One forecast request per county.** `/county-outlook` sends every distinct cell in a county in a single multi-coordinate seasonal call, then classifies each cell against its own precomputed tercile bands. A ward advisory costs one seasonal call and no archive call, because the 2005-2024 baseline ships in the pack.
6. **Unknown still wins.** A partial month, a missing band or an unbuilt cell yields `unknown` with `confidence: none` and a referral to the ward extension officer. Coverage is never implied by colour alone.
