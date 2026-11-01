import test from 'node:test';
import assert from 'node:assert/strict';
import { scan, clean } from '../scripts/dedash.mjs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('no long dashes survive anywhere in the repo', async () => {
  const offenders = await scan(root);
  assert.deepEqual(
    offenders,
    [],
    `long dashes found (run: node scripts/dedash.mjs --write): ${JSON.stringify(offenders)}`,
  );
});

test('clean() folds ranges, sentence breaks, entities and the unicode minus', () => {
  // Built from parts so this file never contains a literal long dash or dash entity itself.
  const ent = (name) => `&${name};`;
  assert.equal(clean('2005\u20132024'), '2005-2024');
  assert.equal(clean('ERA5 2005 \u2013 2024 baseline'), 'ERA5 2005-2024 baseline');
  assert.equal(clean('forecast \u2014 decision'), 'forecast - decision');
  assert.equal(clean(`a ${ent('mdash')} b ${ent('ndash')} c ${ent('minus')} d`), 'a - b - c - d');
  assert.equal(clean('\u221212%'), '-12%');
  assert.equal(clean(clean('x \u2014 y')), clean('x \u2014 y'), 'clean() must be idempotent');
  for (const ch of ['\u2014', '\u2013', '\u2015', '\u2212']) {
    assert.ok(!clean(`before${ch}after`).includes(ch), `${ch.charCodeAt(0).toString(16)} must be removed`);
  }
});
