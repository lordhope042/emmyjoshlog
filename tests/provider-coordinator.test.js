'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { adminRetail, buildDonQuotes, dispatchLogs } = require('../backend/providers/router');
const { create5SimAdapter } = require('../backend/providers/fivesim');
const { createSMSBowerAdapter } = require('../backend/providers/smsbower');

function response(body, status = 200) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  return { status, body: { getReader: undefined }, text: async () => raw, headers: new Map() };
}
function dbFixture({ status = 'ACTIVE', rule = true } = {}) {
  return {
    async query(sql) {
      if (/FROM ej_admin_products/.test(sql)) return [[{ id: 'ejp_don', platform: 'Instagram', status, acquisition_cost_minor: '100', supplier_product_id: '42' }]];
      if (/FROM ej_admin_pricing_rules/.test(sql)) return [rule ? [{ id: 'rule_1', scope: 'PRODUCT', scope_key: 'ejp_don', mode: 'FIXED', value: '0.20', version: 3 }] : []];
      return [{ affectedRows: 1 }];
    },
  };
}

const env = {
  DONMARKETPLACE_ENABLED: '1', DONMARKETPLACE_PURCHASES_ENABLED: '1', DONMARKETPLACE_DELIVERY_CONTRACT_CONFIRMED: '1',
  DONMARKETPLACE_MODE: 'sandbox', DONMARKETPLACE_API_KEY: 'don-test',
};

test('Don pricing fails closed for unmapped or DRAFT supplier products', async () => {
  assert.equal(await adminRetail(dbFixture({ status: 'DRAFT' }), '42', 'Instagram', '100'), null);
  assert.equal(await adminRetail(dbFixture({ status: 'ACTIVE', rule: false }), '42', 'Instagram', '100'), null);
  const quotes = await buildDonQuotes(dbFixture({ status: 'DRAFT' }), 'customer', { catalog: async () => ({ products: [{ id: 42, name: 'Draft', price_minor: '100', stock: 4, min_qty: 1, max_qty: 4 }] }) });
  assert.deepEqual(quotes, []);
});

test('logs dispatch reserves unit retail price and sends supplier cost cap', async () => {
  const calls = { reserve: [], buy: 0, complete: 0 };
  const commerce = {
    async reserveExternalOrder(args) { calls.reserve.push(args); return { order: { id: 'ord_logs', total: '3.60', status: 'PROCESSING' }, record: { orderId: 'ord_logs', state: 'RESERVED', supplierKey: 'idem-logs', source: 'DONMARKETPLACE' } }; },
    async claimExternalDispatch() { return { claimed: true, record: { orderId: 'ord_logs', state: 'DISPATCHED', supplierKey: 'idem-logs', source: 'DONMARKETPLACE' } }; },
    async completeExternalOrder() { calls.complete += 1; return { order: { id: 'ord_logs', total: '3.60', status: 'COMPLETED' } }; },
    async markExternalUncertain() { throw new Error('unexpected uncertain state'); },
  };
  const adapters = { don: {
    async catalog() { return { products: [{ id: '42', name: 'Logs', price_minor: '100', stock: 8, min_qty: 1, max_qty: 8, category: 'Instagram' }] }; },
    async placeOrder(args) { calls.buy += 1; assert.deepEqual(args, { productId: '42', quantity: 3, idempotencyKey: 'idem-logs', maxPrice: '100' }); return { number: 'MC12345', status: 'completed', delivery: { lines: ['a', 'b', 'c'] } }; },
  } };
  const result = await dispatchLogs({
    req: { user: { id: 'customer' }, get(name) { assert.equal(name, 'Idempotency-Key'); return 'idem-logs'; } },
    db: dbFixture(), options: { commerce }, cfg: { don: { enabled: true, purchasesEnabled: true }, providers: {} }, adapters,
    quote: { quoteId: 'eq_logs', productId: 'donmarketplace:42', retailMinor: '120', costMinor: '100', selection: { supplierProductId: '42', name: 'Logs', minQty: 1, maxQty: 8 } }, quantity: 3,
  });
  assert.equal(result.status, 201);
  assert.equal(calls.reserve[0].retailMinor, '120');
  assert.equal(calls.reserve[0].quantity, 3);
  assert.equal(calls.buy, 1);
  assert.equal(calls.complete, 1);
});

test('DISPATCHED replay with known Don reference recovers delivery without another buy', async () => {
  let buys = 0; let recovered = 0;
  const commerce = {
    async reserveExternalOrder() { return { order: { id: 'ord_replay', total: '3.60' }, replayed: true, record: { orderId: 'ord_replay', state: 'DISPATCHED', providerRef: 'MC12345', source: 'DONMARKETPLACE' } }; },
    async claimExternalDispatch() { return { claimed: false, record: { orderId: 'ord_replay', state: 'DISPATCHED', providerRef: 'MC12345', source: 'DONMARKETPLACE', quantity: 3 } }; },
    async completeExternalOrder() { recovered += 1; return { order: { id: 'ord_replay', status: 'COMPLETED', total: '3.60' } }; },
    async markExternalUncertain() { throw new Error('unexpected uncertain state'); },
  };
  const adapters = { don: {
    async catalog() { return { products: [{ id: '42', name: 'Logs', price_minor: '100', stock: 8, min_qty: 1, max_qty: 8, category: 'Instagram' }] }; },
    async getOrder(ref) { assert.equal(ref, 'MC12345'); return { number: ref, status: 'completed', delivery: { lines: ['a', 'b', 'c'] } }; },
    async placeOrder() { buys += 1; throw new Error('must not buy on replay'); },
  } };
  const result = await dispatchLogs({
    req: { user: { id: 'customer' }, get() { return 'idem-replay'; } }, db: dbFixture(), options: { commerce },
    cfg: { don: { enabled: true, purchasesEnabled: true }, providers: {} }, adapters,
    quote: { quoteId: 'eq_logs', productId: 'donmarketplace:42', retailMinor: '120', costMinor: '100', selection: { supplierProductId: '42', name: 'Logs', minQty: 1, maxQty: 8 } }, quantity: 3,
  });
  assert.equal(result.status, 201);
  assert.equal(buys, 0);
  assert.equal(recovered, 1);
});

test('number adapters transmit provider max-price caps', async () => {
  const fiveCalls = [];
  const five = create5SimAdapter({ envConfig: { base: 'https://5sim.net', token: 'secret' }, fetchImpl: async (url, init) => { fiveCalls.push({ url, init }); return response({ id: 1, phone: '+1' }); } });
  await five.buy({ country: 'us', operator: 'any', service: 'telegram', maxPrice: '2.50' });
  assert.match(fiveCalls[0].url, /maxPrice=2.50/);
  const smsCalls = [];
  const sms = createSMSBowerAdapter({ envConfig: { base: 'https://smsbower.page/stubs/handler_api.php', token: 'secret' }, fetchImpl: async (url, init) => { smsCalls.push({ url, init }); return response({ id: 'x' }); } });
  await sms.buy({ country: '1', service: 'wa', maxPrice: '2.50' });
  assert.match(String(smsCalls[0].init.body), /max_price=2.50/);
});

module.exports = { dbFixture };
