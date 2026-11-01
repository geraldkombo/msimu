export const cap = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : s);

export const i18n = {
  sw: {
    locale: 'sw',
    tercile: { below: 'chini ya kawaida', near: 'kawaida', above: 'juu ya kawaida', unknown: 'haijulikani' },
    season: {
      short_rains: 'mvua za vuli',
      long_rains: 'mvua za masika',
      dry_jun_sep: 'kiangazi (Jun-Sep)',
      dry_jan_feb: 'kiangazi (Jan-Feb)',
    },
    confidence: { high: 'uhakika wa juu', medium: 'uhakika wa wastani', low: 'uhakika mdogo', none: 'hakuna uhakika' },
    labels: {
      outlook: 'Hali ya msimu',
      plant_now: 'Mbegu',
      avoid: 'Epuka',
      livestock: 'Mifugo na maji',
      warning: 'Onyo',
      status: 'Hali',
      source: 'Chanzo',
      advisory_for: 'Ushauri wa',
      not_planting: 'Si wakati wa kupanda',
      irrigation_only: 'kwa umwagiliaji tu',
    },
    levels: {
      no_data: 'hakuna taarifa',
      watch: 'uangalizi',
      alert: 'tahadhari',
      normal: 'kawaida',
    },
    templates: {
      outlook: (season, tercile, conf) => `${cap(season)}: mvua zinatarajiwa kuwa ${tercile} - ${cap(conf)}.`,
      plant: (names) => `${names} - panda wiki hii.`,
      avoid: (names, reason) => `Usipande ${names} (${reason}).`,
      water_balance: (pct) => `Mvua ya mwaka hapa ni ${pct}% tu ya maji yanayohitajika na mimea. Mahindi ya mvua pekee ni kamari.`,
    },
    reasons: {
      needs_irrigation: 'inahitaji umwagiliaji',
      drought_risk: 'hatari ya ukame',
      water_balance: 'maji hayatoshi',
      dry_season: 'sio msimu wa kupanda',
    },
    early_warning: {
      no_data: 'Hakuna taarifa ya kutegemewa kwa kipendi hiki. Usipange kwa kutegemea huduma hii pekee; uliza afisa kilimo wa kata.',
      below_in_planting: 'Mvua inatarajiwa kuwa chini ya kawaida katika msimu wa kupanda. Chelewesha kupanda au chagua mbegu ya kukomaa haraka.',
      below_in_dry: 'Mvua chini ya kawaida ikiingia kipindi cha kiangazi. Hakikisha maji na chakula cha mifugo sasa hivi.',
      above: 'Mvua inatarajiwa kuwa juu ya kawaida. Hatari kuu ni mafuriko kwenye ardhi ya chini na magonjwa ya mimea.',
      normal: 'Hali ya mvua inaendana na kawaida kwa kipindi hiki cha mwaka.',
    },
    livestock: {
      water_pans: 'Jaza mabwawa ya maji na uhakikishe njia ya kisima sasa, kabla mahitaji kufikia kilele.',
      secure_hay: 'Nunua au kate hay wakati bado unapatikana; usisubiri kiangazi kianze.',
      destock_early: 'Punguza mifugo kwenye malisho dhaifu kwanza; uza mapema badala ya kuchelewa.',
      move_off_low_ground: 'Hamisha mifugo kutoka ardhi ya chini na udongo wa finyanzi kabla haijafungwa na maji.',
      tick_and_worm: 'Kupe na minyoo huongezeka mvua inaponyesha. Fanya dip au nyunyiza dawa kwa ratiba.',
      establish_fodder: 'Panda au ongeza nyasi ya Boma Rhodes sasa ili uwe na hay ya kukata kiangazi kijacho.',
    },
  },
  en: {
    locale: 'en',
    tercile: { below: 'below normal', near: 'near normal', above: 'above normal', unknown: 'unknown' },
    season: {
      short_rains: 'short rains',
      long_rains: 'long rains',
      dry_jun_sep: 'dry season (Jun-Sep)',
      dry_jan_feb: 'dry season (Jan-Feb)',
    },
    confidence: { high: 'high confidence', medium: 'medium confidence', low: 'low confidence', none: 'no confidence' },
    labels: {
      outlook: 'Season outlook',
      plant_now: 'Seed choice',
      avoid: 'Avoid',
      livestock: 'Livestock and water',
      warning: 'Warning',
      status: 'Status',
      source: 'Source',
      advisory_for: 'Advisory for',
      not_planting: 'Not a planting window',
      irrigation_only: 'irrigation only',
    },
    levels: {
      no_data: 'no data',
      watch: 'watch',
      alert: 'alert',
      normal: 'normal',
    },
    templates: {
      outlook: (season, tercile, conf) => `${cap(season)}: rainfall is expected ${tercile} - ${cap(conf)}.`,
      plant: (names) => `${names} - plant this week.`,
      avoid: (names, reason) => `Do not plant ${names} (${reason}).`,
      water_balance: (pct) => `Annual rainfall here is only ${pct}% of crop water demand. Rainfed maize is a gamble, not a plan.`,
    },
    reasons: {
      needs_irrigation: 'needs irrigation',
      drought_risk: 'drought risk',
      water_balance: 'insufficient water',
      dry_season: 'not a planting season',
    },
    early_warning: {
      no_data: 'No usable outlook for this period. Do not plan on this service alone; ask your ward extension officer.',
      below_in_planting: 'Rainfall is expected below normal in a planting season. Delay planting or choose the shortest-maturity crop.',
      below_in_dry: 'Below-normal rainfall entering a dry season. Secure water and fodder now.',
      above: 'Rainfall is expected above normal. The main risks are waterlogging on low ground and crop disease.',
      normal: 'Rainfall is tracking near normal for this time of year.',
    },
    livestock: {
      water_pans: 'Fill water pans and confirm borehole access now, before demand peaks.',
      secure_hay: 'Buy or cut hay while it is still available; do not wait for the dry spell to begin.',
      destock_early: 'Reduce herd pressure on the weakest pasture first; destock early rather than late.',
      move_off_low_ground: 'Move livestock off low ground and black cotton soil before it becomes impassable.',
      tick_and_worm: 'Tick and worm pressure rises in wet conditions. Dip or spray on schedule.',
      establish_fodder: 'Establish or top up Boma Rhodes now so there is hay to cut in the next dry season.',
    },
  },
};

export function t(locale, path) {
  const parts = String(path).split('.');
  let cur = i18n[locale] ?? i18n.en;
  for (const p of parts) {
    if (cur == null) return path;
    cur = cur[p];
  }
  return cur ?? path;
}

export function supportedLocales() {
  return Object.keys(i18n);
}
