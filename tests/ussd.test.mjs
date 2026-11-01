import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { ussdResponse, ussdMenu } from '../src/ussd.mjs';
import { buildAdvisory } from '../src/advisory.mjs';
import { i18n } from '../src/i18n.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const crops = JSON.parse(readFileSync(join(here, '..', 'data', 'crops.json'), 'utf8')).crops;
const site = { name: 'Gataka', sub_county: 'Kajiado North', annual: { water_balance_pct: 44 } };

const advisory = (locale) =>
  buildAdvisory({ site, tercile: 'below', confidence: 'high', month: 11, locale, irrigation: false, crops });

const outlook = {
  months: [
    { month: '2026-10', calendar_month: 10, forecast_mm: 8, tercile: 'unknown', confidence: 'none', complete: false },
    { month: '2026-11', calendar_month: 11, forecast_mm: 96, tercile: 'above', confidence: 'high', complete: true },
    { month: '2026-12', calendar_month: 12, forecast_mm: 54, tercile: 'near', confidence: 'high', complete: true },
    { month: '2027-02', calendar_month: 2, forecast_mm: 9, tercile: 'below', confidence: 'high', complete: true },
    { month: '2027-05', calendar_month: 5, forecast_mm: 10, tercile: 'unknown', confidence: 'none', complete: false },
  ],
};

const run = (text, locale = 'sw') => ussdResponse(text, { site, advisory: advisory(locale), outlook, crops, locale });

test('empty input opens the menu and stays in the session', () => {
  for (const locale of ['sw', 'en']) {
    const r = run('', locale);
    assert.equal(r.end, false, 'the menu must not terminate the session');
    assert.equal(r.body, ussdMenu({ site, locale }));
    assert.match(r.body, /1\./);
    assert.match(r.body, /3\./);
  }
});

test('option 1 returns localized planting advice and ends the session', () => {
  const sw = run('1');
  assert.equal(sw.end, true);
  assert.ok(sw.body.includes('Panda:'), 'sw must use the Swahili verb');
  assert.ok(sw.body.includes('Kunde (60-70 siku)'), 'each crop carries its own window');

  const en = run('1', 'en');
  assert.ok(en.body.includes('Plant:'));
  assert.ok(en.body.includes('Cowpea (60-70 days)'));
  assert.ok(!en.body.includes('siku'), 'en must not leak Swahili units');
});

test('REGRESSION: option 2 never shows raw millimetres to a farmer', () => {
  for (const locale of ['sw', 'en']) {
    const r = run('2', locale);
    assert.ok(!/\d+\s*mm/i.test(r.body), `honesty rule: terciles only, got: ${r.body}`);
  }
});

test('REGRESSION: option 2 localizes terciles and skips partial months', () => {
  const sw = run('2');
  assert.ok(sw.body.includes('chini ya kawaida'), `expected the Swahili tercile label, got: ${sw.body}`);
  assert.ok(!/\b(above|below|near)\b/.test(sw.body), 'raw English tercile codes must not appear in sw output');
  assert.ok(!sw.body.includes('2026-10') && !sw.body.includes('2027-05'), 'partial months must be excluded');

  const en = run('2', 'en');
  assert.ok(en.body.includes('below normal'));
  assert.ok(!en.body.includes('chini ya kawaida'));
});

test('option 3 credits the data source and flags pilot status', () => {
  const r = run('3');
  assert.equal(r.end, true);
  assert.ok(r.body.includes('SEAS5') && r.body.includes('Open-Meteo'), 'must name the forecast source');
  assert.ok(r.body.includes('ERA5'), 'must name the baseline');
  assert.ok(r.body.includes('afisa kilimo'), 'must refer to the ward extension officer');
});

test('unknown input is handled, not crashed on', () => {
  for (const t of ['9', 'abc', '1.2', '*']) {
    const r = run(t);
    assert.equal(r.end, true);
    assert.ok(r.body.length > 0);
  }
});

test('no usable outlook yields an explicit no-data answer instead of invented advice', () => {
  const empty = { months: [{ month: '2026-10', tercile: 'unknown', confidence: 'none', complete: false }] };
  const r = ussdResponse('2', { site, advisory: advisory('sw'), outlook: empty, crops, locale: 'sw' });
  assert.equal(r.end, true);
  assert.ok(r.body.includes('Hakuna taarifa'), `got: ${r.body}`);
});

test('every USSD screen stays within a single-screen budget', () => {
  const levels = Object.keys(i18n.sw.levels);
  assert.ok(levels.length > 0);
  for (const locale of ['sw', 'en']) {
    for (const t of ['', '1', '2', '3', '9']) {
      const body = run(t, locale).body;
      assert.ok(body.length <= 320, `${locale} screen "${t}" is too long for USSD (${body.length} chars)`);
    }
  }
});
