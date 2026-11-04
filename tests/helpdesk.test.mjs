import { test } from 'node:test';
import assert from 'node:assert/strict';

import { VERIFY_WITH } from '../src/helpdesk.mjs';

test('the verification desk is bilingual, linked and free of invented phone numbers', () => {
  assert.ok(VERIFY_WITH.length >= 4);
  for (const v of VERIFY_WITH) {
    assert.ok(v.id && /^https:\/\//.test(v.url), `${v.id} needs a public https source`);
    for (const lang of ['sw', 'en']) {
      assert.ok(String(v.title?.[lang] ?? '').length > 5, `${v.id} title in ${lang}`);
      assert.ok(String(v.how?.[lang] ?? '').length > 20, `${v.id} how in ${lang}`);
    }
    assert.ok(!/\+?\d{9,}/.test(v.how.en + v.how.sw), `${v.id} must not invent phone numbers`);
  }
  const ids = VERIFY_WITH.map((v) => v.id);
  assert.ok(ids.includes('subcounty_agriculture'), 'the physical office must be first among equals');
  assert.ok(ids.includes('kephis_seed'), 'seed reliability is the certification scheme');
});
