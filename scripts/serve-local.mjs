import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, resolve, extname, sep } from 'node:path';
import { handle } from '../worker/index.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const webRoot = join(root, 'web');
const port = Number(process.env.PORT ?? 8080);

const API_PATHS = new Set(['/health', '/forecast', '/advisory', '/ussd', '/counties', '/wards', '/county-outlook', '/locate', '/kitchen']);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.geojson': 'application/geo+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

async function runWorker(req, url, body) {
  const request = new Request(`http://localhost:${port}${url.pathname}${url.search}`, {
    method: req.method,
    headers: req.headers,
    body: body && !['GET', 'HEAD'].includes(req.method) ? body : undefined,
  });
  const res = await handle(request);
  return res;
}

function safeStaticPath(pathname) {
  const rel = pathname === '/' ? '/index.html' : pathname;
  const target = resolve(join(webRoot, normalize(rel).replace(/^(\.\.[/\\])+/, '')));
  if (!target.startsWith(webRoot + sep) && target !== join(webRoot, 'index.html')) return null;
  return target;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);

  const body = await new Promise((done) => {
    let buf = '';
    req.on('data', (c) => (buf += c));
    req.on('end', () => done(buf));
  });

  try {
    if (req.method === 'OPTIONS' || API_PATHS.has(url.pathname)) {
      const out = await runWorker(req, url, body);
      res.writeHead(out.status, Object.fromEntries(out.headers));
      res.end(await out.text());
      return;
    }

    const file = safeStaticPath(url.pathname);
    if (!file) {
      res.writeHead(403, { 'content-type': 'text/plain' });
      res.end('forbidden');
      return;
    }

    try {
      const bytes = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream' });
      res.end(bytes);
      return;
    } catch (err) {
      if (err?.code !== 'ENOENT') throw err;
      // No such asset. Fall through to the Worker rather than 404ing here, so a
      // route added to worker/index.mjs cannot silently vanish just because
      // API_PATHS above was not updated in the same change.
    }

    const out = await runWorker(req, url, body);
    res.writeHead(out.status, Object.fromEntries(out.headers));
    res.end(await out.text());
  } catch (err) {
    if (err?.code === 'ENOENT') {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
      return;
    }
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: String(err?.message ?? err) }));
  }
});

server.listen(port, () => {
  console.log(`Msimu local server: http://localhost:${port}`);
  console.log(`  dashboard   http://localhost:${port}/`);
  console.log(`  counties    http://localhost:${port}/counties`);
  console.log(`  wards       http://localhost:${port}/wards?county=kajiado`);
  console.log(`  choropleth  http://localhost:${port}/county-outlook?county=kajiado`);
  console.log(`  api advice  http://localhost:${port}/advisory?ward=kajiado--nkaimurunya&lang=sw`);
  console.log(`  ussd        curl -X POST http://localhost:${port}/ussd -d "text=1&ward=kajiado--nkaimurunya"`);
});
