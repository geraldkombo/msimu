/**
 * The verification desk: who a household confirms this plan with, and how they
 * know the person or packet is legitimate.
 *
 * Saved artifact behind every entry: docs/KENYA-VERIFICATION-DESK.md (fetched
 * 2 November 2026). No invented phone numbers: the desk points at offices,
 * certification schemes and county-published contact pages only.
 *
 * Pure module: no fs, no fetch, no Node or Workers APIs.
 */

export const VERIFY_WITH = [
  {
    id: 'subcounty_agriculture',
    title: {
      en: 'Your sub-county or ward agriculture office',
      sw: 'Ofisi ya kilimo ya sub-kaunti au kata yako',
    },
    how: {
      en: 'The extension officer this plan means sits in the sub-county or ward agricultural office under the county Department of Agriculture. Visit in person; agriculture is a devolved function, so that office is the authority for your area.',
      sw: 'Afisa ugani anayemaanishwa na mpango huyu yupo ofisi ya kilimo ya sub-kaunti au kata chini ya idara ya kilimo ya kaunti. Tembelea kwa mwenyewe; kilimo ni kazi ya kaunti, hivyo ofisi hiyo ndiyo mamlaka ya eneo lako.',
    },
    url: 'https://kilimo.go.ke/organogram/',
  },
  {
    id: 'kephis_seed',
    title: {
      en: 'KEPHIS certified-seed check',
      sw: 'Kikao cha mbegu zilizothibitishwa na KEPHIS',
    },
    how: {
      en: 'Certified seed carries a KEPHIS certification sticker label on the packet, and only licensed seed companies and dealers may sell it. No sticker label means not certified: that is the reliability test you can apply in the shop.',
      sw: 'Mbegu iliyothibitishwa huwa na lebo ya sticker ya KEPHIS kwenye kifurushi, na ni kampuni na wauza mbegu wenye leseni tu wanaoruhusiwa kuiuza. Hakuna lebo ina maana haijathibitishwa: hilo ndilo kipimo cha kuaminika unachoweza kutumia dukani.',
    },
    url: 'https://kephis.org/images/new/kephisstickerseedlabel.pdf',
  },
  {
    id: 'kalro_selector',
    title: {
      en: 'KALRO county variety selector',
      sw: 'Kikao cha KALRO cha kubagua mbegu kwa kaunti',
    },
    how: {
      en: 'KALRO breeds and tests the varieties Kenya releases; the selector matches released varieties to your county, so a seed claim can be checked against the official list.',
      sw: 'KALRO huzalisha na kujaribu mbegu zinazotolewa Kenya; kikao hiki chuo hulinganisha mbegu zilizotolewa na kaunti yako, hivyo madai ya mbegu yanaweza kuthibitishwa kwa orodha rasmi.',
    },
    url: 'https://selector.kalro.org/',
  },
  {
    id: 'ndma_bulletin',
    title: {
      en: 'NDMA monthly drought bulletin',
      sw: 'Taarifa ya ukame ya kila mwezi ya NDMA',
    },
    how: {
      en: 'The national drought early warning bulletin states your county\'s drought phase each month; compare it with the lean months in this plan before spending reserves.',
      sw: 'Taarifa ya kitaifa ya tahadhari ya ukame hutangaza hatua ya ukame ya kaunti yako kila mwezi; linganisha na miezi ya uhaba ya mpango huu kabla ya kutumia akiba.',
    },
    url: 'https://knowledgeweb.ndma.go.ke/',
  },
  {
    id: 'county_contacts',
    title: {
      en: 'Your county agriculture directorate page',
      sw: 'Ukurasa wa idara ya kilimo wa kaunti yako',
    },
    how: {
      en: 'Some counties publish their officers\' names and phone numbers on the county\'s own website (Nyeri does, per sub-county). Trust a phone number only when it is published there or met at the sub-county office.',
      sw: 'Kaunti fulani huchapisha majina na namba za simu za maafisa wake kwenye tovuti ya kaunti yenyewe (Nyeri hufanya, kwa kila sub-kaunti). Aminini namba ya simu tu ikiwa imechapishwa huko au mkikutana ofisi ya sub-kaunti.',
    },
    url: 'https://www.nyeri.go.ke/directorate-of-agriculture/',
  },
];
