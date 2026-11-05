/**
 * House-style counters for The 254 Report article.
 *
 *   node scripts/count-article.mjs [path]
 *
 * Default path: ../ARTICLE-WEATHER-STATION-ACCURACY-KENYA.md
 *
 * Body = lines from the `^# Kenya` H1 through (the `^### Internal links` line - 2),
 * so the links sections, STEP blocks and beehiiv fields are excluded.
 * Publication-equivalent = body with `[VERIFY ...]` flag spans (optional backticks)
 * stripped, pipe tokens and dash-only table-separator tokens excluded - the measure
 * that must sit inside 1,200-2,000 for analysis. Raw = same body, flags kept.
 * Flags = every `[VERIFY` occurrence in the whole file.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const file = resolve(process.argv[2] ?? '../ARTICLE-WEATHER-STATION-ACCURACY-KENYA.md');
const lines = readFileSync(file, 'utf8').split(/\r?\n/);
const s = lines.findIndex((l) => /^# Kenya/.test(l));
const e = lines.findIndex((l) => /^### Internal links/.test(l));
if (s < 0 || e < 0 || e <= s) {
  console.error('could not find the body boundaries (^# Kenya ... ^### Internal links)');
  process.exit(1);
}
const bodyTxt = lines.slice(s, e - 1).join('\n');
const tokens = (x) =>
  x.split(/\s+/).filter(Boolean).filter((w) => w !== '|' && !/^[-|:]+$/.test(w));
const pub = bodyTxt.replace(/`?\[VERIFY[^\]]*\]`?/g, '');
// The recorded publication-equivalent method (the 1,998 freeze number) excludes the
// `##`/`###` section-heading lines; "with headings" is the whole-body figure. Report
// both so the method can never silently drift again.
const contentOnly = lines
  .slice(s, e - 1)
  .filter((l) => !/^#{2,3} /.test(l))
  .join('\n')
  .replace(/`?\[VERIFY[^\]]*\]`?/g, '');
const whole = lines.join('\n');
console.log(
  `pub: ${tokens(contentOnly).length} (content, recorded method) | ${tokens(pub).length} (with section headings) | raw: ${tokens(bodyTxt).length} | flags: ${(whole.match(/\[VERIFY/g) ?? []).length}`,
);
