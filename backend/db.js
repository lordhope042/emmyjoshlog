'use strict';

// PostgreSQL connection pool with a small mysql2-compatible surface, so the existing code
// (`pool.query(sql, params)` returning `[rows]`, `getConnection()`, `beginTransaction()` ...)
// keeps working. SQL is translated from MySQL syntax on the way in (see sql-translate.js).

const fs = require('node:fs');
const path = require('node:path');
const { toPostgres, expandArrayParams } = require('./sql-translate');

let pool;

function readDatabaseCa() {
  if (process.env.DB_SSL_CA_BASE64) {
    try {
      return Buffer.from(process.env.DB_SSL_CA_BASE64.trim(), 'base64');
    } catch {
      throw new Error('DB_SSL_CA_BASE64 is not valid base64');
    }
  }
  if (process.env.DB_SSL_CA) return String(process.env.DB_SSL_CA).replace(/\\n/g, '\n');

  const configuredPath = process.env.DB_SSL_CA_PATH;
  const defaultPath = path.join(process.cwd(), 'certs', 'database-ca.pem');
  const caPath = configuredPath ? path.resolve(process.cwd(), configuredPath) : defaultPath;
  if (fs.existsSync(caPath)) return fs.readFileSync(caPath);
  if (configuredPath || process.env.DB_SSL_CA_REQUIRED === '1') {
    throw new Error(`Database CA certificate was not found at ${caPath}`);
  }
  return undefined;
}

function isLocalHost(host) {
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(String(host).toLowerCase());
}

function parseDatabaseUrl(value = process.env.DATABASE_URL) {
  if (!value) throw new Error('DATABASE_URL is required');
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('DATABASE_URL is invalid');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('DATABASE_URL must use postgresql://');
  if (!url.hostname || !url.pathname || url.pathname === '/') throw new Error('DATABASE_URL is missing database name');

  const config = {
    host: url.hostname,
    port: url.port ? Number(url.port) : 5432,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.slice(1)),
    max: Number(process.env.DB_POOL_SIZE || 10),
    idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS || 30000),
    connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT_MS || 10000),
    keepAlive: true,
  };
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) throw new Error('DATABASE_URL port is invalid');

  // Same query parameters Prisma understands, so one DATABASE_URL serves both layers.
  const sslmode = (url.searchParams.get('sslmode') || '').toLowerCase();
  const sslFlag = (url.searchParams.get('ssl') || '').toLowerCase();
  const disabled = sslmode === 'disable' || ['0', 'false', 'disabled', 'none'].includes(sslFlag);
  const requested = !disabled && (['require', 'verify-ca', 'verify-full'].includes(sslmode) || ['1', 'true'].includes(sslFlag));
  if (requested) {
    // Default: encrypted AND the server certificate is verified (against DB_SSL_CA_* / certs/database-ca.pem if given).
    // Opt-out for hosts whose CA is not in Node's trust store (e.g. Supabase): set DB_SSL_REJECT_UNAUTHORIZED=false.
    // The connection stays encrypted; only the certificate-chain check is skipped, like libpq's sslmode=require.
    // The opt-out never applies to sslmode=verify-ca / verify-full, which always verify.
    const strictMode = ['verify-ca', 'verify-full'].includes(sslmode);
    const skipVerify = !strictMode && ['0', 'false', 'off', 'no'].includes(String(process.env.DB_SSL_REJECT_UNAUTHORIZED || '').trim().toLowerCase());
    if (skipVerify) {
      config.ssl = { rejectUnauthorized: false };
    } else {
      const ca = readDatabaseCa();
      config.ssl = { rejectUnauthorized: true, ...(ca ? { ca } : {}) };
    }
  } else if (process.env.NODE_ENV === 'production' && !isLocalHost(config.host) && process.env.DB_ALLOW_INSECURE !== '1') {
    throw new Error('Production database connections must use TLS: add ?sslmode=require to DATABASE_URL (set DB_ALLOW_INSECURE=1 only for a private network)');
  }
  return config;
}

// mysql2 returned 64-bit integers as numbers (COUNT(*), BIGINT money in kobo); pg returns strings.
// Keep numbers when they are exactly representable, strings otherwise, so no value is ever rounded.
function makeTypes(pg) {
  return {
    getTypeParser(oid, format) {
      if (oid === 20) return (value) => { const n = Number(value); return Number.isSafeInteger(n) ? n : value; };
      if (oid === 1114) return (value) => new Date(`${value.replace(' ', 'T')}Z`); // timestamp without zone: stored as UTC
      return pg.types.getTypeParser(oid, format);
    },
  };
}

// Same error codes the code already checks for under MySQL.
function mapError(error) {
  const code = error && error.code;
  if (code === '23505') error.code = 'ER_DUP_ENTRY';
  else if (code === '40P01') error.code = 'ER_LOCK_DEADLOCK';
  else if (code === '55P03') error.code = 'ER_LOCK_WAIT_TIMEOUT';
  if (code && code !== error.code) error.pgCode = code;
  return error;
}

function normalizeValue(value) {
  if (value === undefined) return null;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date || Buffer.isBuffer(value) || value === null) return value;
  if (typeof value === 'object') return JSON.stringify(value); // objects and arrays are JSON, never PG arrays
  return value;
}

async function run(client, sql, params) {
  try {
    const expanded = expandArrayParams(sql, params || []);
    const values = expanded.params.map(normalizeValue);
    const result = await client.query({ text: toPostgres(expanded.sql), values });
    if (result.command === 'SELECT') return [result.rows, result.fields];
    return [{ affectedRows: result.rowCount, insertId: 0, warningStatus: 0 }, undefined];
  } catch (error) {
    throw mapError(error);
  }
}

function wrapClient(client) {
  const wrapper = {
    query: (sql, params) => run(client, sql, params),
    execute: (sql, params) => run(client, sql, params),
    // Pass-through for SQL that is already PostgreSQL (migrations). No translation.
    raw: (sql) => client.query(sql),
    beginTransaction: () => client.query('BEGIN'),
    commit: () => client.query('COMMIT'),
    rollback: () => client.query('ROLLBACK'),
    release: () => client.release(),
  };
  return wrapper;
}

function createPool(options = {}) {
  const pg = options.pg || require('pg');
  const config = options.config || parseDatabaseUrl(options.url);
  const inner = new pg.Pool({ ...config, types: makeTypes(pg), ...(options.overrides || {}) });
  const statementTimeout = Math.floor(Number(process.env.DB_STATEMENT_TIMEOUT_MS || 30000));
  const sessionSetup = `SET TIME ZONE 'UTC'${statementTimeout > 0 ? `; SET statement_timeout = ${statementTimeout}` : ''}`;
  inner.on('error', () => { /* idle client errors must not crash the process */ });

  // Session settings are applied once per physical connection, awaited before the first query.
  async function ready(client) {
    if (!client.__ejReady) {
      try { await client.query(sessionSetup); } catch { /* a pooler that rejects SET must not break queries */ }
      client.__ejReady = true;
    }
    return client;
  }
  async function withClient(work) {
    const client = await ready(await inner.connect());
    try { return await work(client); } finally { client.release(); }
  }
  return {
    inner,
    query: (sql, params) => withClient((client) => run(client, sql, params)),
    execute: (sql, params) => withClient((client) => run(client, sql, params)),
    getConnection: async () => wrapClient(await ready(await inner.connect())),
    end: () => inner.end(),
  };
}

function getPool() {
  if (!pool) pool = createPool();
  return pool;
}

function closePool() {
  const current = pool;
  pool = undefined;
  return current ? current.end() : Promise.resolve();
}

module.exports = {
  get pool() { return getPool(); },
  getPool,
  createPool,
  parseDatabaseUrl,
  closePool,
  mapError,
};
