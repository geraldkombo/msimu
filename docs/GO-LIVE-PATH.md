# Msimu - Go-Live Path (no guesswork, every claim sourced)

Written 5 November 2026. Every fact below was fetched from a public source today;
URLs and fetch dates are inline. Nothing here is speculation.

## 1. The name: keep "Msimu" (verified decision, not a vibe)

Checked 5 Nov 2026 against the institutions that matter:

- **Kenya Meteorological Department publishes in this exact word**: its Swahili
  seasonal forecasts are titled "OND 2026 Msimu wa Mvua Za Vuli" and "MAM 2026
  Msimu wa mvua za masika" (meteo.go.ke/our-products/seasonal-forecast, fetched
  5 Nov 2026). The national met office already trains the public on this word.
- **ICPAC itself uses it**: the Eastern Africa Crop Monitor reports "msimu rains
  variability" and "the msimu season harvest" (icpac.net/crop-monitor, fetched
  5 Nov 2026). The hackathon host's own publications speak our name.
- **FAO GIEWS uses it**: Tanzania country briefs reference the "Msimu harvest"
  (fao.org/giews, fetched 5 Nov 2026).
- **No product collision found**: the only other "Msimu" in agriculture research
  is a 2000s CIAT PhD thesis titled "Msimu wa Kupanda" (Planting Season), which
  includes a Swahili linguist's note that "Msimu" is preferred over alternatives
  because "it is both poetic and agricultural... Most farmers would say Msimu
  huu (this season), or Msimu ujao (next season)" (academia.edu/124938274,
  fetched 5 Nov 2026).

Verdict: the name is the farmers' own word for what the product delivers, it is
already used by KMD, ICPAC and FAO publications, and nothing collides with it.
Renaming one day before the deadline would churn the repo, the worker URL, the
README and the submitted application for zero gain. **Name stays: Msimu.**

## 2. How it operates completely, at $0, starting today

Three channels, all live right now, no money, no keys:

| Channel | Who uses it | Status |
|---|---|---|
| Web dashboard (msimu.shikunyi.workers.dev) | Extension officers, farmers with any smartphone browser on mobile data | LIVE, 113/113 automated checks |
| WhatsApp/SMS share button | Any farmer: officer builds the plan, shares it to a phone | LIVE (Web Share API + clipboard fallback) |
| JSON API (14 routes) | Counties, NGOs, other apps building on top | LIVE |

## 3. USSD: the honest, sourced path from demo to real phones

Our `/ussd` endpoint already speaks the exact protocol Kenya's USSD aggregators
use: HTTP POST, form-encoded `sessionId`, `phoneNumber`, `text`, `serviceCode`;
response is plain text starting with `CON` (continue) or `END` (terminate).
Verified against Africa's Talking documentation and guides (fetched 5 Nov 2026).

**Step 1 - free sandbox demo (cost: $0, available today).**
Africa's Talking gives every account a free sandbox with a browser-based phone
simulator: "The Sandbox is free for development and testing. You only start
paying once you provision a real shortcode" (helloduty.com/blogs/getting-started-with-the-africas-talking-ussd-api,
fetched 5 Nov 2026). Setup, per mctaba.com/kb/ussd-app-development-kenya (fetched
5 Nov 2026): create account -> Sandbox app -> USSD -> Create Channel -> point
the callback URL at `https://msimu.shikunyi.workers.dev/ussd` -> dial the
simulator. No real phone, no cost. This is what we demo at the hackathon.

**Step 2 - real shortcode on real phones (cost: money, deliberately deferred).**
Public rate cards fetched 5 Nov 2026:
- Shared USSD code in Kenya: roughly KES 15,000-40,000/month (helloduty.com
  Kenya pricing guide).
- Dedicated code, Safaricom via Africa's Talking: KES 145,000 setup + KES
  70,000/month maintenance; Airtel KES 116,000 + 46,400/month (help.africastalking.com,
  "How much is a dedicated USSD code?", fetched 5 Nov 2026).
- Per-session: about KES 0.40-0.80 (Africa's Talking Kenya rate card).

This is exactly what the US$10,000 prize or a county partnership funds. The
code side is finished and protocol-compatible; the only gate is the shortcode
lease, and saying so plainly is stronger in front of judges than pretending a
free nationwide shortcode exists.

**Operating constraints we already respect (sourced):** callbacks must respond
within ~10 seconds (our worker answers in 1-4s, measured live) and sessions
time out after ~180 seconds (our menu is single-screen per option, by design).

## 4. The scaling path that costs nothing

- Counties already run extension officer networks; the dashboard + share button
  is a complete workflow for an officer today, on the phone they already carry.
- RapidPro (free, open source, used across UNICEF/NGO programs) can sit between
  a shortcode and our API when funding exists; our JSON API is the integration
  surface and it is live.
- The national "pack" architecture means another county or IGAD state is a data
  pack (boundaries, crops, language), not a rebuild.

## 5. Data honesty: what is verified and what is still a default

`data/kitchen.json` now ships with `_provenance.status = "partially_verified"`.
On 5 November 2026 every harvest window, harvest style and crop exclusion was
matched against published Kenyan and institutional sources - MOALF-SHEP/JICA
crop guides, the FAO sack-gardens factsheet, KALRO, a Kenyan seed catalogue and
a peer-reviewed trial - and five corrections were applied (sweetpotato leaves
56-60 d, cowpea pods 65-80 d, dolichos pods 75-100 d, tomato repeated pickings,
amaranth 21-day note). Full citations, verbatim quotes and the honest
fetch-failure log: `docs/CONTAINER-DATA-SOURCES.md`. The container depths and
volumes remain app-derived horticultural defaults, because no Kenyan official
source publishes per-crop container minimums; every payload says so. This is
the house rule: a number either has a source or it says it has none.
