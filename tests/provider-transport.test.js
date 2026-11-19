'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { request, ProviderTransportError } = require('../backend/providers/transport');
const { config } = require('../backend/providers/config');
const { ceilProviderToMinor, retailFromMarkup } = require('../backend/providers/money');
const { create5SimAdapter } = require('../backend/providers/fivesim');
const { createSMSBowerAdapter } = require('../backend/providers/smsbower');

function response(body, status = 200, contentType = 'application/json') {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  return { status, body: { getReader: undefined }, text: async () => raw, headers: new Map([['content-type', contentType]]) };
}

test('transport bounds responses and redacts authorization/query material', async () => {
  const result = await request({ url: 'https://example.test/path?api_key=secret', headers: { Authorization: 'Bearer secret' }, fetchImpl: async () => response({ ok: true }) });
  assert.deepEqual(result.body, { ok: true });
  assert.equal(result.redacted.url, 'https://example.test/path');
  assert.equal(result.redacted.headers.Authorization, '[redacted]');
});

test('transport marks mutating timeout as unknown outcome', async () => {
  await assert.rejects(() => request({ method: 'POST', url: 'https://example.test/orders', timeoutMs: 100, fetchImpl: async (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))) }), (error) => error instanceof ProviderTransportError && error.code === 'provider_timeout' && error.unknownOutcome);
});

test('provider money conversion is integer and ceiling based', () => {
  assert.equal(ceilProviderToMinor('0.12', '1500'), 18000n);
  assert.equal(ceilProviderToMinor('0.123', '1500.25'), 18454n);
  assert.equal(retailFromMarkup(10000n, { mode: 'PERCENT', value: '12.50' }), 11250n);
  assert.equal(retailFromMarkup(10000n, { mode: 'FIXED', value: '10.00' }), 11000n);
});

test('5SIM uses guest catalogs and Bearer protected GET lifecycle', async () => {
  const calls = [];
  const adapter = create5SimAdapter({ envConfig: { base: 'https://5sim.net', token: 'five-secret' }, fetchImpl: async (url, init) => {
    calls.push({ url, init });
    if (url.includes('/countries')) return response({ england: { iso: 'GB', text_en: 'England' } });
    if (url.includes('/prices')) return response({ england: { facebook: { vodafone: { cost: 2, count: 3 } } } });
    return response({ id: 22, phone: '+1', status: 'PENDING' });
  } });
  const catalog = await adapter.catalog({ country: 'england', service: 'facebook' });
  assert.equal(catalog.quotes[0].operator, 'vodafone');
  await adapter.buy({ country: 'england', operator: 'vodafone', service: 'facebook' });
  assert.match(calls.at(-1).init.headers.Authorization, /^Bearer /);
  assert.equal(calls.at(-1).init.method, 'GET');
});

test('SMSBower uses form POST so api_key is absent from the URL', async () => {
  const calls = [];
  const adapter = createSMSBowerAdapter({ envConfig: { base: 'https://smsbower.page/stubs/handler_api.php', token: 'sms-secret' }, fetchImpl: async (url, init) => {
    calls.push({ url, init });
    const body = String(init.body);
    if (body.includes('getServicesList')) return response({ status: 'success', services: [{ code: 'wa', name: 'WhatsApp' }] });
    if (body.includes('getCountries')) return response([{ id: 1, eng: 'USA' }]);
    if (body.includes('getPrices')) return response({ USA: { wa: { cost: 2, count: 1 } } });
    return response('ACCESS_NUMBER:abc:1555', 200, 'text/plain');
  } });
  const catalog = await adapter.catalog({ country: '1', service: 'wa' });
  assert.equal(catalog.quotes[0].service, 'wa');
  assert.equal(new URL(calls[0].url).search, '');
  assert.match(String(calls[0].init.body), /api_key=sms-secret/);
  assert.equal(calls[0].init.method, 'POST');
});

test('provider configuration never invents currency/rate and defaults purchases off', () => {
  const value = config({ PROVIDER1_ENABLED: '1', PROVIDER1_5SIM_API_TOKEN: 'token', PROVIDER1_CURRENCY: 'NGN', PROVIDER1_NGN_RATE: '1500', PROVIDER1_RETAIL_MODE: 'FIXED', PROVIDER1_RETAIL_MARKUP: '1.00' });
  assert.equal(value.providers[1].ready, true);
  assert.equal(value.providers[1].purchasesEnabled, false);
  assert.equal(config({ PROVIDER1_ENABLED: '1', PROVIDER1_5SIM_API_TOKEN: 'token', PROVIDER1_RETAIL_MODE: 'FIXED', PROVIDER1_RETAIL_MARKUP: '1.00' }).providers[1].ready, false);
});
