import { i18n } from './i18n.mjs';
import { suitableContainers } from './kitchen.mjs';

const firstSentence = (s) => String(s ?? '').split(/(?<=[.!?])\s/)[0].trim();

function cropLine(c, locale) {
  const unit = locale === 'sw' ? 'siku' : 'days';
  const name = locale === 'sw' ? (c.sw ?? c.en) : (c.en ?? c.sw);
  return `${name} (${c.maturity_days[0]}-${c.maturity_days[1]} ${unit})`;
}

export function ussdMenu({ site, locale }) {
  return locale === 'sw'
    ? `Karibu Msimu - ${site.name}.\n1. Ushauri wa kupanda\n2. Hali ya mvua msimu huu\n3. Kuhusu huduma hii\n4. Mpango wa chakula na maji\n5. Kilimo cha gunny sacks`
    : `Welcome to Msimu - ${site.name}.\n1. Planting advice\n2. This season's rainfall outlook\n3. About this service\n4. Food and water plan\n5. Sack and container gardening`;
}

export function ussdResponse(text, { site, advisory, outlook, crops, food, locale = 'sw' }) {
  const t = String(text ?? '').trim();
  const byId = new Map((crops ?? []).map((c) => [c.id, c]));

  if (t === '') return { end: false, body: ussdMenu({ site, locale }) };

  if (t === '1') {
    const tercileLine = advisory.lines.find((l) => l.includes(':')) ?? '';
    const top = advisory.structured.recommended
      .map((id) => byId.get(id))
      .filter(Boolean)
      .slice(0, 3)
      .map((c) => cropLine(c, locale))
      .join(', ');
    const warn = advisory.lines.find((l) => /^(Onyo|Warning|Hali|Status)\s\(/.test(l));
    const parts = [firstSentence(tercileLine)];
    if (top) parts.push(locale === 'sw' ? `Panda: ${top}.` : `Plant: ${top}.`);
    if (warn) parts.push(firstSentence(warn));
    return { end: true, body: parts.filter(Boolean).join('\n') };
  }

  if (t === '2') {
    const L = i18n[locale] ?? i18n.en;
    const months = (outlook.months ?? []).filter((m) => m.complete && m.tercile !== 'unknown').slice(0, 3);
    if (months.length === 0) {
      return { end: true, body: locale === 'sw' ? 'Hakuna taarifa ya kutegemewa kwa sasa.' : 'No usable outlook right now.' };
    }
    const label = locale === 'sw' ? 'Miezi ijayo' : 'Coming months';
    return {
      end: true,
      body: [
        `${label}:`,
        ...months.map((m) => `${m.month}: ${L.tercile[m.tercile] ?? m.tercile}`),
      ].join('\n'),
    };
  }

  if (t === '3') {
    return {
      end: true,
      body:
        locale === 'sw'
          ? 'Msimu hugeuza utabiri wa msimu kuwa hatua ya kilimo. Chanzo: ECMWF SEAS5 kupitia Open-Meteo, ukilinganishwa na historia ya ERA5 2005-2024. Huduma ya majaribio - onana na afisa kilimo wa kata.'
          : 'Msimu turns a seasonal forecast into a farming decision. Source: ECMWF SEAS5 via Open-Meteo, classified against an ERA5 2005-2024 baseline. Pilot service - confirm with your ward extension officer.',
    };
  }

  if (t === '4') {
    // USSD lives or dies by the screen budget: pack whole lines up to ~300
    // chars, never more than four, never a truncated half-sentence.
    const out = [];
    let n = 0;
    for (const l of food?.lines ?? []) {
      if (out.length >= 4) break;
      if (out.length > 0 && n + String(l).length > 300) break;
      out.push(String(l));
      n += String(l).length + 1;
    }
    if (out.length === 0) {
      return {
        end: true,
        body: locale === 'sw' ? 'Hakuna mpango wa chakula kwa sasa. Jaribu tena baadaye.' : 'No food plan available right now. Try again later.',
      };
    }
    return { end: true, body: out.join('\n') };
  }

  if (t === '5') {
    // Sack gardening for the household with no field: the same seasonal signal,
    // translated for containers. Ranked by the pure kitchen module (fastest
    // harvest first; dry-tercile reordering included), named from the crop pack,
    // priced in weeks-to-first-harvest because that is what a sack farmer plans
    // around. Data status is honest: standard horticultural ranges, labelled.
    const month = new Date().getUTCMonth() + 1;
    const firstKnown = (outlook?.months ?? []).find((m) => m.complete && m.tercile !== 'unknown');
    const tercile = firstKnown?.tercile ?? 'near';
    const { ranked } = suitableContainers({ light: 'part_shade_ok', month, tercile });
    const wk = locale === 'sw' ? 'wiki' : 'wk';
    const names = ranked
      .slice(0, 4)
      .map((r) => {
        const c = byId.get(r.crop_id);
        const nm = c ? (locale === 'sw' ? (c.sw ?? c.en) : (c.en ?? c.sw)) : String(r.crop_id).replace(/_/g, ' ');
        const weeks = Math.ceil((r.days_to_first_harvest[0] + r.days_to_first_harvest[1]) / 2 / 7);
        return `${nm} (${wk} ${weeks})`;
      })
      .join(', ');
    const body =
      locale === 'sw'
        ? `Kilimo cha gunny sacks na mabeseni:\nPanda: ${names}.\nMwagilia asubuhi na jioni - mabeseni hukauka haraka kuliko shamba.\nVipimo vya mavuno kutoka miongozo iliyochapishwa Kenya - thibitisha kwa afisa kilimo wa kata.`
        : `Sack and container gardening:\nPlant: ${names}.\nWater morning and evening - sacks dry out far faster than a field.\nHarvest windows from published Kenyan guides; sizes are defaults - confirm with your ward extension officer.`;
    return { end: true, body };
  }

  return {
    end: true,
    body: locale === 'sw' ? 'Chaguo si sahihi. Piga *384# tena.' : 'Invalid choice. Dial *384# again.',
  };
}
