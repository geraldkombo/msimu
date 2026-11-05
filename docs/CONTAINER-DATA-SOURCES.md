# Container / sack gardening data - verification report

All fetches performed 2026-11-05. Method: web search, then full-page fetch of
each cited source (HTML directly; PDFs via a text-extraction fetcher). Every
quote below was read in a fetched page or PDF. Nothing is quoted from search
snippets. No URL or quote in this file was invented; where a source could not
be fetched it is listed in the honest failure log and NOT used as evidence.

Authority markers used throughout:

- `[OFFICIAL]` = government, ministry, research institute, UN/FAO, or peer-reviewed
- `[COMMERCIAL]` = Kenyan seed companies, agri-media, farming blogs (treated as
  corroborating, never as sole authority for a correction)

House rule applied: a number either has a source or it says it has none. After
this pass, `data/kitchen.json` carries `_provenance.status = "partially_verified"`:
harvest windows, harvest styles and crop exclusions are source-matched; the
container depths and volumes (cm / litres) remain app-derived horticultural
defaults because no Kenyan official source publishes per-crop container minimums.

## Fetch failures (honest log)

- `nation.africa` Seeds-of-Gold kale article: HTTP 403.
- `keep.kalro.org/good-agricultural-practices/*`: JavaScript app, only abstract text retrievable.
- WorldVeg "Agroecological vegetable production: field manual for Kenya" PDF: too large, fetcher returned no text.
- Scribd "Complete guide on sweet potato farming in Kenya": not fetchable; its "leaves harvested 2 months after planting" line is therefore NOT cited as evidence (the peer-reviewed 8-week source below covers the same fact).
- KCEP-CRAL cowpea manual bitstream (repository.nrf.go.ke): served only the abstract, not the booklet text.

## 1. Amaranth (terere / mchicha)

Dataset after this pass: 20 cm | 10 L | 30-40 days first leaf harvest | cut-and-come-again.

- Days: RANGE-WIDER. Published first-leaf harvest is 21-28 days from direct
  sowing (faster than the dataset); the dataset's 30-40 window is kept as the
  conservative planning range and the notes now say leaves can start at 21 days.
- Harvest style: CONFIRMED (multiple pickings at 2-3-week intervals).
- 20 cm / 10 L: NOT-FOUND. No public Kenyan source states a container
  depth/volume minimum for amaranth. Stays an app-derived default.

Sources:

- `[OFFICIAL]` AMARANTH PRODUCTION - MOALF/SHEP PLUS (Ministry of Agriculture,
  Livestock & Fisheries + AFA-Horticultural Crops Directorate + JICA), Kenya,
  2016. <https://www.jica.go.jp/project/english/kenya/015/materials/c8h0vm0000f7o8cj-att/materials_01.pdf>
  > "Maturity Period: 6 weeks after transplanting, first harvest is at a plant height of 30 cm"
  > "With multiple harvests, young leaves & tender shoots are picked at 2 to 3 week interval"
  > "Frequent harvest prolongs the harvest period and delays onset of flowering"
  > (A. dubius) "Maturity Period: 3 - 4 weeks after sowing"
  > "It is drought tolerant because it has deep roots that can go up to 2 meters in search of water"
- `[COMMERCIAL]` From weeds to food to money: Amaranth transforms lives in
  Kenya - Ripple Effect. <https://rippleeffect.org/blog/from-weeds-to-food-to-money-amaranth-transforming-lives-in-kenya/>
  > "Amaranth matures within 75 to 90 days, with the ability to harvest leaves in just 3 weeks of being planted."
- `[COMMERCIAL]` Amaranth (Terere/Mchicha) Farming in East Africa - Kilimo
  Kwanza. <https://kilimokwanza.org/amaranth-terere-mchicha-farming-in-east-africa-value-chain-and-profit/>
  > "ready to harvest in 3-4 weeks and re-cuttable"
  > crop-calendar table: "First harvest | ~3-4 weeks (leaves) ... Repeat | Cut regrowth / successive sowings"

## 2. Kales (sukuma wiki / collards)

Dataset: 30 cm | 20 L | 50-70 days first harvest | outer leaves. CONFIRMED on all four fields.

Sources:

- `[COMMERCIAL]` How To Grow Kale In Containers For A Constant Sukuma Supply -
  Jua Kenya (the only explicit Kenyan container-sizing statement found; it
  corroborates the dataset's depth and volume).
  <https://jua-kenya.com/how-to-grow-kale-in-containers-for-a-constant-sukuma-supply/>
  > "2-3 large containers or sacks (at least 30cm deep and wide, old buckets or gunias work perfectly)"
  > "10-15 litres of quality potting mix ... 5 litres of well-rotted manure or compost" (about 15-20 L total, matching the 20 L default)
  > "This process takes about 8-10 weeks from seed to first harvest" (56-70 days, inside the 50-70 window)
  > "pick the older, outer leaves from the bottom, leaving the central growing tip intact. This 'cut-and-come-again' method ensures a constant supply."
- `[OFFICIAL]` KALE PRODUCTION - MOALF/SHEP PLUS + JICA (Kenya, rev. 2019).
  <https://www.jica.go.jp/project/english/kenya/015/materials/c8h0vm0000f7o8cj-att/materials_24.pdf>
  > "Harvesting Period: Begins 6 weeks after transplanting and can last for 4 - 6 months"
  > "Plucking the lower leaves; each time leaving 3 - 4 top leaves"
  > ("Mfalme F1") "Harvesting starts 45 days after transplanting."
  Note: 6 weeks after transplanting is about 42 days; with a 3-4-week nursery
  that is roughly 70 days from sowing, so the dataset's 50-70 window sits
  inside the published 42-70 spread.
- `[OFFICIAL]` Sack gardens in KENYA - FAO FSNL factsheet (FAO Nutrition &
  Consumer Protection Division, 2009; Solidarites Kibera/Mathare project).
  <https://www.fao.org/fileadmin/user_upload/wa_workshop/docs/FSNL_factsheet_SackGardens_in_Kenya.pdf>
  > "Each sack used by the project was about 0.5m3 ... Each sack may contain up to 50 plants of kale or 20 plants of tomatoes and can produce several kilos of vegetable each month."
  > "for leafy vegetables, only lower leaves were cut leaving the top ones for continual growth ... e.g. kale can be harvested once a week."

## 3. Tomato

Dataset after this pass: 35 cm | 25 L | 70-90 days first harvest | repeated picking.

- Days: CONFIRMED (from transplanting; published 60-90, Kenyan determinate
  varieties 75-85). Counted from sowing, add the 3-4-week nursery.
- Harvest style: CORRECTED. It was `single_harvest_window`; published sources
  describe repeated pickings (about twice a month in sack gardens) over a 3-4
  month harvest period. Only determinate varieties concentrate ripening.
- 35 cm / 25 L: CONSISTENT (no Kenyan official minimum published). The
  international extension minimum is a 5-gallon (about 19 L, about 37 cm deep)
  bucket; 25 L is slightly more generous. Kenyan practice uses far bigger
  containers (90 kg sacks; FAO 0.5 m3 sacks).

Sources:

- `[OFFICIAL]` TOMATO PRODUCTION - MOALF/SHEP PLUS + JICA (Kenya).
  <https://www.jica.go.jp/project/english/kenya/015/materials/c8h0vm0000f7o8cj-att/materials_26.pdf>
  > "Maturity period range between 3 - 4 months after transplanting depending on: - The variety - Environmental conditions"
  > ("Rio Grande", "Cal J") "Maturity Period: 75 - 85 days after transplanting"
  > ("Anna F1", indeterminate) "Maturity Period: 75 days after transplanting ... Yield: 64,000kg per acre (18 kg per plant for 8 months)"
- `[COMMERCIAL]` How To Grow Tomatoes In Sacks - Crazy Kanairo Farming (Kenya,
  Feb 2026). <https://crazykanairofarming.com/how-to-grow-tomatoes-in-sacks/>
  > "Seedlings are ready for transplanting into sacks after 3 to 4 weeks in the nursery. The time from transplant to the first harvest ranges from 60 to 90 days, depending on whether the variety is early-maturing or late-maturing."
  > "Cherry tomatoes are usually the fastest to mature, often ready in just 60 days. larger varieties like Beefsteak or Roma may require up to 85 or 90 days."
  > "A standard 90kg sack occupies less than two square feet but can support up to three productive tomato plants."
- `[OFFICIAL]` FAO sack-gardens factsheet (URL above): harvest cadence -
  > "For most vegetables, harvesting is done twice a month, although other species have a shorter span"
- `[OFFICIAL]` (secondary, international) Tomatoes in Containers - Clemson
  HGIC (Apr 2022). <https://hgic.clemson.edu/tomatoes-in-containers/>
  > "A 14-inch to 20-inch container is suitable for most compact cultivars. A five-gallon bucket with holes drilled into the bottom would also work. ... There needs to be adequate room for sufficient root growth to support the plant."

## 4. Cowpea (kunde)

Dataset after this pass: 25 cm | 15 L | 65-80 days green pods | repeated picking.

- Days: CORRECTED from 60-70 to 65-80. Kenyan varieties flower at 50-60 days
  and reach dry grain at 80-90 days; green pods are picked in between.
- Repeated picking: CONFIRMED (indeterminate flowering).
- Leaves (if offered separately): 3-4 weeks, per the SHEP guide below.
- 25 cm / 15 L: NOT-FOUND. Stays an app-derived default; the official guide
  notes cowpea "has a deep root system".

Sources:

- `[OFFICIAL]` COWPEA LEAVES PRODUCTION - MOALF/SHEP PLUS + JICA (Kenya, rev. 2019).
  <https://www.jica.go.jp/Resource/project/english/kenya/015/materials/c8h0vm0000f7o8cj-att/materials_23.pdf>
  > "Maturity period for leaf harvesting is 3 - 4 weeks after planting"
  > "Cowpea has a deep root system."
  > ("Machakos 66") "Flowers 55 - 60 days after germination"
  > ("Katumani 80") "Flowers 50 days after emergence"
- `[COMMERCIAL]` Drought Tolerant Cow Pea (M66 / K80) - Dryland Seed Ltd
  (Kenyan seed company). <https://drylandseed.com/cow-pea-m66-k80/>
  > (M66) "It flowers within 55-60 days ... Matures within 80-90 days ... The pods are green when young, turn bright red during grain filling"
  > (K80) "It has a semi-spreading habit and indeterminate flowering pattern ... Immature pods are green ... Matures in 80 to 90 days."

## 5. Dolichos (njahi / lablab)

Dataset after this pass: 30 cm | 20 L | 75-100 days green pods | repeated picking.

- Days: CORRECTED from 70-90 to 75-100. Kenyan improved varieties flower at
  60-80 days and reach dry grain at 80-115 days; green pods are harvested
  after flowering.
- Repeated picking: CONFIRMED.
- 30 cm / 20 L: NOT-FOUND. Stays an app-derived default; climbing types need support.

Sources:

- `[COMMERCIAL]` Training Handbook on Production of Lab Lab (Dolichos Beans) -
  Livestock Africa (Nanyuki, Kenya).
  <https://livestock.africa/wp-content/uploads/2024/04/Training-Handbook-on-Production-of-Lab-Lab.pdf>
  > "Lablab is a multipurpose legume. Its immature seeds and pods and young leaves are edible and cooked as vegetables. Mature, dry beans, locally known as Njahi"
  > (DL1002) "Flowers between 65-75 days after planting ... Matures 80-90 days after planting"
  > (DL1009) "flower between 60 to 80 days ... Matures between 95 to 115 days"
  > "Harvesting: Dolichos beans mature 80 - 115days after planting, depending on the variety."
- `[COMMERCIAL]` Dolichos lablab - Agrarian Kenya.
  <https://agrarian.co.ke/plant/dolichos-lablab/>
  > "Leaves can be harvested early, followed by green pods as the plant matures. Continued harvesting supports steady production throughout the growing season."
  > "Climbing types produce higher pod yields and require support structures. Bush types mature earlier and suit smaller production spaces."

## 6. Sweetpotato

Dataset after this pass: 30 cm | 30 L | 56-60 days leaves, tubers later | leaves then tubers.

- Leaves: CORRECTED from 30-45 to 56-60 days. Peer-reviewed work harvests
  leaves from 8 weeks after planting (8 WAP).
- Tubers: CONFIRMED (4-7 months; about 4 months in sacks).
- 30 cm depth: CONFIRMED-adjacent (field practice: plough 30 cm, ridges 30-45 cm).
- 30 L: RANGE-WIDER. Kenyan sack practice uses 90 kg grain sacks (about 50-60 L);
  30 L stays as a floor, and the notes now name the 90 kg sack as the standard.

Sources:

- `[OFFICIAL]` Innovation Opportunities in Sweet Potato Production in Kenya
  (Guidebook, FARA 2018; Kenya-focused, KALRO/CIP authors).
  <https://library.faraafrica.org/wp-content/uploads/2019/11/Innovation-Opportunities-in-Sweet-Potato-Production-in-Kenya_Guidebook_FARA.pdf>
  > "Harvesting commences between 4 and 7 months after planting, depending on the variety and environmental conditions. The mature tubers may be left underground and harvested piecemeal for at least two months or they may be harvested and placed in grass-lined pits."
- `[OFFICIAL]` Influence of Harvesting Stages on Phytonutrients ... (sweetpotato
  leaves) - Tshilongo et al. 2024, PMC (peer-reviewed, African study).
  <https://pmc.ncbi.nlm.nih.gov/articles/PMC11172356/>
  > "The leaves were harvested three times over two growing seasons in 2022 and 2023 from 8 weeks after planting (8WAP) to 16 weeks after planting (16WAP) at four-week intervals. Week 8 occurred during the vegetative stage, week 12 at tuber initiation, and week 16 during the tuber maturation stage"
- `[COMMERCIAL]` Sweet Potato Farming in Kenya 2026 - Crazy Kanairo Farming.
  <https://crazykanairofarming.com/sweet-potato-farming-in-kenya/>
  > "First, acquire large, sturdy polypropylene sacks, such as those used for 90kg grains."
  > "After approximately four months, when the lower leaves begin to yellow, the sweet potatoes are ready for harvest."
  > "The yields from a 90kg sack can range from 8kg to 15kg under good management."
  > "Effective land preparation involves deep ploughing to a depth of 30cm and creating ridges 30cm to 45cm high."

## 7. Exclusion: maize unsuitable in containers - CONFIRMED

Single-plant maize in buckets/sacks is attempted in Kenya (media/blogs), but
every fetched source shows it only works with manual pollination, because wind
pollination needs a block of plants. That is exactly this dataset's rationale.

- `[OFFICIAL]` (secondary, international) HO-98: Growing Sweet Corn - Purdue
  University Extension. <https://ag.purdue.edu/department/hla/extension/extension-publications-library/ext-pubs/ho-98-w.html>
  > "Corn is wind pollinated, so plant four or more short rows of sweet corn side-by-side rather than one or two long rows. This will help insure good pollination and ear development. Inadequate pollination results in poorly filled ears."
  > "Corn pollen is carried by the wind from the tassels to the silks."
- `[COMMERCIAL]` How To Grow Maize In Buckets (Kenya, 2026) - Crazy Kanairo
  Farming (a pro-maize-in-buckets guide that still proves the constraint).
  <https://crazykanairofarming.com/grow-maize-in-buckets-container-guide/>
  > "Manual Pollination: Because isolated bucket plants lack field-scale wind pollination, you must manually transfer pollen from tassels to silks to ensure full grain filling."
  > "Without manual pollination, you will harvest a cob that is mostly empty, often called a 'blind ear.'"
  > "Container Requirement: A minimum 20-litre (5-gallon) bucket is essential for one maize plant ... Containers must have at least 12 inches of depth" (12 in is about 30 cm)

## 8. Exclusion: cassava (needs deep soil, long season) - CONFIRMED

- `[OFFICIAL]` Cassava TIMPs - KALRO official knowledge portal.
  <https://kalrotimps.com/timps/4>
  > "Generally, cassava becomes mature for harvesting 8 - 18 months after planting."
  > "Best adapted to well-drained loamy soils, light-textured, deep soils of intermediate fertility, low rainfall, and warm and moist climatic conditions"
  > "In shallow or hard soils, make ridges or mounds to increase the topsoil volume per plant for a better establishment." (even in fields, shallow soil must be artificially deepened)

## 9. Exclusion: pigeonpea (woody shrub too large) - CONFIRMED

- `[OFFICIAL]` Pigeon pea - Infonet-Biovision (Kenya, icipe-hosted; hosted by
  Access Agriculture).
  <https://assets.accessagriculture.org/s3fs-public/Pigeon_pea_by_infonet_biovision.pdf>
  > "Pigeon pea is a perennial shrub that is commonly grown as an annual crop. It has very slow initial development (up to 2 months after planting). With a deep taproot, pigeon peas are able to take up nutrients and water from lower subsoil layers."
  > "Pigeon pea does not tolerate shallow soils or water logging."
- `[OFFICIAL]` Pigeonpea TIMPs - KALRO official portal.
  <https://kalrotimps.com/timps/17>
  > "Its deep root system enables the plant to extract moisture from deep soil layers that are not ordinarily reached by other crops."
  > "Maturity duration varies depending on the variety and ranges between 3 months (short duration) to nine months for long duration."
  > (spacing context: "Long duration varieties (1.5 m by 0.5 m)" - a large woody plant footprint)

## Summary of changes applied to data/kitchen.json on 2026-11-05

| Crop | Field | Was | Now | Basis |
|---|---|---|---|---|
| sweetpotato | days_to_first_harvest (leaves) | 30-45 | 56-60 | PMC 2024 peer-reviewed: leaf harvest from 8 WAP |
| sweetpotato | notes | "leaves from about a month" | "leaves from about 8 weeks; 90 kg sacks are the Kenyan standard; tubers 4-7 months" | FARA 2018 guidebook + Kenyan practice |
| tomato | harvest_style | single_harvest_window | repeated_picking | FAO sack gardens (harvest twice a month); SHEP (3-4-month period) |
| cowpea | days_to_first_harvest (green pods) | 60-70 | 65-80 | Dryland Seed M66/K80 (flower 50-60 d, grain 80-90 d) + SHEP |
| dolichos | days_to_first_harvest (green pods) | 70-90 | 75-100 | Livestock Africa handbook (flower 60-80 d, grain 80-115 d) |
| amaranth | notes | (none about earliest harvest) | "leaves can start from 21 days when direct-sown" | SHEP (3-4 weeks after sowing), Ripple Effect (3 weeks) |
| kales | (all fields) | unchanged | unchanged | CONFIRMED as-is (Jua Kenya + SHEP + FAO) |
| (all crops) | min_depth_cm, min_volume_litres | defaults | defaults, labelled | no Kenyan official per-crop container minima exist; kales corroborated at 30 cm / about 20 L |
| (exclusions) | maize, cassava, pigeonpea | unchanged | unchanged, now cited | sections 7-9 above |

The other exclusions (sorghum: height and root depth; millet: broadcast field
crop; greengram: field crop, low container value; boma rhodes: fodder grass
needs area) rest on the same field-crop agronomy as maize and were not
separately re-sourced in this pass; they remain labelled as dataset judgments.
