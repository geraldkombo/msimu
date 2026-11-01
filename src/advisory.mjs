import { selectCrops, livestockAdvice, earlyWarning, seasonForMonth, isPlantingWindow } from './rules.mjs';
import { i18n } from './i18n.mjs';

export function cropName(c, locale) {
  const primary = c?.[locale] ?? c?.sw ?? c?.en ?? '';
  if (!c?.en || primary === c.en) return primary;
  return `${primary} (${c.en})`;
}

export function buildAdvisory({ site, tercile, confidence, month, locale = 'sw', irrigation = false, crops }) {
  const L = i18n[locale] ?? i18n.en;
  const season = seasonForMonth(month);
  const lines = [];

  lines.push(`${L.labels.advisory_for} ${site.name}, ${site.sub_county}.`);
  lines.push(L.templates.outlook(L.season[season], L.tercile[tercile] ?? L.tercile.unknown, L.confidence[confidence] ?? ''));

  const decision = selectCrops({
    tercile,
    month,
    waterBalancePct: site.annual?.water_balance_pct,
    irrigation,
    crops,
  });

  if (!isPlantingWindow(season)) {
    lines.push(`${L.labels.not_planting}: ${L.season[season]}.`);
  }

  if (decision.recommended.length > 0) {
    const top = decision.recommended.slice(0, 3);
    const names = top.map((c) => cropName(c, locale)).join(', ');
    lines.push(`${L.labels.plant_now}: ${L.templates.plant(names)}`);
    const unit = locale === 'sw' ? 'siku' : 'days';
    for (const c of top) {
      lines.push(`- ${cropName(c, locale)}: ${c.maturity_days[0]}-${c.maturity_days[1]} ${unit}`);
    }
  }

  const pickedAvoid = decision.avoid
    .filter((a) => a.reason === 'water_balance' || a.reason === 'drought_risk')
    .slice(0, 3);
  if (pickedAvoid.length > 0) {
    const names = pickedAvoid.map((a) => cropName(a.crop, locale)).join(', ');
    const reasons = [...new Set(pickedAvoid.map((a) => L.reasons[a.reason] ?? a.reason))].join(', ');
    lines.push(L.templates.avoid(names, reasons));
  }

  const wb = decision.warnings.find((w) => w.code === 'water_balance');
  if (wb && site.annual?.water_balance_pct) {
    lines.push(L.templates.water_balance(site.annual.water_balance_pct));
  }

  const ew = earlyWarning({ tercile, season });
  const ewText = L.early_warning?.[ew.key] ?? i18n.en.early_warning[ew.key] ?? ew.key;
  const ewLevel = L.levels?.[ew.level] ?? i18n.en.levels?.[ew.level] ?? ew.level;
  const ewLabel = ew.level === 'watch' || ew.level === 'alert' ? L.labels.warning : L.labels.status;
  lines.push(`${ewLabel} (${ewLevel}): ${ewText}`);

  const stock = livestockAdvice({ tercile, month, season });
  if (stock.length > 0) {
    lines.push(`${L.labels.livestock}:`);
    stock.forEach((k) => lines.push(`- ${L.livestock?.[k] ?? i18n.en.livestock[k] ?? k}`));
  }

  lines.push(`${L.labels.source}: ECMWF SEAS5 via Open-Meteo, tercile vs ERA5 ${'2005-2024'}.`);

  return {
    locale,
    site: site.name,
    month,
    season,
    tercile,
    confidence,
    irrigation,
    lines,
    text: lines.join('\n'),
    structured: {
      recommended: decision.recommended.map((c) => c.id),
      avoid: decision.avoid.map((a) => ({ id: a.crop.id, reason: a.reason })),
      warnings: decision.warnings.map((w) => w.code),
      early_warning: ew.level,
    },
  };
}
