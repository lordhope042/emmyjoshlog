'use strict';

require('dotenv').config();
const fs = require('node:fs/promises');
const path = require('node:path');
const { getPool } = require('./db');
const { randomToken, scryptHash, inventorySecret } = require('./crypto');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

// Kept for callers and tests. Migrations no longer use it: PostgreSQL migrations contain
// function bodies and DO blocks with semicolons, so each file is sent as one unit instead.
function splitStatements(sql) {
  return sql.split(/;\s*(?:\r?\n|$)/).map((part) => part.trim()).filter(Boolean);
}

function assertBootstrapEnv(env = process.env) {
  const email = typeof env.ADMIN_BOOTSTRAP_EMAIL === 'string' ? env.ADMIN_BOOTSTRAP_EMAIL.trim().toLowerCase() : '';
  const password = env.ADMIN_BOOTSTRAP_PASSWORD;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('ADMIN_BOOTSTRAP_EMAIL is required and must be valid');
  if (typeof password !== 'string' || password.length < 12) throw new Error('ADMIN_BOOTSTRAP_PASSWORD must be at least 12 characters');
  return { email, password };
}

async function runMigrations(db = getPool()) {
  // PostgreSQL DDL is transactional, so each migration file either applies completely or not at all.
  await db.query('CREATE TABLE IF NOT EXISTS ej_admin_migrations (version VARCHAR(100) NOT NULL PRIMARY KEY, applied_at TIMESTAMP(3) NOT NULL DEFAULT LOCALTIMESTAMP(3))');
  const files = (await fs.readdir(MIGRATIONS_DIR)).filter((file) => /^\d+_.+\.sql$/.test(file)).sort();
  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    const sql = await fs.readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
    if (!sql.trim()) continue;
    const [rows] = await db.query('SELECT version FROM ej_admin_migrations WHERE version = ?', [version]);
    if (rows.length) continue;
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      await connection.raw(sql);
      await connection.query('INSERT INTO ej_admin_migrations (version) VALUES (?)', [version]);
      await connection.commit();
    } catch (error) {
      try { await connection.rollback(); } catch {}
      throw error;
    } finally {
      connection.release();
    }
  }
  return files.map((file) => file.replace(/\.sql$/, ''));
}

async function bootstrapAdmin(db = getPool(), env = process.env) {
  const { email, password } = assertBootstrapEnv(env);
  inventorySecret(env.INVENTORY_ENCRYPTION_KEY_V1);
  const [admins] = await db.query("SELECT COUNT(*) AS count FROM ej_admin_users WHERE role = 'ADMIN'");
  if (Number(admins[0].count) > 0) return { createdOrPreserved: true };
  const passwordHash = await scryptHash(password);
  await db.query('INSERT INTO ej_admin_users (id, email, password_hash, role) VALUES (?, ?, ?, \'ADMIN\')', [`eju_${randomToken(16)}`, email, passwordHash]);
  return { createdOrPreserved: true };
}

async function setup({ db, env = process.env } = {}) {
  assertBootstrapEnv(env);
  inventorySecret(env.INVENTORY_ENCRYPTION_KEY_V1);
  const database = db || getPool();
  await runMigrations(database);
  return bootstrapAdmin(database, env);
}

if (require.main === module) {
  setup().then(() => {
    console.log('Marketplace database setup complete; existing records preserved.');
  }).catch((error) => {
    console.error('Marketplace database setup failed. Check bootstrap/encryption values and migration compatibility; no reset was attempted.');
    if (process.env.DEBUG_SETUP === '1') console.error(error);
    process.exitCode = 1;
  }).finally(() => require('./db').closePool());
}

module.exports = { splitStatements, assertBootstrapEnv, runMigrations, bootstrapAdmin, setup };
