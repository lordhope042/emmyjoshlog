'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const commerce = require('../backend/commerce/service');

process.env.INVENTORY_ENCRYPTION_KEY_V1 ||= 'commerce-test-secret-that-is-at-least-32-characters-long';

function fixture() {
  return commerce.createMemoryCommerceDb({
    products: [{ id: 'ejl_owned', name: 'Owned logs', priceMinor: 1250, status: 'ACTIVE' }],
    inventory: [
      { id: 'unit-1', productId: 'ejl_owned', delivery: 'opaque-one' },
      { id: 'unit-2', productId: 'ejl_owned', delivery: 'opaque-two' },
    ],
    wallets: { customer: '25.00', other: '0.00' },
  });
}

test('owned checkout uses exact minor units and never oversells', async () => {
  const db = fixture();
  const first = await commerce.createCheckout({ db, userId: 'customer', productId: 'ejl_owned', quantity: 2, expectedUnitPriceMinor: '1250', idempotencyKey: 'checkout-1' });
  assert.equal(first.order.total, '25.00');
  assert.equal(db.__commerceMemory.wallets.get('customer'), '0.00');
  assert.deepEqual([...db.__commerceMemory.inventory.values()].map(unit => unit.status), ['SOLD', 'SOLD']);
  await assert.rejects(() => commerce.createCheckout({ db, userId: 'customer', productId: 'ejl_owned', quantity: 1, expectedUnitPriceMinor: '1250', idempotencyKey: 'checkout-2' }), error => error.code === 'insufficient_stock' || error.code === 'insufficient_balance');
});

test('idempotency replays the original order and rejects a changed request', async () => {
  const db = fixture();
  const input = { db, userId: 'customer', productId: 'ejl_owned', quantity: 1, expectedUnitPriceMinor: '1250', idempotencyKey: 'same-key' };
  const first = await commerce.createCheckout(input);
  const replay = await commerce.createCheckout(input);
  assert.equal(replay.replayed, true);
  assert.equal(replay.order.id, first.order.id);
  await assert.rejects(() => commerce.createCheckout({ ...input, quantity: 2 }), error => error.code === 'idempotency_mismatch');
});

test('delivery is encrypted at rest and owner-only', async () => {
  const db = fixture();
  const result = await commerce.createCheckout({ db, userId: 'customer', productId: 'ejl_owned', quantity: 1, idempotencyKey: 'delivery-key' });
  const metadata = db.__commerceMemory.orderMeta.get(result.order.id);
  assert.equal(Buffer.isBuffer(metadata.deliveryCiphertext), true);
  assert.equal(metadata.deliveryCiphertext.toString('utf8').includes('opaque-one'), false);
  assert.deepEqual((await commerce.getOrderDelivery({ db, orderId: result.order.id, userId: 'customer' })).lines, ['opaque-one']);
  await assert.rejects(() => commerce.getOrderDelivery({ db, orderId: result.order.id, userId: 'other' }), error => error.status === 404);
});

test('external orders claim once, retain uncertain charges, and reject unconfirmed refunds', async () => {
  const db = commerce.createMemoryCommerceDb({ wallets: { customer: '100.00' } });
  const result = await commerce.reserveExternalOrder({ db, userId: 'customer', idempotencyKey: 'external-key', productId: 'number-prod', productName: 'Number', categorySlug: 'virtual-numbers', retailMinor: '2500', costMinor: '1800', currency: 'NGN', provider: '5SIM', source: 'NUMBER', requestPayload: { country: 'NG', service: 'telegram' }, quantity: 1 });
  const replay = await commerce.reserveExternalOrder({ db, userId: 'customer', idempotencyKey: 'external-key', productId: 'number-prod', productName: 'Number', categorySlug: 'virtual-numbers', retailMinor: '2500', costMinor: '1800', currency: 'NGN', provider: '5SIM', source: 'NUMBER', requestPayload: { country: 'NG', service: 'telegram' }, quantity: 1 });
  assert.equal(replay.replayed, true);
  assert.equal((await commerce.claimExternalDispatch(result.order.id, db)).claimed, true);
  assert.equal((await commerce.claimExternalDispatch(result.order.id, db)).claimed, false);
  await commerce.markExternalUncertain(result.order.id, { db, code: 'TIMEOUT' });
  await assert.rejects(() => commerce.refundOrder({ db, orderId: result.order.id, actorId: 'admin' }), error => error.code === 'external_refund_unconfirmed');
});

test('refund is wallet-atomic, linked, replay-safe, and does not resell stock', async () => {
  const db = fixture();
  const result = await commerce.createCheckout({ db, userId: 'customer', productId: 'ejl_owned', quantity: 1, idempotencyKey: 'refund-key' });
  const refunded = await commerce.refundOrder({ db, orderId: result.order.id, actorId: 'admin', reason: 'customer request' });
  assert.equal(refunded.order.status, 'REFUNDED');
  assert.equal(db.__commerceMemory.wallets.get('customer'), '25.00');
  assert.equal(db.__commerceMemory.orderMeta.get(result.order.id).refundReference, `REF-${result.order.id}`);
  assert.equal((await commerce.refundOrder({ db, orderId: result.order.id, actorId: 'admin' })).replayed, true);
  assert.deepEqual([...db.__commerceMemory.inventory.values()].map(unit => unit.status), ['SOLD', 'AVAILABLE']);
});
