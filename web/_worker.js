// Cloudflare Pages advanced-mode entry (canonical URL: https://msimu.pages.dev).
//
// One behaviour, three hosts: this file mirrors what the Workers build and
// scripts/serve-local.mjs do, so the dashboard cannot behave differently per
// deploy target. The split is explicit because it has to be: measured on the
// live Pages deployment on 5 Nov 2026, env.ASSETS.fetch answers EVERY unmatched
// path with the index.html SPA fallback (200, text/html, never 404), so both
// naive strategies break: "try the asset first" would serve dashboard HTML for
// every API GET, and trusting asset.status would serve 120 KB of HTML for a
// missing .css/.js/.json. The rules that survive that behaviour:
//   - '/' and paths whose last segment carries a file extension (.css, .js,
//     .json, .geojson, .png, ...) are asset candidates;
//   - an asset candidate whose answer comes back text/html on a path that is
//     neither '/' nor '/index.html' is the SPA fallback in disguise, i.e. a
//     miss: fall through to the handler's JSON 404 with the route list;
//   - every other path is an API route and goes straight to the shared
//     handler, so a route added to worker/index.mjs can never vanish here;
//   - POST/PUT/... always go to the handler (assets only answer GET/HEAD).
import { handle } from '../worker/index.mjs';

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET,POST,OPTIONS',
          'access-control-allow-headers': 'content-type',
        },
      });
    }
    const { pathname } = new URL(request.url);
    const isFile = pathname === '/' || /\.[^./\\]+$/.test(pathname);
    if (isFile && (request.method === 'GET' || request.method === 'HEAD')) {
      const asset = await env.ASSETS.fetch(request);
      const ct = String(asset.headers.get('content-type') ?? '');
      const htmlMiss = ct.includes('text/html') && pathname !== '/' && pathname !== '/index.html';
      if (asset.status !== 404 && !htmlMiss) return asset;
    }
    return handle(request, env);
  },
};
