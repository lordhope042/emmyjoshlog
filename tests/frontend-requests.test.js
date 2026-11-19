'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

async function client(fetchImpl, sharedStorage = new Map()) {
  global.window = { EMMYJOSH_CONFIG: { apiBase: '/api/v1' }, location: { origin: 'http://localhost:3000' } };
  global.localStorage = {
    getItem: key => sharedStorage.get(key) ?? null,
    setItem: (key, value) => sharedStorage.set(key, value),
    removeItem: key => sharedStorage.delete(key),
  };
  global.fetch = fetchImpl;
  const source = fs.readFileSync(require.resolve('../js/api.js'), 'utf8').replace("import { beginLoading } from './loading.js';", 'const beginLoading = () => () => {};');
  return import('data:text/javascript;base64,' + Buffer.from(source + `\n// ${Math.random()}`).toString('base64'));
}
function response(status, body) { return { ok: status >= 200 && status < 300, status, json: async () => body }; }

test('uncertain checkout retries the same key; confirmed complete purchase allows a distinct next intent', async () => {
  const keys = []; let first = true; const created = new Map();
  const { api } = await client(async (url, options) => {
    if (url.endsWith('/auth/csrf')) return response(200, { csrfToken: 'synthetic-csrf' });
    const key = options.headers.get('Idempotency-Key'); keys.push(key);
    if (!created.has(key)) created.set(key, { id: `order-${created.size}`, status: 'COMPLETED' });
    if (first) { first = false; throw new Error('response lost after server commit'); }
    return response(200, { order: created.get(key) });
  });
  await assert.rejects(() => api.createOrder('ejl_product', 1, '1250'), error => error.code === 'NETWORK_ERROR');
  const replay = await api.createOrder('ejl_product', 1, '1250');
  assert.equal(replay.order.id, 'order-0'); assert.equal(keys[0], keys[1]); assert.equal(created.size, 1);
  await api.createOrder('ejl_product', 1, '1250'); assert.notEqual(keys[1], keys[2]); assert.equal(created.size, 2);
});

test('a lost order response reuses the same idempotency key after page reload and session restoration', async () => {
  const storage = new Map(); const keys = []; const orders = new Map(); let first = true;
  const fetchImpl = async (url, options) => {
    if (url.endsWith('/auth/me')) return response(200, { user: { id: 'customer-1' } });
    if (url.endsWith('/auth/csrf')) return response(200, { csrfToken: 'synthetic-csrf' });
    const key = options.headers.get('Idempotency-Key'); keys.push(key);
    if (!orders.has(key)) orders.set(key, { id: 'committed-on-server', status: 'COMPLETED' });
    if (first) { first = false; throw new Error('connection ended after the server committed'); }
    return response(200, { order: orders.get(key) });
  };
  const firstPage = await client(fetchImpl, storage);
  await firstPage.api.me();
  await assert.rejects(() => firstPage.api.createOrder('ejl_product', 1, '1250'), error => error.code === 'NETWORK_ERROR');

  const reloadedPage = await client(fetchImpl, storage);
  await reloadedPage.api.me();
  const replay = await reloadedPage.api.createOrder('ejl_product', 1, '1250');
  assert.equal(replay.order.id, 'committed-on-server');
  assert.equal(keys[0], keys[1]);
  assert.equal(orders.size, 1);
});

test('pending idempotency keys are scoped to the authenticated customer', async () => {
  const keys = []; let customerId = 'customer-a';
  const { api } = await client(async (url, options) => {
    if (url.endsWith('/auth/csrf')) return response(200, { csrfToken: 'synthetic-csrf' });
    if (url.endsWith('/auth/login')) return response(200, { user: { id: customerId } });
    if (url.endsWith('/orders')) { keys.push(options.headers.get('Idempotency-Key')); return response(200, { order: { id: `pending-${customerId}`, status: 'PENDING' } }); }
    throw new Error(`Unexpected request: ${url}`);
  });
  await api.login({ identifier: 'a@example.invalid', password: 'synthetic-password' });
  await api.createOrder('ejl_product', 1, '1250');
  customerId = 'customer-b';
  await api.login({ identifier: 'b@example.invalid', password: 'synthetic-password' });
  await api.createOrder('ejl_product', 1, '1250');
  assert.notEqual(keys[0], keys[1]);
});

test('a session-expiry 401 invalidates concurrent requests from the expired auth generation', async () => {
  let releaseDashboard; const dashboardStarted = new Promise(resolve => { releaseDashboard = () => resolve(); });
  let finishDashboard;
  const { api } = await client(async url => {
    if (url.endsWith('/dashboard/summary')) return new Promise(resolve => { finishDashboard = () => resolve(response(200, { private: 'old-account-data' })); dashboardStarted.then(() => {}); });
    if (url.endsWith('/wallet')) return response(401, { error: { message: 'Session expired', code: 'SESSION_EXPIRED' } });
    throw new Error(`Unexpected request: ${url}`);
  });
  const staleDashboard = api.dashboard();
  releaseDashboard();
  await assert.rejects(() => api.wallet(), error => error.status === 401);
  finishDashboard();
  await assert.rejects(staleDashboard, error => error.code === 'SESSION_CHANGED');
});

test('checkout fails closed if the browser cannot persist a pending request key', async () => {
  let orderWrites = 0;
  const { api } = await client(async () => { orderWrites += 1; return response(200, { order: { status: 'COMPLETED' } }); });
  global.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() {} };
  assert.throws(() => api.createOrder('item', 1, '100'), error => error.code === 'IDEMPOTENCY_STORAGE_UNAVAILABLE');
  assert.equal(orderWrites, 0);
});

test('generic forbidden writes are not blindly replayed', async () => {
  let writes = 0;
  const { api } = await client(async url => {
    if (url.endsWith('/auth/csrf')) return response(200, { csrfToken: 'csrf' });
    writes++; return response(403, { error: 'No role', code: 'ROLE_DENIED' });
  });
  await assert.rejects(() => api.updateProfile({ fullName: 'Example' }), error => error.status === 403);
  assert.equal(writes, 1);
});

test('a confirmed CSRF rejection refreshes security token once while preserving idempotency key', async () => {
  let writes = 0; const keys = [];
  const { api } = await client(async (url, options) => {
    if (url.endsWith('/auth/csrf')) return response(200, { csrfToken: 'csrf' });
    writes++; keys.push(options.headers.get('Idempotency-Key'));
    return writes === 1 ? response(403, { error: 'Refresh token', code: 'CSRF_INVALID' }) : response(200, { order: { id: 'same', status: 'COMPLETED' } });
  });
  await api.createOrder('item', 1, '100');
  assert.equal(writes, 2); assert.equal(keys[0], keys[1]);
});

test('logout rejects late profile responses from the old account even if transport ignores abort', async () => {
  let release;
  const { api } = await client(async url => {
    if (url.endsWith('/auth/csrf')) return response(200, { csrfToken: 'csrf' });
    if (url.endsWith('/users/me')) return new Promise(resolve => { release = () => resolve(response(200, { user: { email: 'old@example.test' } })); });
    return response(200, { ok: true });
  });
  const profile = api.profile();
  const rejected = assert.rejects(profile, error => error.code === 'SESSION_CHANGED');
  await api.logout(); release(); await rejected;
});

test('an order waiting for CSRF cannot be sent after a new login replaces its session', async () => {
  let releaseOldCsrf; let csrfCalls = 0; let orderWrites = 0;
  const { api } = await client(async url => {
    if (url.endsWith('/auth/csrf')) {
      csrfCalls++;
      if (csrfCalls === 1) return new Promise(resolve => { releaseOldCsrf = () => resolve(response(200, { csrfToken: 'old-account-token' })); });
      return response(200, { csrfToken: 'new-account-token' });
    }
    if (url.endsWith('/auth/login')) return response(200, { user: { id: 'new-account' } });
    if (url.endsWith('/orders')) { orderWrites++; return response(200, { order: { id: 'unexpected' } }); }
    throw new Error('Unexpected endpoint');
  });
  const oldOrder = api.createOrder('private-product', 1, '100');
  const rejected = assert.rejects(oldOrder, error => error.code === 'SESSION_CHANGED');
  await api.login({ identifier: 'new@example.invalid', password: 'synthetic-password' });
  releaseOldCsrf(); await rejected;
  assert.equal(orderWrites, 0); assert.equal(csrfCalls, 2);
});

test('malformed successful API response is not represented as a confirmed purchase', async () => {
  const { api } = await client(async url => url.endsWith('/auth/csrf')
    ? response(200, { csrfToken: 'csrf' })
    : { ok: true, status: 200, json: async () => { throw new Error('truncated'); } });
  await assert.rejects(() => api.createOrder('item', 1, '100'), error => error.code === 'INVALID_RESPONSE');
});
