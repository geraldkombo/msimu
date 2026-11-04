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
    food: {
      months: ['Jan', 'Feb', 'Mac', 'Apr', 'Mei', 'Jun', 'Jul', 'Ago', 'Sep', 'Okt', 'Nov', 'Des'],
      stance: {
        prepare_now: 'Jitayarishe sasa: misimu kadhaa chini ya kawaida inakuja.',
        caution: 'Tahadhari: baadhi ya miezi itakuwa chini ya kawaida.',
        good_season: 'Msimu unaonekana mzuri - bado weka akiba.',
      },
      labels: {
        plan_for: 'Mpango wa usalama wa chakula wa',
        verdict: 'Hukumu',
        lean: 'Miezi ya uhaba',
        planting: 'Mipango ya kupanda',
        skip: 'Usipande',
        water: 'Maji ya mvua',
        tank: 'Ukubwa wa tangi linalopendekezwa',
        actions: 'Hatua',
        risk: 'hatari',
        harvest: 'vuno',
        plant_month: 'Panda',
        crop: 'Zao',
      },
      templates: {
        plant_by: (crops, month) => `Panda ${crops} ifikapo ${month}.`,
        harvest_dry: (crop, month) => `Vuna na kausha ${crop} mwezi ${month}; hifadhi juu ya sakafu, si chini yake.`,
        clean_catchment: (month) => `Safisha paa, mifereji ya maji na tangi kabla ya mvua kuanza (${month}).`,
        bridge: (month) => `Mwezi ${month} ni wa uhaba: punguza matumizi ya akiba na nunua mapema bei sijapanda.`,
        tank: (litres) => `Tangi la lita ${litres} au zaidi litatosheleza kipindi kirefu cha ukosefu wa maji.`,
        lean_streak: (n) => `Kiwango cha uhaba: miezi ${n} mfululizo ya maji kushindwa mahitaji ya mimea.`,
        water_balance: (pct) => `Mvua ya mwaka hapa ni ${pct}% tu ya mahitaji ya maji ya mimea. Mahindi ya mvua pekee ni kamari.`,
        balcony: 'Huna shamba? Panda kwenye mifuko, mitungi na vikapu kwenye roshani au ua - angalia ushauri wa bustani ya jikoni.',
        tank_bought: (litres) => `Ukinunua maji, weka angalau lita ${litres} za hifadhi iliyofunikwa kutosheleza kipindi kirefu cha ukosefu wa maji.`,
        flat_water: 'Hifadhi maji unayonunua kwenye chombo kilichofunikwa; chemsha au safisha kabla ya kunywa.',
        thatch_note: 'Paa la makuti haliwezi kuvuna maji: mpango huu unategemea maji ya kununua na hifadhi iliyofunikwa.',
        tiles_note: 'Vigae na zege vinamwaga mvua kidogo kuliko mabati: chukua ukubwa wa tangi ulio hapo chini kama makadirio bora, si ahadi.',
      },
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
    food: {
      months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
      stance: {
        prepare_now: 'Prepare now: several below-normal months are coming.',
        caution: 'Caution: some months will be below normal.',
        good_season: 'The season looks good - still keep reserves.',
      },
      labels: {
        plan_for: 'Food security plan for',
        verdict: 'Verdict',
        lean: 'Lean months',
        planting: 'Planting plan',
        skip: 'Do not plant',
        water: 'Rainwater',
        tank: 'Recommended tank size',
        actions: 'Actions',
        risk: 'risk',
        harvest: 'harvest',
        plant_month: 'Plant',
        crop: 'Crop',
      },
      templates: {
        plant_by: (crops, month) => `Plant ${crops} by ${month}.`,
        harvest_dry: (crop, month) => `Harvest and dry ${crop} in ${month}; store off the floor, not on it.`,
        clean_catchment: (month) => `Clean the roof, gutters and tank before the rains start (${month}).`,
        bridge: (month) => `${month} is a lean month: cut reserve use and buy early before prices rise.`,
        tank: (litres) => `A tank of ${litres} litres or more will cover the longest gap in rainfall.`,
        lean_streak: (n) => `Lean severity: ${n} consecutive months where rain fails crop demand.`,
        water_balance: (pct) => `Annual rainfall here is only ${pct}% of crop water demand. Rainfed maize is a gamble, not a plan.`,
        balcony: 'No land? Grow in sacks, pots and containers on a balcony or yard - see the kitchen garden advice.',
        tank_bought: (litres) => `If you buy water, keep at least ${litres} litres of covered storage to ride out the longest dry gap.`,
        flat_water: 'Store bought water in a covered container, and boil or treat it before drinking.',
        thatch_note: 'A thatch roof cannot harvest water: this plan runs on bought water and covered storage.',
        tiles_note: 'Tiles and rough concrete shed less rain than iron sheet: treat the tank size below as a best case, not a promise.',
      },
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
