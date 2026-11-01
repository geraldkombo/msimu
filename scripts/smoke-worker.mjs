import { handle } from '../worker/index.mjs';

const base = 'https://msimu.local';

async function get(path) {
  const res = await handle(new Request(`${base}${path}`));
  return { status: res.status, type: res.headers.get('content-type'), body: await res.text() };
}

async function post(path, form) {
  const res = await handle(new Request(`${base}${path}`, { method: 'POST', body: new URLSearchParams(form).toString() }));
  return { status: res.status, body: await res.text() };
}

const health = await get('/health');
console.log('GET /health ->', health.status, health.type);
console.log(health.body);

const forecast = await get('/forecast?site=gataka');
const months = JSON.parse(forecast.body).months;
console.log('\nGET /forecast ->', forecast.status, '| months:', months.length);
console.log(
  months
    .map((m) => `${m.month} ${String(m.forecast_mm).padStart(4)}mm median=${String(m.median_mm).padStart(4)} ${m.tercile}/${m.confidence} ${m.complete ? '' : 'PARTIAL'}`)
    .join('\n'),
);

const advisory = await get('/advisory?site=gataka&lang=sw');
const parsed = JSON.parse(advisory.body);
console.log('\nGET /advisory ->', advisory.status, '| month:', parsed.month, '| tercile:', parsed.tercile, '| conf:', parsed.confidence);
console.log(parsed.advisory.join('\n'));

const advText = await get('/advisory?site=gataka&lang=en&format=text');
console.log('\nGET /advisory?format=text ->', advText.status);
console.log(advText.body);

for (const t of ['', '1', '2', '3', '9']) {
  const r = await post('/ussd', { sessionId: 'AT-sim', phoneNumber: '+254700000000', text: t, serviceCode: '*384#' });
  console.log(`\nPOST /ussd text=${JSON.stringify(t)} -> ${r.status}`);
  console.log(r.body);
}

const bad = await get('/nope');
console.log('\nGET /nope ->', bad.status, bad.body.trim());
