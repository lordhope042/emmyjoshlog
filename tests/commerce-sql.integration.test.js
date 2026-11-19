'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createPool } = require('../backend/db');
const commerce = require('../backend/commerce/service');

process.env.INVENTORY_ENCRYPTION_KEY_V1 ||= 'commerce-sql-test-secret-that-is-at-least-32-characters-long';
const TEST_URL = process.env.TEST_DATABASE_URL;
const EXACT_TEST_URL = 'mysql://root@127.0.0.1:3308/emmyjosh_financial_test';
if (TEST_URL && TEST_URL !== EXACT_TEST_URL) throw new Error(`TEST_DATABASE_URL must be exactly ${EXACT_TEST_URL}`);
const enabled = TEST_URL === EXACT_TEST_URL;

function uid(prefix) { return `${prefix}_${crypto.randomBytes(8).toString('hex')}`; }
function resultRows(result) { return Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result; }
async function query(db, sql, params = []) { return resultRows(await db.query(sql, params)); }

let pool;
let fixture;

test('SQL commerce uses locked legacy allocation, global idempotency, and rollback', { skip: !enabled }, async () => {
  pool = createPool({ url: TEST_URL, overrides: { connectionLimit: 8 } });
  await query(pool, 'SELECT 1');
  fixture = { userIds: [], productIds: [], inventoryIds: [], categoryId: uid('cat') };
  const category = fixture.categoryId;
  await query(pool, 'INSERT INTO ProductCategory (id,name,slug,description,status) VALUES (?,?,?,?,?)', [category, `SQL Logs ${category}`, `sql-logs-${category}`, 'test', 'ACTIVE']);

  const createCustomer = async (balance) => {
    const userId = uid('usr'); const walletId = uid('wal');
    await query(pool, 'INSERT INTO `User` (id,fullName,email,phoneNumber,passwordHash,role,status,updatedAt) VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP(3))', [userId, 'SQL Commerce Test', `${userId}@example.invalid`, `+234${String(Math.abs(Date.now())).slice(-9)}${fixture.userIds.length}`, 'not-used', 'CUSTOMER', 'ACTIVE']);
    await query(pool, 'INSERT INTO Wallet (id,userId,currency,balance,updatedAt) VALUES (?,?,?,?,CURRENT_TIMESTAMP(3))', [walletId, userId, 'NGN', balance]);
    fixture.userIds.push(userId); return userId;
  };
  const productId = uid('prod'); fixture.productIds.push(productId);
  await query(pool, 'INSERT INTO Product (id,categoryId,name,slug,description,price,currency,status,updatedAt) VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP(3))', [productId, category, 'SQL Legacy Log', `sql-product-${productId}`, 'test', '10.00', 'NGN', 'ACTIVE']);
  const addUnit = async (targetProductId, reference) => { const inventoryId = uid('inv'); fixture.inventoryIds.push(inventoryId); await query(pool, 'INSERT INTO ProductInventory (id,productId,stockReference,status) VALUES (?,?,?,?)', [inventoryId, targetProductId, reference, 'AVAILABLE']); return inventoryId; };
  await addUnit(productId, 'legacy-last-unit');
  const firstUser = await createCustomer('10.00'); const secondUser = await createCustomer('10.00');
  const attempts = await Promise.allSettled([
    commerce.createCheckout({ db: pool, userId: firstUser, productId, quantity: 1, idempotencyKey: uid('checkout') }),
    commerce.createCheckout({ db: pool, userId: secondUser, productId, quantity: 1, idempotencyKey: uid('checkout') }),
  ]);
  assert.equal(attempts.filter(x => x.status === 'fulfilled').length, 1, 'exactly one wallet may buy the last unit');
  assert.equal(attempts.filter(x => x.status === 'rejected' && x.reason.code === 'insufficient_stock').length, 1);

  const replayProduct = uid('prod'); fixture.productIds.push(replayProduct); await query(pool, 'INSERT INTO Product (id,categoryId,name,slug,description,price,currency,status,updatedAt) VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP(3))', [replayProduct, category, 'SQL Replay Log', `sql-replay-${replayProduct}`, 'test', '1.00', 'NGN', 'ACTIVE']); await addUnit(replayProduct, 'unused-unit');
  const replayUser = await createCustomer('5.00'); const sameKey = uid('same');
  const replayAttempts = await Promise.all([
    commerce.createCheckout({ db: pool, userId: replayUser, productId: replayProduct, quantity: 1, idempotencyKey: sameKey }),
    commerce.createCheckout({ db: pool, userId: replayUser, productId: replayProduct, quantity: 1, idempotencyKey: sameKey }),
  ]);
  assert.equal(new Set(replayAttempts.map(x => x.order.id)).size, 1);
  assert.equal(replayAttempts.filter(x => x.replayed).length, 1);

  const declinedProduct = uid('prod'); fixture.productIds.push(declinedProduct); await query(pool, 'INSERT INTO Product (id,categoryId,name,slug,description,price,currency,status,updatedAt) VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP(3))', [declinedProduct, category, 'SQL Declined Log', `sql-declined-${declinedProduct}`, 'test', '9.00', 'NGN', 'ACTIVE']); const declinedUnit = await addUnit(declinedProduct, 'must-remain-available'); const poorUser = await createCustomer('0.00');
  await assert.rejects(() => commerce.createCheckout({ db: pool, userId: poorUser, productId: declinedProduct, quantity: 1, idempotencyKey: uid('poor') }), error => error.code === 'insufficient_balance');
  const afterDecline = (await query(pool, 'SELECT status FROM ProductInventory WHERE id=?', [declinedUnit]))[0]; assert.equal(afterDecline.status, 'AVAILABLE');

  const refundProduct = uid('prod'); fixture.productIds.push(refundProduct);
  await query(pool, 'INSERT INTO Product (id,categoryId,name,slug,description,price,currency,status,updatedAt) VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP(3))', [refundProduct, category, 'SQL Refund Log', `sql-refund-${refundProduct}`, 'test', '2.25', 'NGN', 'ACTIVE']);
  const revealedUnit = await addUnit(refundProduct, 'disable-after-refund'); const refundUser = await createCustomer('5.00');
  const purchased = await commerce.createCheckout({ db: pool, userId: refundUser, productId: refundProduct, quantity: 1, idempotencyKey: uid('refund') });
  const afterPurchase = (await query(pool, 'SELECT balance FROM Wallet WHERE userId=?', [refundUser]))[0]; assert.equal(String(afterPurchase.balance), '2.75');
  const refundInput = { db: pool, orderId: purchased.order.id, actorId: 'admin-sql-test', reason: 'Isolated refund test' };
  const firstRefund = await commerce.refundOrder(refundInput); assert.equal(firstRefund.order.status, 'REFUNDED'); assert.equal(firstRefund.replayed, false);
  const secondRefund = await commerce.refundOrder(refundInput); assert.equal(secondRefund.replayed, true);
  const afterRefund = (await query(pool, 'SELECT balance FROM Wallet WHERE userId=?', [refundUser]))[0]; assert.equal(String(afterRefund.balance), '5.00');
  const refundLedger = await query(pool, "SELECT amount,status FROM WalletTransaction WHERE userId=? AND type='REFUND'", [refundUser]); assert.equal(refundLedger.length, 1); assert.equal(String(refundLedger[0].amount), '2.25');
  const quarantined = (await query(pool, 'SELECT status FROM ProductInventory WHERE id=?', [revealedUnit]))[0]; assert.equal(quarantined.status, 'DISABLED');
});

test.after(async () => {
  if (!pool) return;
  if (fixture) {
    // The disposable database is isolated, but delete only rows created by this test.
    for (const id of fixture.inventoryIds || []) await query(pool, 'DELETE FROM ProductInventory WHERE id=?', [id]);
    for (const id of fixture.productIds || []) { await query(pool, 'DELETE FROM OrderItem WHERE productId=?', [id]); await query(pool, 'DELETE FROM Product WHERE id=?', [id]); }
    for (const id of fixture.userIds || []) { await query(pool, 'DELETE FROM WalletTransaction WHERE userId=?', [id]); await query(pool, 'DELETE FROM Wallet WHERE userId=?', [id]); await query(pool, 'DELETE FROM `Order` WHERE userId=?', [id]); await query(pool, 'DELETE FROM `User` WHERE id=?', [id]); }
    await query(pool, 'DELETE FROM ProductCategory WHERE id=?', [fixture.categoryId]);
  }
  await pool.end();
});
