import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { buildAdvisory, cropName } from '../src/advisory.mjs';
import { selectCrops } from '../src/rules.mjs';
import { i18n } from '../src/i18n.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const crops = JSON.parse(readFileSync(join(here, '..', 'data', 'crops.json'), 'utf8')).crops;
const site = { name: 'Gataka', sub_county: 'Kajiado North', annual: { water_balance_pct: 44 } };

const advisory = (over = {}) =>
  buildAdvisory({
    site,
    tercile: 'below',
    confidence: 'high',
    month: 11,
    locale: 'en',
    irrigation: false,
    crops,
    ...over,
  });

test('cropName does not duplicate the name when the locale matches the English label', () => {
  const cowpea = crops.find((c) => c.id === 'cowpea');
  assert.equal(cropName(cowpea, 'en'), 'Cowpea');
  assert.equal(cropName(cowpea, 'sw'), 'Kunde (Cowpea)');
});

test('REGRESSION: no internal level codes leak into farmer-facing text', () => {
  for (const locale of ['en', 'sw']) {
    const a = advisory({ locale });
    const L = i18n[locale];
    assert.ok(!/\[(watch|alert|no_data|normal)\]/.test(a.text), `${locale} leaked a raw bracketed level code`);
    const line = a.lines.find((l) => l.startsWith(`${L.labels.warning} (`) || l.startsWith(`${L.labels.status} (`));
    assert.ok(line, `${locale} must carry a labelled early-warning line`);
    const level = line.match(/^[^(]+\(([^)]+)\):/)[1];
    assert.ok(
      Object.values(L.levels).includes(level),
      `${locale} level "${level}" must be one of the localized level names`,
    );
  }
});

test('every entry in lines is a single line, so channels can chunk it safely', () => {
  for (const locale of ['en', 'sw']) {
    for (const tercile of ['below', 'near', 'above', 'unknown']) {
      const a = advisory({ locale, tercile });
      for (const l of a.lines) {
        assert.ok(!l.includes('\n'), `multi-line entry would break SMS/USSD chunking: ${JSON.stringify(l)}`);
      }
      assert.equal(a.text, a.lines.join('\n'));
    }
  }
});

test('REGRESSION: the seed headline must not attribute one maturity window to every crop', () => {
  const a = advisory();
  const headline = a.lines.find((l) => l.startsWith('Seed choice:'));
  assert.ok(headline, 'seed headline must exist');
  assert.ok(!/days/.test(headline), `headline wrongly claims a single window for all crops: ${headline}`);
});

test('REGRESSION: every recommended crop is listed with its own maturity window', () => {
  const a = advisory();
  const expected = selectCrops({ tercile: 'below', month: 11, waterBalancePct: 44, irrigation: false, crops })
    .recommended.slice(0, 3);
  assert.ok(expected.length > 1, 'test needs more than one recommendation to be meaningful');
  for (const c of expected) {
    const line = a.lines.find((l) => l.startsWith(`- ${cropName(c, 'en')}:`));
    assert.ok(line, `${c.en} must have its own bullet`);
    assert.ok(
      line.includes(`${c.maturity_days[0]}-${c.maturity_days[1]} days`),
      `${c.en} bullet must state its own window, got: ${line}`,
    );
  }
});

test('REGRESSION: the avoid line states a reason that belongs to the crops it names', () => {
  const a = advisory();
  const line = a.lines.find((l) => l.startsWith('Do not plant'));
  assert.ok(line, 'below-normal season must warn against some crops');
  const reasons = selectCrops({ tercile: 'below', month: 11, waterBalancePct: 44, irrigation: false, crops }).avoid
    .filter((x) => x.reason === 'water_balance' || x.reason === 'drought_risk')
    .slice(0, 3)
    .map((x) => x.reason);
  assert.ok(new Set(reasons).size === 1, 'expected a single shared reason in this scenario');
  assert.ok(line.includes(reasons[0].replace('_', ' ')), `avoid line must carry the real reason, got: ${line}`);
});

test('localized warning labels are used instead of English ones in Swahili output', () => {
  const sw = advisory({ locale: 'sw' }).lines;
  assert.ok(sw.some((l) => l.startsWith('Onyo (') || l.startsWith('Hali (')), 'sw warning line must be localized');
  assert.ok(!sw.some((l) => l.startsWith('Warning')), 'sw output must not fall back to the English label');
});

test('unknown tercile produces a no-data status, never fabricated advice', () => {
  const a = advisory({ tercile: 'unknown', confidence: 'none', locale: 'sw' });
  assert.ok(a.lines.some((l) => l.startsWith('Hali (')), 'no_data is a status, not a warning');
  assert.ok(a.text.includes('afisa kilimo'), 'must refer the farmer to the ward extension officer');
  assert.equal(a.structured.early_warning, 'no_data');
});
