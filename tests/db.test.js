'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPool, parseDatabaseUrl, mapError } = require('../db');

function fakePg(log, responder) {
  class Pool {
    constructor(config) { log.config = config; }
    on() {}
    async connect() {
      return { query: async (q) => { if (typeof q === 'string' && q.startsWith('SET ')) return { command: 'SET', rows: [] }; log.calls.push(q); return responder(q); }, release() { log.released = true; } };
    }
    async end() { log.ended = true; }
  }
  return { Pool, types: { getTypeParser: () => (v) => v } };
}

test('SELECT returns [rows]; writes return [{affectedRows}]', async () => {
  const log = { calls: [] };
  const pool = createPool({ config: { host: 'h' }, pg: fakePg(log, (q) => (/^SELECT/.test(q.text) ? { command: 'SELECT', rows: [{ id: 1 }], fields: [] } : { command: 'UPDATE', rowCount: 1, rows: [] })) });
  const [rows] = await pool.query('SELECT id FROM `User` WHERE id = ?', ['u1']);
  assert.deepEqual(rows, [{ id: 1 }]);
  assert.equal(log.calls[0].text, 'SELECT id FROM "User" WHERE id = $1');
  const [result] = await pool.query("UPDATE ej_admin_sessions SET last_seen_at = CURRENT_TIMESTAMP(3) WHERE token_hash = ?", ['t']);
  assert.equal(result.affectedRows, 1);
});
test('array parameters are expanded for IN (?)', async () => {
  const log = { calls: [] };
  const pool = createPool({ config: {}, pg: fakePg(log, () => ({ command: 'SELECT', rows: [], fields: [] })) });
  await pool.query('SELECT 1 FROM t WHERE a IN (?) OR b IN (?)', [['x', 'y'], ['z']]);
  assert.equal(log.calls[0].text, 'SELECT 1 FROM t WHERE a IN ($1, $2) OR b IN ($3)');
  assert.deepEqual(log.calls[0].values, ['x', 'y', 'z']);
});
test('parameters: undefined->null, bigint->string, objects->JSON, Buffer kept', async () => {
  const log = { calls: [] };
  const pool = createPool({ config: {}, pg: fakePg(log, () => ({ command: 'INSERT', rowCount: 1, rows: [] })) });
  const buf = Buffer.from('x');
  await pool.query('INSERT INTO t (a,b,c,d) VALUES (?,?,?,?)', [undefined, 12n, { a: 1 }, buf]);
  assert.deepEqual(log.calls[0].values, [null, '12', '{"a":1}', buf]);
});
test('transactions use BEGIN/COMMIT/ROLLBACK and release', async () => {
  const log = { calls: [] };
  const pool = createPool({ config: {}, pg: fakePg(log, () => ({ command: 'SELECT', rows: [], fields: [] })) });
  const c = await pool.getConnection();
  await c.beginTransaction(); await c.query('SELECT 1'); await c.rollback(); c.release();
  assert.deepEqual(log.calls.map((q) => (typeof q === 'string' ? q : q.text)), ['BEGIN', 'SELECT 1', 'ROLLBACK']);
  assert.equal(log.released, true);
});
test('PostgreSQL error codes are mapped to the codes the code checks', () => {
  assert.equal(mapError({ code: '23505' }).code, 'ER_DUP_ENTRY');
  assert.equal(mapError({ code: '40P01' }).code, 'ER_LOCK_DEADLOCK');
  assert.equal(mapError({ code: '55P03' }).code, 'ER_LOCK_WAIT_TIMEOUT');
  assert.equal(mapError({ code: '40001' }).code, '40001');
});
test('DATABASE_URL parsing and TLS rules', () => {
  const ok = parseDatabaseUrl('postgresql://u:p%40ss@db.example.com:5433/market?sslmode=require');
  assert.equal(ok.host, 'db.example.com'); assert.equal(ok.port, 5433); assert.equal(ok.password, 'p@ss'); assert.equal(ok.ssl.rejectUnauthorized, true);
  assert.throws(() => parseDatabaseUrl('mysql://u:p@h/db'), /postgresql/);
  const old = process.env.NODE_ENV; process.env.NODE_ENV = 'production';
  try { assert.throws(() => parseDatabaseUrl('postgresql://u:p@db.example.com/market'), /TLS/); assert.doesNotThrow(() => parseDatabaseUrl('postgresql://u:p@localhost/market')); }
  finally { process.env.NODE_ENV = old; }
});
