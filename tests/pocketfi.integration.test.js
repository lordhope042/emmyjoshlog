'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const http = require('node:http');
const pocketfi = require('../legacy-api/src/services/pocketfi');

function operationDb() {
  const state = { operation: null, account: null, notifications: [], fetchCalls: 0 };
  const db = {
    state,
    async $transaction(callback) { return callback(db); },
    async $executeRawUnsafe(sql, ...params) {
      if (sql.startsWith('INSERT IGNORE')) {
        if (!state.operation) state.operation = { operation_id: params[0], user_id: params[1], state: 'REQUESTED', bank: params[2], request_fingerprint: params[3] };
        return state.operation.operation_id === params[0] ? 1 : 0;
      }
      if (sql.startsWith('UPDATE ej_pocketfi_operations')) {
        const operationId = sql.includes("state = 'DISPATCHED'") ? params[0] : params[3];
        if (state.operation?.operation_id === operationId && (sql.includes("state = 'DISPATCHED'") ? state.operation.state === 'REQUESTED' : true)) {
          state.operation.state = sql.includes("state = 'DISPATCHED'") ? 'DISPATCHED' : params[0];
          state.operation.provider_http_status = sql.includes("state = 'DISPATCHED'") ? null : params[1];
          state.operation.error_code = sql.includes("state = 'DISPATCHED'") ? null : params[2];
          return 1;
        }
        return 0;
      }
      throw new Error(`Unexpected execute SQL: ${sql}`);
    },
    async $queryRawUnsafe(sql, ...params) {
      if (sql.includes('WHERE user_id = ?')) return state.operation && state.operation.user_id === params[0] ? [state.operation] : [];
      if (sql.includes('WHERE operation_id = ?')) return state.operation && state.operation.operation_id === params[0] ? [state.operation] : [];
      throw new Error(`Unexpected query SQL: ${sql}`);
    },
    virtualAccount: {
      async findUnique() { return state.account; },
      async create({ data }) { state.account = { id: 'va_1', ...data }; return state.account; },
    },
    notification: { async create({ data }) { state.notifications.push(data); return data; } },
  };
  return db;
}

function validConfig(extra = {}) {
  return {
    baseUrl: 'https://api.pocketfi.ng/api/test',
    token: 'api-token',
    secretKey: 'webhook-secret',
    businessId: '29492',
    bank: 'kuda',
    enabled: true,
    transferEventsConfirmed: true,
    creditBasis: 'settlement',
    ...extra,
  };
}

test('PocketFi account creation uses the documented exact body and is durable/idempotent', async () => {
  const db = operationDb();
  const calls = [];
  const result = await pocketfi.createDedicatedAccount({
    user: { id: 'user_1', fullName: 'Ibrahim Musa', email: 'ibrahim@example.com', phoneNumber: '09029163518' },
    db,
    config: validConfig(),
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 200, text: async () => JSON.stringify({ status: true, banks: [{ bankName: 'kuda', accountNumber: '7000245206', accountName: 'Ibrahim' }] }) };
    },
  });
  assert.equal(result.accountNumber, '7000245206');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.pocketfi.ng/api/test/virtual-accounts/create');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer api-token');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    first_name: 'Ibrahim', last_name: 'Musa', phone: '09029163518', email: 'ibrahim@example.com', businessId: '29492', bank: 'kuda',
  });
  assert.equal(db.state.operation.state, 'SUCCEEDED');
  assert.deepEqual(await pocketfi.createDedicatedAccount({
    user: { id: 'user_1', fullName: 'Ibrahim Musa', email: 'ibrahim@example.com', phoneNumber: '09029163518' },
    db,
    config: validConfig(),
    fetchImpl: async () => { throw new Error('must not call provider on replay'); },
  }), result);
  assert.equal(db.state.operation.state, 'SUCCEEDED');
});

test('unknown account creation is never blindly retried and Palmpay is fail-closed without KYC', async () => {
  const db = operationDb();
  let calls = 0;
  const args = { user: { id: 'user_2', fullName: 'Ada Lovelace', email: 'ada@example.com', phoneNumber: '09000000000' }, db, config: validConfig(), fetchImpl: async () => { calls += 1; throw new Error('timeout'); } };
  await assert.rejects(() => pocketfi.createDedicatedAccount(args), (error) => error.code === 'POCKETFI_RECONCILIATION_REQUIRED' && error.operationState === 'UNKNOWN');
  await assert.rejects(() => pocketfi.createDedicatedAccount(args), (error) => error.code === 'POCKETFI_RECONCILIATION_REQUIRED');
  assert.equal(calls, 1);
  const palmpayDb = operationDb();
  await assert.rejects(() => pocketfi.createDedicatedAccount({ ...args, db: palmpayDb, config: validConfig({ bank: 'palmpay' }), fetchImpl: async () => { throw new Error('must not call'); } }), (error) => error.code === 'POCKETFI_PALMPAY_KYC_REQUIRED');
  assert.equal(palmpayDb.state.operation, null);
});

test('concurrent account requests serialize before the fake provider call', async () => {
  const db = operationDb();
  let calls = 0;
  const args = {
    user: { id: 'user_concurrent', fullName: 'Grace Hopper', email: 'grace@example.com', phoneNumber: '09000000001' },
    db,
    config: validConfig(),
    fetchImpl: async () => {
      calls += 1;
      return { ok: true, status: 200, text: async () => JSON.stringify({ status: true, banks: [{ bankName: 'kuda', accountNumber: '7000245207', accountName: 'Grace' }] }) };
    },
  };
  const results = await Promise.allSettled([pocketfi.createDedicatedAccount(args), pocketfi.createDedicatedAccount(args)]);
  assert.equal(calls, 1);
  assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(results.filter((item) => item.status === 'rejected')[0].reason.code, 'POCKETFI_RECONCILIATION_REQUIRED');
  assert.equal(db.state.operation.state, 'SUCCEEDED');
});

test('signature verification is mandatory, SHA-512 hex length is enforced, and decimal money is exact', () => {
  const raw = Buffer.from('{"order":{"amount":"100.00"}}');
  const signature = crypto.createHmac('sha512', 'webhook-secret').update(raw).digest('hex');
  assert.equal(signature.length, 128);
  assert.equal(pocketfi.verifyWebhookSignature(raw, signature, validConfig()), true);
  assert.equal(pocketfi.verifyWebhookSignature(raw, `${signature.slice(0, -1)}0`, validConfig()), false);
  assert.equal(pocketfi.verifyWebhookSignature(raw, signature.slice(0, 127), validConfig()), false);
  assert.equal(pocketfi.verifyWebhookSignature(raw, signature, validConfig({ secretKey: 'wrong' })), false);
  assert.equal(pocketfi.decimalToMinor('99.10'), 9910n);
  assert.equal(pocketfi.decimalToMinor(99.1), 9910n);
  assert.equal(pocketfi.minorToDecimal(9910n), '99.10');
  assert.throws(() => pocketfi.decimalToMinor('99.101'));
});

function fakeWebhookDb({ failCredit = false } = {}) {
  const state = { events: new Map(), payments: new Map(), wallet: { id: 'wallet_1', userId: 'user_1', currency: 'NGN', balance: '0.00' }, ledger: [], notifications: [], va: { userId: 'user_1', provider: 'pocketfi', accountNumber: '7000245206', bankName: 'kuda', currency: 'NGN', status: 'ACTIVE' } };
  state.failCredit = failCredit;
  function adapter() {
    return {
      state,
      webhookEvent: {
        async create({ data }) {
          if (state.events.has(data.eventId)) { const error = new Error('duplicate'); error.code = 'P2002'; throw error; }
          const event = { id: data.eventId, ...data };
          state.events.set(data.eventId, event);
          return event;
        },
        async findUnique({ where }) { return state.events.get(where.eventId) || null; },
        async update({ where, data }) { const event = state.events.get(where.eventId); Object.assign(event, data); return event; },
      },
      virtualAccount: { async findFirst() { return state.va; } },
      payment: {
        async findUnique({ where }) { return state.payments.get(where.providerReference) || null; },
        async create({ data }) {
          if (state.payments.has(data.providerReference)) { const error = new Error('duplicate'); error.code = 'P2002'; throw error; }
          const payment = { id: data.providerReference, ...data };
          state.payments.set(data.providerReference, payment);
          return payment;
        },
      },
      wallet: {
        async findUnique() { return state.wallet; },
        async update({ data }) {
          if (state.failCredit) throw new Error('synthetic wallet failure');
          const cents = pocketfi.decimalToMinor(state.wallet.balance, { allowZero: true })
            + pocketfi.decimalToMinor(data.balance.increment, { allowZero: true });
          state.wallet.balance = pocketfi.minorToDecimal(cents);
          return state.wallet;
        },
      },
      walletTransaction: { async create({ data }) { state.ledger.push(data); return data; } },
      notification: { async create({ data }) { state.notifications.push(data); return data; } },
      async $transaction(callback) {
        const snapshot = structuredClone({ payments: state.payments, wallet: state.wallet, ledger: state.ledger, notifications: state.notifications });
        try { return await callback(adapter()); }
        catch (error) { Object.assign(state, snapshot); throw error; }
      },
    };
  }
  return adapter();
}

function request(app, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const raw = Buffer.from(body);
      const req = http.request({ hostname: '127.0.0.1', port: address.port, path: '/pocketfi', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': raw.length, ...headers } }, (res) => {
        let text = '';
        res.on('data', (chunk) => { text += chunk; });
        res.on('end', () => { server.close(); resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null }); });
      });
      req.on('error', (error) => { server.close(); reject(error); });
      req.end(raw);
    });
  });
}

async function withWebhookRouter(fakeDb, config, callback) {
  const previous = { ...process.env };
  Object.assign(process.env, {
    POCKETFI_SECRET_KEY: config.secretKey,
    POCKETFI_BUSINESS_ID: config.businessId,
    POCKETFI_ENABLED: String(config.enabled),
    POCKETFI_TRANSFER_EVENTS_CONFIRMED: String(config.transferEventsConfirmed),
    POCKETFI_CREDIT_BASIS: config.creditBasis,
  });
  const dbPath = require.resolve('../legacy-api/src/db');
  const routePath = require.resolve('../legacy-api/src/routes/webhooks');
  const oldDb = require.cache[dbPath];
  const oldRoute = require.cache[routePath];
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakeDb };
  delete require.cache[routePath];
  try {
    const app = express();
    app.use(require(routePath));
    return await callback(app);
  } finally {
    if (oldDb) require.cache[dbPath] = oldDb; else delete require.cache[dbPath];
    if (oldRoute) require.cache[routePath] = oldRoute; else delete require.cache[routePath];
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
}

test('signed confirmed webhook credits settlement exactly, replays as PROCESSED, and detects changed-reference details', async () => {
  const db = fakeWebhookDb();
  const config = validConfig({ creditBasis: 'settlement' });
  const payload = JSON.stringify({ order: { amount: '100.00', settlement_amount: 99.10, fee: 0.90 }, transaction: { reference: 'PFI|REF-1' }, account_number: '7000245206', customer: { businessId: '29492', first_name: 'Demo', email: 'masked@example.test' } });
  const signature = crypto.createHmac('sha512', config.secretKey).update(payload).digest('hex');
  await withWebhookRouter(db, config, async (app) => {
    const first = await request(app, payload, { http_pocketfi_signature: signature });
    assert.equal(first.status, 200);
    assert.equal(first.body.credited, true);
    assert.equal(first.body.amount, '99.10');
    assert.equal(db.state.wallet.balance, '99.10');
    assert.equal(db.state.ledger.length, 1);
    const replay = await request(app, payload, { http_pocketfi_signature: signature });
    assert.equal(replay.status, 200);
    assert.equal(replay.body.duplicate, true);
    assert.equal(db.state.wallet.balance, '99.10');

    const changed = JSON.stringify({ order: { amount: '101.00', settlement_amount: 100.10, fee: 0.90 }, transaction: { reference: 'PFI|REF-1' }, account_number: '7000245206', customer: { businessId: '29492' } });
    const changedSig = crypto.createHmac('sha512', config.secretKey).update(changed).digest('hex');
    const conflict = await request(app, changed, { http_pocketfi_signature: changedSig });
    assert.equal(conflict.status, 200);
    assert.equal(conflict.body.reconciliationRequired, true);
    assert.equal(db.state.wallet.balance, '99.10');

    const mismatch = JSON.stringify({ order: { amount: '5.00', settlement_amount: 5.00, fee: 0.00 }, transaction: { reference: 'PFI|REF-BUSINESS' }, account_number: '7000245206', customer: { businessId: 'wrong-business' } });
    const mismatchSig = crypto.createHmac('sha512', config.secretKey).update(mismatch).digest('hex');
    const mismatchResponse = await request(app, mismatch, { http_pocketfi_signature: mismatchSig });
    assert.equal(mismatchResponse.status, 200);
    assert.equal(mismatchResponse.body.reconciliationRequired, true);
    assert.equal(db.state.wallet.balance, '99.10');
  });
});

test('tampered and unconfirmed signed payloads are retained without credit; rollback is FAILED and retryable', async () => {
  const payload = JSON.stringify({ order: { amount: '10.00', settlement_amount: 9.50, fee: 0.50 }, transaction: { reference: 'PFI|REF-2' }, account_number: '7000245206', customer: { businessId: '29492' } });
  const config = validConfig({ transferEventsConfirmed: false });
  const db = fakeWebhookDb();
  const signature = crypto.createHmac('sha512', config.secretKey).update(payload).digest('hex');
  await withWebhookRouter(db, config, async (app) => {
    const tampered = await request(app, `${payload} `, { http_pocketfi_signature: signature });
    assert.equal(tampered.status, 400);
    assert.equal(db.state.events.size, 0);
    const retained = await request(app, payload, { http_pocketfi_signature: signature });
    assert.equal(retained.status, 200);
    assert.equal(retained.body.credited, false);
    assert.equal(db.state.wallet.balance, '0.00');
    assert.equal([...db.state.events.values()][0].status, 'RECONCILIATION');
  });

  const failingDb = fakeWebhookDb({ failCredit: true });
  const confirmed = validConfig({ transferEventsConfirmed: true });
  await withWebhookRouter(failingDb, confirmed, async (app) => {
    const sig = crypto.createHmac('sha512', confirmed.secretKey).update(payload).digest('hex');
    const failed = await request(app, payload, { http_pocketfi_signature: sig });
    assert.equal(failed.status, 500);
    assert.equal([...failingDb.state.events.values()][0].status, 'FAILED');
    assert.equal(failingDb.state.ledger.length, 0);
    assert.equal(failingDb.state.payments.size, 0);
    assert.equal(failingDb.state.wallet.balance, '0.00');
    failingDb.state.failCredit = false;
    const retry = await request(app, payload, { http_pocketfi_signature: sig });
    assert.equal(retry.status, 200);
    assert.equal(retry.body.credited, true);
    assert.equal(failingDb.state.wallet.balance, '9.50');
    assert.equal(failingDb.state.ledger.length, 1);
    assert.equal([...failingDb.state.events.values()][0].status, 'PROCESSED');
  });
});
