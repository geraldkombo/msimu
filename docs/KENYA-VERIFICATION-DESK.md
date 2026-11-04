# Kenya verification desk: who confirms the plan, and how you know they are real

Saved artifact, fetched 2 November 2026. The food-security plan ends with "confirm
with your ward extension officer". That sentence is useless unless the product says
who that is, where they sit, and how a household checks a seller is legitimate. Every
entry below is a public, fetchable source; nothing here is a phone number invented
for convenience.

## 1. The extension officer is a physical office, not a rumour

- The Ministry of Agriculture and Livestock Development (MoALD) structure runs
  national > county > sub-county > ward; the organogram is published at
  https://kilimo.go.ke/organogram/ (Kilimo House, Cathedral Road, Nairobi,
  P.O. Box 30028-00100).
- Agriculture is a devolved function: the officer a household actually meets sits in
  the sub-county or ward agricultural office under the county Department of
  Agriculture. Guidance confirming this route: Huku Kenya, "Agricultural Extension
  Services" - https://hukukenya.co.ke/agricultural-extension-services/ - "You can
  find your local agricultural extension officer by visiting the nearest
  Sub-County or Ward Agricultural Office."
- Some counties publish their officers' names and phone numbers on the county's own
  site, which is the only place a phone number should be trusted from. Example
  fetched 2 November 2026: County Government of Nyeri, Directorate of Agriculture -
  https://www.nyeri.go.ke/directorate-of-agriculture/ - lists Sub-County Agricultural
  Officers (DAOS) with names, phone numbers and emails per sub-county.
- Rule the dashboard states: use only contacts published on the county's own website
  or met at the sub-county office in person.

## 2. Seed reliability is a certification scheme, not a vibe

- KEPHIS (Kenya Plant Health Inspectorate Service) is the state corporation that
  certifies seed: https://www.kephis.go.ke/seed-certification-services - established
  October 1996, implementing the Seeds and Plant Varieties Act Cap 326.
- Certified seed carries a KEPHIS certification sticker label on the packet:
  https://kephis.org/images/new/kephisstickerseedlabel.pdf - "Seed certification is
  important as it is the process through which the government gives quality
  assurance on the seeds availed to the farming community." No sticker label, no
  certified seed: that is the reliability test a farmer can apply in the shop.
- Only licensed seed companies and dealers may sell certified seed; KEPIS/KEPHIS
  publishes the licensed lists (kephis.go.ke; eCitizen portal
  https://kephis.ecitizen.go.ke/). Secondary reporting (businessradar.co.ke,
  2026) puts the licensed list at 212 companies and mentions an SMS seed check;
  the SMS shortcode is NOT reproduced in this product until confirmed on a KEPHIS
  primary page - the sticker label and the licensed-dealer list are the checks we
  ship.

## 3. Varieties and breeds: KALRO

- KALRO breeds and tests the varieties Kenya releases; the live per-county variety
  recommender is https://selector.kalro.org/ (already cited in
  FOOD-SECURITY-SOURCES.md for maturity windows).

## 4. Drought phase: NDMA

- The monthly National Drought Early Warning Bulletin gives each county's drought
  phase: https://knowledgeweb.ndma.go.ke/ - the authority to compare this plan's
  lean months against.

## 5. Water storage honesty

- There is no national certification scheme for domestic water tanks in this
  dossier; the plan therefore gives a SIZE (Sphere-based demand) and storage
  hygiene lines (covered container, boil or treat bought water) rather than naming
  sellers. Tank buyers should ask for food-grade lining and a covered, screened
  inlet - stated as guidance, labelled heuristic.

## What shipped from this (2 November 2026)

- `src/helpdesk.mjs`: bilingual `VERIFY_WITH` entries (sub-county agriculture
  office, KEPHIS sticker-label check, KALRO selector, NDMA bulletin, county
  directorate pages) shipped inside every `/food-security` payload as
  `verify_with`, rendered on the dashboard under "Who to confirm this with".
- The closing caveat keeps its extension-officer sentence, now backed by a named,
  reachable desk instead of an abstraction.
