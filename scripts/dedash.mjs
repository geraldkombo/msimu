/**
 * Long-dash sweeper. The house style is a plain hyphen: no em dash, no en dash, no unicode minus,
 * in prose, code, docs or data. Run:
 *   node scripts/dedash.mjs --check    # exit 1 if any long dash survives (used by tests and CI)
 *   node scripts/dedash.mjs --write    # rewrite the offenders in place
 *
 * Ranges such as 2005-2024 collapse to a hyphen with no spaces; a dash used as a sentence break
 * becomes " - " so the sentence still reads. HTML entities are folded to a hyphen as well.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { readdir, stat } from 'node:fs/promises';
import { join, relative, extname, sep } from 'node:path';

export const LONG_DASHES = ['\u2014', '\u2013', '\u2012', '\u2015', '\u2212', '\u2010', '\u2011'];
export const LONG_DASH_RE = /[\u2014\u2013\u2012\u2015\u2212\u2010\u2011]/;
const ENTITY_RE = /&(?:mdash|ndash|minus|#8212|#8211|#8722);/g;

const TEXT_EXTENSIONS = new Set(['.md', '.mjs', '.js', '.json', '.html', '.css', '.yml', '.yaml', '.toml', '.txt', '.csv']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'cache', 'boundaries']);
const SKIP_FILES = new Set(['wards.json', 'wards-index.json']);

export function clean(text) {
  let out = String(text).replace(ENTITY_RE, '-');
  // digit<dash>digit is a range: keep it tight.
  out = out.replace(/(\d)\s*[\u2014\u2013\u2012\u2015\u2212\u2010\u2011]\s*(?=\d)/g, '$1-');
  // otherwise it was a sentence break: keep the spacing readable.
  out = out.replace(/\s*[\u2014\u2015]\s*/g, ' - ');
  out = out.replace(/[\u2013\u2012\u2212\u2010\u2011]/g, '-');
  return out;
}

export async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walk(join(dir, entry.name));
      continue;
    }
    if (!TEXT_EXTENSIONS.has(extname(entry.name))) continue;
    if (SKIP_FILES.has(entry.name)) continue;
    yield join(dir, entry.name);
  }
}

export async function scan(root) {
  const offenders = [];
  for await (const file of walk(root)) {
    const text = await readFile(file, 'utf8');
    const hits = [];
    text.split('\n').forEach((line, i) => {
      if (LONG_DASH_RE.test(line) || /&(?:mdash|ndash|minus);/.test(line)) hits.push(i + 1);
    });
    if (hits.length) offenders.push({ file: relative(root, file).split(sep).join('/'), lines: hits });
  }
  return offenders;
}

const argv = process.argv.slice(2);
if (argv.includes('--check') || argv.includes('--write')) {
  const root = process.cwd();
  const offenders = await scan(root);
  if (argv.includes('--write')) {
    for (const o of offenders) {
      const p = join(root, o.file);
      const text = await readFile(p, 'utf8');
      await writeFile(p, clean(text), 'utf8');
    }
    console.log(`rewrote ${offenders.length} file(s)`);
    const after = await scan(root);
    console.log(after.length === 0 ? 'long dashes remaining: 0' : `STILL DIRTY: ${JSON.stringify(after)}`);
    if (after.length) process.exitCode = 1;
  } else {
    if (offenders.length === 0) {
      console.log('long dashes: none');
    } else {
      for (const o of offenders) console.log(`${o.file}: lines ${o.lines.join(', ')}`);
      console.log(`FAIL: ${offenders.length} file(s) contain long dashes. Run: node scripts/dedash.mjs --write`);
      process.exitCode = 1;
    }
  }
}
