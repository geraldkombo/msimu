// Build the legacy Worker's asset directory: an exact copy of web/ minus
// _worker.js, which is a Cloudflare Pages-only file that Workers assets
// validation rejects ("legacy pages worker asset"). Zero dependencies: Node's
// fs.cpSync with a filter. The canonical deploy target is Pages (see the root
// wrangler.toml); this exists only so `npm run deploy:worker-legacy` keeps
// working against the old workers.dev subdomain without the two targets
// fighting over the same directory.
import { cpSync, rmSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'web');
const out = join(root, 'dist', 'worker-web');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(src, out, {
  recursive: true,
  filter: (source) => !source.replaceAll('\\', '/').endsWith('web/_worker.js'),
});

console.log(`built ${out} (web/ minus _worker.js)`);
