'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const {
  createAdminRouter,
  csrfToken,
  decryptPayload,
} = require('../backend');
const { hashSessionToken } = require('../backend/crypto');

const encryptionKey = 'synthetic32+testsecret-for-admin-import-http-tests';
const adminOne = {
  id: 'admin-one',
  email: 'admin.one@example.test',
  role: 'ADMIN',
};
const adminTwo = {
  id: 'admin-two',
  email: 'admin.two@example.test',
  role: 'ADMIN',
};
const product = {
  id: 'product-owned-logs',
  name: 'Owned Instagram logs',
  platform: 'Instagram',
  description: '',
  terms: '',
  source: 'OWN',
  status: 'DRAFT',
  acquisition_cost_minor: null,
  min_qty: 1,
  max_qty: 100,
  supplier_product_id: null,
};

function now() {
  return new Date();
}

function cloneValue(value) {
  if (value instanceof Date) return new Date(value.getTime());
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (Array.isArray(value)) return value.map(cloneValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValue(item)]));
  }
  return value;
}

function cloneState(state) {
  return {
    users: new Map([...state.users].map(([key, value]) => [key, cloneValue(value)])),
    sessions: new Map([...state.sessions].map(([key, value]) => [key, cloneValue(value)])),
    products: new Map([...state.products].map(([key, value]) => [key, cloneValue(value)])),
    imports: new Map([...state.imports].map(([key, value]) => [key, cloneValue(value)])),
    importRows: new Map([...state.importRows].map(([key, value]) => [key, cloneValue(value)])),
    inventory: new Map([...state.inventory].map(([key, value]) => [key, cloneValue(value)])),
    audit: cloneValue(state.audit),
    nextAuditId: state.nextAuditId,
    nextRowId: state.nextRowId,
  };
}

function emptyState() {
  return {
    users: new Map([
      [adminOne.id, { ...adminOne, password_hash: 'not-used-in-session-fixture' }],
      [adminTwo.id, { ...adminTwo, password_hash: 'not-used-in-session-fixture' }],
    ]),
    sessions: new Map(),
    products: new Map([[product.id, { ...product, created_at: now(), updated_at: now() }]]),
    imports: new Map(),
    importRows: new Map(),
    inventory: new Map(),
    audit: [],
    nextAuditId: 1,
    nextRowId: 1,
  };
}

function mysqlResult(rowsOrResult) {
  return [rowsOrResult, undefined];
}

class StrictFakePool {
  constructor() {
    this.state = emptyState();
    this.unknownSql = [];
    this.failInventoryInsertNumber = null;
  }

  addSession(cookie, user, expiresAt = new Date(Date.now() + 60 * 60 * 1000)) {
    const csrf = csrfToken(cookie, encryptionKey);
    this.state.sessions.set(hashSessionToken(cookie), {
      token_hash: hashSessionToken(cookie),
      user_id: user.id,
      csrf_hash: hashSessionToken(csrf),
      expires_at: expiresAt,
      last_seen_at: now(),
    });
    return csrf;
  }

  async query(sql, params = []) {
    return this.execute(this.state, sql, params, null);
  }

  async getConnection() {
    const connection = {
      state: cloneState(this.state),
      inventoryInsertCount: 0,
      begun: false,
      committed: false,
      rolledBack: false,
      beginTransaction: async () => {
        connection.begun = true;
      },
      query: async (sql, params = []) => this.execute(connection.state, sql, params, connection),
      commit: async () => {
        assert.equal(connection.begun, true, 'fake transaction must begin before commit');
        this.state = connection.state;
        connection.committed = true;
      },
      rollback: async () => {
        connection.rolledBack = true;
      },
      release: () => {
        connection.released = true;
      },
    };
    return connection;
  }

  failUnknown(sql) {
    this.unknownSql.push(sql);
    throw new Error(`Unknown SQL in strict fake repository: ${sql}`);
  }

  execute(state, originalSql, params, connection) {
    const sql = originalSql.replace(/\s+/g, ' ').trim();

    if (sql === "SELECT s.token_hash, s.csrf_hash, s.expires_at, u.id, u.email, u.role FROM ej_admin_sessions s JOIN ej_admin_users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > CURRENT_TIMESTAMP(3) AND u.role = 'ADMIN'") {
      const session = state.sessions.get(params[0]);
      if (!session || session.expires_at <= now()) return mysqlResult([]);
      const user = state.users.get(session.user_id);
      if (!user || user.role !== 'ADMIN') return mysqlResult([]);
      return mysqlResult([{ token_hash: session.token_hash, csrf_hash: session.csrf_hash, expires_at: session.expires_at, id: user.id, email: user.email, role: user.role }]);
    }

    if (sql === 'UPDATE ej_admin_sessions SET last_seen_at = CURRENT_TIMESTAMP(3) WHERE token_hash = ?') {
      const session = state.sessions.get(params[0]);
      if (session) session.last_seen_at = now();
      return mysqlResult({ affectedRows: session ? 1 : 0 });
    }

    if (sql === "UPDATE ej_admin_import_rows r JOIN ej_admin_imports i ON i.id = r.import_id SET r.payload_ciphertext = NULL WHERE i.expires_at < CURRENT_TIMESTAMP(3) AND i.status <> 'COMMITTED'") {
      for (const [importId, rows] of state.importRows) {
        const item = state.imports.get(importId);
        if (item && item.status !== 'COMMITTED' && item.expires_at < now()) {
          for (const row of rows) row.payload_ciphertext = null;
        }
      }
      return mysqlResult({ affectedRows: 0 });
    }

    if (sql === "DELETE r FROM ej_admin_import_rows r JOIN ej_admin_imports i ON i.id = r.import_id WHERE i.expires_at < CURRENT_TIMESTAMP(3) AND i.status <> 'COMMITTED'") {
      for (const [importId] of state.importRows) {
        const item = state.imports.get(importId);
        if (item && item.status !== 'COMMITTED' && item.expires_at < now()) state.importRows.delete(importId);
      }
      return mysqlResult({ affectedRows: 0 });
    }

    if (sql === 'SELECT * FROM ej_admin_products WHERE id = ?' || sql === 'SELECT * FROM ej_admin_products WHERE id = ? FOR UPDATE') {
      const item = state.products.get(params[0]);
      return mysqlResult(item ? [cloneValue(item)] : []);
    }

    if (sql === 'SELECT fingerprint_hmac, identity_hmac FROM ej_admin_inventory_units WHERE fingerprint_hmac IN (?) OR identity_hmac IN (?)') {
      const fingerprints = new Set(params[0]);
      const identities = new Set(params[1]);
      return mysqlResult([...state.inventory.values()]
        .filter((item) => fingerprints.has(item.fingerprint_hmac) || identities.has(item.identity_hmac))
        .map((item) => ({ fingerprint_hmac: item.fingerprint_hmac, identity_hmac: item.identity_hmac })));
    }

    if (sql === 'INSERT INTO ej_admin_imports (id, product_id, created_by, status, total_rows, valid_rows, invalid_rows, duplicate_rows, commit_token_hash, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)') {
      const [id, productId, createdBy, status, totalRows, validRows, invalidRows, duplicateRows, tokenHash, expiresAt] = params;
      if (state.imports.has(id) || [...state.imports.values()].some((item) => item.commit_token_hash === tokenHash)) {
        const error = new Error('duplicate import key'); error.code = 'ER_DUP_ENTRY'; throw error;
      }
      state.imports.set(id, {
        id,
        product_id: productId,
        created_by: createdBy,
        status,
        total_rows: totalRows,
        valid_rows: validRows,
        invalid_rows: invalidRows,
        duplicate_rows: duplicateRows,
        added: 0,
        commit_token_hash: tokenHash,
        expires_at: new Date(expiresAt),
        created_at: now(),
      });
      state.importRows.set(id, []);
      return mysqlResult({ affectedRows: 1 });
    }

    if (sql === 'INSERT INTO ej_admin_import_rows (import_id, line_no, status, source_ref, payload_ciphertext, fingerprint_hmac, identity_hmac, diagnostic_code, duplicate_of_line) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)') {
      const [importId, lineNo, status, sourceRef, ciphertext, fingerprint, identity, code, duplicateOfLine] = params;
      const rows = state.importRows.get(importId);
      if (!rows || rows.some((row) => row.line_no === lineNo)) {
        const error = new Error('duplicate import row key'); error.code = 'ER_DUP_ENTRY'; throw error;
      }
      rows.push({
        id: state.nextRowId++,
        import_id: importId,
        line_no: lineNo,
        status,
        source_ref: sourceRef,
        payload_ciphertext: ciphertext == null ? null : Buffer.from(ciphertext),
        fingerprint_hmac: fingerprint,
        identity_hmac: identity,
        diagnostic_code: code,
        duplicate_of_line: duplicateOfLine,
      });
      return mysqlResult({ affectedRows: 1 });
    }

    if (sql === 'INSERT INTO ej_admin_audit_events (action, actor_id, actor_email, target_id, detail_json) VALUES (?, ?, ?, ?, ?)') {
      const [action, actorId, actorEmail, targetId, detailJson] = params;
      state.audit.push({ id: state.nextAuditId++, action, actor_id: actorId, actor_email: actorEmail, target_id: targetId, detail_json: detailJson, created_at: now() });
      return mysqlResult({ affectedRows: 1 });
    }

    if (sql === 'SELECT i.*, p.source, p.status AS product_status FROM ej_admin_imports i JOIN ej_admin_products p ON p.id=i.product_id WHERE i.id=? AND i.commit_token_hash=? AND i.created_by=? FOR UPDATE') {
      const item = state.imports.get(params[0]);
      if (!item || item.commit_token_hash !== params[1] || item.created_by !== params[2]) return mysqlResult([]);
      const ownedProduct = state.products.get(item.product_id);
      return mysqlResult([{ ...cloneValue(item), source: ownedProduct?.source, product_status: ownedProduct?.status }]);
    }

    if (sql === "SELECT * FROM ej_admin_import_rows WHERE import_id=? AND status='NEW' ORDER BY line_no FOR UPDATE") {
      return mysqlResult((state.importRows.get(params[0]) || []).filter((row) => row.status === 'NEW').sort((a, b) => a.line_no - b.line_no).map(cloneValue));
    }

    if (sql === 'SELECT fingerprint_hmac, identity_hmac FROM ej_admin_inventory_units WHERE fingerprint_hmac IN (?) OR identity_hmac IN (?) FOR UPDATE') {
      const fingerprints = new Set(params[0]);
      const identities = new Set(params[1]);
      return mysqlResult([...state.inventory.values()]
        .filter((item) => fingerprints.has(item.fingerprint_hmac) || identities.has(item.identity_hmac))
        .map((item) => ({ fingerprint_hmac: item.fingerprint_hmac, identity_hmac: item.identity_hmac })));
    }

    if (sql === "INSERT INTO ej_admin_inventory_units (id, product_id, status, source_ref, payload_ciphertext, fingerprint_hmac, identity_hmac) VALUES (?, ?, 'AVAILABLE', ?, ?, ?, ?)") {
      if (connection) connection.inventoryInsertCount += 1;
      if (connection && this.failInventoryInsertNumber === connection.inventoryInsertCount) {
        const error = new Error('simulated duplicate on inventory insert'); error.code = 'ER_DUP_ENTRY'; throw error;
      }
      const [id, productId, sourceRef, ciphertext, fingerprint, identity] = params;
      if ([...state.inventory.values()].some((item) => item.fingerprint_hmac === fingerprint || item.identity_hmac === identity)) {
        const error = new Error('duplicate inventory key'); error.code = 'ER_DUP_ENTRY'; throw error;
      }
      state.inventory.set(id, {
        id,
        product_id: productId,
        status: 'AVAILABLE',
        source_ref: sourceRef,
        payload_ciphertext: Buffer.from(ciphertext),
        fingerprint_hmac: fingerprint,
        identity_hmac: identity,
        created_at: now(),
      });
      return mysqlResult({ affectedRows: 1 });
    }

    if (sql === 'UPDATE ej_admin_import_rows SET payload_ciphertext=NULL WHERE import_id=?') {
      for (const row of state.importRows.get(params[0]) || []) row.payload_ciphertext = null;
      return mysqlResult({ affectedRows: 1 });
    }

    if (sql === "UPDATE ej_admin_imports SET status='COMMITTED', added=? WHERE id=?") {
      const item = state.imports.get(params[1]);
      if (item) { item.status = 'COMMITTED'; item.added = params[0]; }
      return mysqlResult({ affectedRows: item ? 1 : 0 });
    }

    this.failUnknown(sql);
  }
}

function cookieHeader(rawCookie) {
  return `ej_admin_session=${rawCookie}`;
}

async function request(baseUrl, rawCookie, csrf, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-EJ-Request': '1',
      'X-Admin-CSRF': csrf,
      cookie: cookieHeader(rawCookie),
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { response, json, text };
}

function jsonl(payload, sourceRef) {
  return JSON.stringify({ payload, ...(sourceRef ? { sourceRef } : {}) });
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  return `http://127.0.0.1:${address.port}/api/admin-tools`;
}

async function close(server) {
  if (!server) return;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test('admin imports work over isolated loopback HTTP with strict SQL and atomic rollback', async () => {
  const previousKey = process.env.INVENTORY_ENCRYPTION_KEY_V1;
  process.env.INVENTORY_ENCRYPTION_KEY_V1 = encryptionKey;

  const fakePool = new StrictFakePool();
  const adminOneCookie = 'fake-session-admin-one';
  const adminTwoCookie = 'fake-session-admin-two';
  const adminOneCsrf = fakePool.addSession(adminOneCookie, adminOne);
  const adminTwoCsrf = fakePool.addSession(adminTwoCookie, adminTwo);
  const app = express();
  app.use('/api/admin-tools', createAdminRouter({ db: fakePool }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}/api/admin-tools`;

  try {
    const originalPayload = {
      username: 'alice',
      password: 'colon:password with spaces',
      recoveryEmail: 'recover@example.test',
    };
    const valid = await request(baseUrl, adminOneCookie, adminOneCsrf, '/imports/validate', {
      productId: product.id,
      format: 'jsonl',
      authorizationConfirmed: true,
      content: jsonl(originalPayload, 'first-row'),
    });
    assert.equal(valid.response.status, 201);
    assert.equal(valid.json.status, 'VALIDATED');
    assert.equal(valid.json.validRows, 1);
    assert.equal(valid.json.canCommit, true);
    assert.deepEqual(valid.json.diagnostics, [{ line: 1, status: 'NEW', code: 'OK' }]);
    assert.doesNotMatch(valid.text, /alice|colon:password|recovery@example|ciphertext|fingerprint|identity_hmac|[a-f0-9]{64}/i);

    const firstImport = fakePool.state.imports.get(valid.json.id);
    assert.ok(firstImport);
    const firstStaged = fakePool.state.importRows.get(valid.json.id);
    assert.equal(firstStaged.length, 1);
    assert.ok(Buffer.isBuffer(firstStaged[0].payload_ciphertext));
    assert.deepEqual(decryptPayload(firstStaged[0].payload_ciphertext, encryptionKey), originalPayload);

    const committed = await request(baseUrl, adminOneCookie, adminOneCsrf, `/imports/${valid.json.id}/commit`, { commitToken: valid.json.commitToken });
    assert.equal(committed.response.status, 200);
    assert.deepEqual(committed.json, { id: valid.json.id, status: 'COMMITTED', added: 1, replayed: false });
    assert.equal(fakePool.state.inventory.size, 1);
    const storedUnit = [...fakePool.state.inventory.values()][0];
    assert.deepEqual(decryptPayload(storedUnit.payload_ciphertext, encryptionKey), originalPayload);
    assert.equal(fakePool.state.importRows.get(valid.json.id)[0].payload_ciphertext, null);

    const replay = await request(baseUrl, adminOneCookie, adminOneCsrf, `/imports/${valid.json.id}/commit`, { commitToken: valid.json.commitToken });
    assert.equal(replay.response.status, 200);
    assert.deepEqual(replay.json, { id: valid.json.id, status: 'COMMITTED', added: 1, replayed: true });
    assert.equal(fakePool.state.inventory.size, 1, 'replay must not create another inventory unit');

    const malformed = await request(baseUrl, adminOneCookie, adminOneCsrf, '/imports/validate', {
      productId: product.id,
      format: 'jsonl',
      authorizationConfirmed: true,
      content: '{not-json}\n',
    });
    assert.equal(malformed.response.status, 201);
    assert.equal(malformed.json.status, 'INVALID');
    assert.equal(malformed.json.canCommit, false);
    assert.equal(malformed.json.invalidRows, 1);
    assert.equal(malformed.json.diagnostics[0].code, 'INVALID_JSON');
    assert.equal(fakePool.state.importRows.get(malformed.json.id)[0].payload_ciphertext, null);

    const changedPassword = await request(baseUrl, adminOneCookie, adminOneCsrf, '/imports/validate', {
      productId: product.id,
      format: 'jsonl',
      authorizationConfirmed: true,
      content: jsonl({ username: 'alice', password: 'a-different-password' }),
    });
    assert.equal(changedPassword.response.status, 201);
    assert.equal(changedPassword.json.status, 'INVALID');
    assert.equal(changedPassword.json.duplicateRows, 1);
    assert.deepEqual(changedPassword.json.diagnostics, [{ line: 1, status: 'DUPLICATE_EXISTING', code: 'DUPLICATE_EXISTING' }]);
    assert.equal(fakePool.state.inventory.size, 1);

    const otherCreatorAttempt = await request(baseUrl, adminTwoCookie, adminTwoCsrf, `/imports/${valid.json.id}/commit`, { commitToken: valid.json.commitToken });
    assert.equal(otherCreatorAttempt.response.status, 404);
    assert.equal(otherCreatorAttempt.json.error.code, 'not_found');
    assert.equal(fakePool.state.inventory.size, 1);

    const expiring = await request(baseUrl, adminOneCookie, adminOneCsrf, '/imports/validate', {
      productId: product.id,
      format: 'jsonl',
      authorizationConfirmed: true,
      content: jsonl({ username: 'expired-user', password: 'expired-password' }),
    });
    assert.equal(expiring.response.status, 201);
    fakePool.state.imports.get(expiring.json.id).expires_at = new Date(Date.now() - 1000);
    const expiredCommit = await request(baseUrl, adminOneCookie, adminOneCsrf, `/imports/${expiring.json.id}/commit`, { commitToken: expiring.json.commitToken });
    assert.equal(expiredCommit.response.status, 409);
    assert.equal(expiredCommit.json.error.code, 'import_not_committable');
    assert.equal(fakePool.state.inventory.size, 1);

    const rollbackBatch = await request(baseUrl, adminOneCookie, adminOneCsrf, '/imports/validate', {
      productId: product.id,
      format: 'jsonl',
      authorizationConfirmed: true,
      content: [
        jsonl({ username: 'batch-user-one', password: 'batch-password-one' }),
        jsonl({ username: 'batch-user-two', password: 'batch-password-two' }),
      ].join('\n'),
    });
    assert.equal(rollbackBatch.response.status, 201);
    assert.equal(rollbackBatch.json.status, 'VALIDATED');
    assert.equal(rollbackBatch.json.validRows, 2);
    const inventoryBeforeRollback = fakePool.state.inventory.size;
    fakePool.failInventoryInsertNumber = 2;
    const failedBatchCommit = await request(baseUrl, adminOneCookie, adminOneCsrf, `/imports/${rollbackBatch.json.id}/commit`, { commitToken: rollbackBatch.json.commitToken });
    fakePool.failInventoryInsertNumber = null;
    assert.equal(failedBatchCommit.response.status, 409);
    assert.equal(failedBatchCommit.json.error.code, 'duplicate_inventory');
    assert.equal(fakePool.state.inventory.size, inventoryBeforeRollback, 'rollback must remove the first insert in the failed batch');
    assert.equal(fakePool.state.imports.get(rollbackBatch.json.id).status, 'VALIDATED');
    assert.equal(fakePool.state.importRows.get(rollbackBatch.json.id).filter((row) => row.payload_ciphertext).length, 2, 'rollback must preserve staged ciphertext for retry');

    assert.deepEqual(fakePool.unknownSql, [], `strict fake saw unknown SQL: ${fakePool.unknownSql.join('; ')}`);
  } finally {
    await close(server);
    if (previousKey === undefined) delete process.env.INVENTORY_ENCRYPTION_KEY_V1;
    else process.env.INVENTORY_ENCRYPTION_KEY_V1 = previousKey;
  }
});
