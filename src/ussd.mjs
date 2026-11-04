import { i18n } from './i18n.mjs';

const firstSentence = (s) => String(s ?? '').split(/(?<=[.!?])\s/)[0].trim();

function cropLine(c, locale) {
  const unit = locale === 'sw' ? 'siku' : 'days';
  const name = locale === 'sw' ? (c.sw ?? c.en) : (c.en ?? c.sw);
  return `${name} (${c.maturity_days[0]}-${c.maturity_days[1]} ${unit})`;
}

export function ussdMenu({ site, locale }) {
  return locale === 'sw'
    ? `Karibu Msimu - ${site.name}.\n1. Ushauri wa kupanda\n2. Hali ya mvua msimu huu\n3. Kuhusu huduma hii\n4. Mpango wa chakula na maji`
    : `Welcome to Msimu - ${site.name}.\n1. Planting advice\n2. This season's rainfall outlook\n3. About this service\n4. Food and water plan`;
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

  return {
    end: true,
    body: locale === 'sw' ? 'Chaguo si sahihi. Piga *384# tena.' : 'Invalid choice. Dial *384# again.',
  };
}
