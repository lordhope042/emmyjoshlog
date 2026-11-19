'use strict';

// One-way copy of the marketplace data from MySQL into PostgreSQL.
//
//   MYSQL_URL=mysql://user:pass@host:port/db?ssl-mode=REQUIRED  (read-only source)
//   DATABASE_URL=postgresql://user:pass@host:5432/db?sslmode=require  (empty target)
//
//   node tools/migrate-mysql-to-postgres.js --dry-run     # read, count and check columns, write nothing
//   node tools/migrate-mysql-to-postgres.js               # copy
//
// Safety:
//  - The MySQL connection is a READ ONLY transaction with a consistent snapshot. Nothing is written to,
//    altered or deleted in MySQL, ever.
//  - The PostgreSQL schema must already exist (npm run db:setup). The target tables must be empty.
//  - Every table is copied inside its own transaction, so a failure leaves no partial table.
//  - IDs and timestamps are copied exactly as stored. Encrypted columns are copied byte for byte.
//  - Row counts and money totals are compared at the end. Exit code 1 means something did not match.

require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { createPool, parseDatabaseUrl } = require('../backend/db');

let mysql;
try { mysql = require('mysql2/promise'); } catch {
  console.error('mysql2 is required for this one-off tool: npm install --save-dev mysql2');
  process.exit(1);
}

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const INCLUDE_SESSIONS = args.has('--include-sessions');
const BATCH = Number((process.argv.find((a) => a.startsWith('--batch=')) || '--batch=500').split('=')[1]) || 500;

// Parents before children, so every foreign key is satisfied while copying.
const TABLES = [
  'ej_admin_users', 'ej_admin_sessions', 'ej_admin_products', 'ej_admin_pricing_rules',
  'ej_admin_imports', 'ej_admin_import_rows', 'ej_admin_inventory_units', 'ej_admin_audit_events',
  'User', 'ProductCategory', 'Product', 'ProductInventory', 'VirtualAccount', 'Wallet',
  'WalletTransaction', 'Order', 'OrderItem', 'Payment', 'WebhookEvent', 'Notification',
  'SupportTicket', 'SupportMessage', 'AdminAuditLog',
  'ej_provider_quotes', 'ej_checkout_orders', 'ej_checkout_allocations', 'ej_pocketfi_operations',
  'ej_own_products', 'ej_own_inventory_units', 'ej_own_imports', 'ej_own_import_rows',
];
// Totals compared between source and target.
const MONEY = [
  ['Wallet', 'balance'], ['WalletTransaction', 'amount'], ['Order', 'total'],
  ['ej_checkout_orders', 'retail_minor'], ['ej_provider_quotes', 'retail_minor'],
];

function mysqlConfig() {
  const raw = process.env.MYSQL_URL;
  if (!raw) throw new Error('MYSQL_URL is required (the old MySQL database, used read-only)');
  const url = new URL(raw);
  if (!['mysql:', 'mysqls:'].includes(url.protocol)) throw new Error('MYSQL_URL must use mysql://');
  const mode = (url.searchParams.get('ssl-mode') || url.searchParams.get('ssl') || '').toLowerCase();
  const config = {
    host: url.hostname, port: url.port ? Number(url.port) : 3306,
    user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.slice(1)),
    dateStrings: true,            // timestamps arrive as 'YYYY-MM-DD HH:MM:SS.mmm' text: no time-zone conversion
    supportBigNumbers: true, bigNumberStrings: true,
    multipleStatements: false,
  };
  if (url.protocol === 'mysqls:' || (mode && !['0', 'false', 'disabled'].includes(mode))) {
    const caPath = process.env.MYSQL_SSL_CA_PATH || path.join(process.cwd(), 'certs', 'aiven-ca.pem');
    config.ssl = { rejectUnauthorized: true, ...(fs.existsSync(caPath) ? { ca: fs.readFileSync(caPath) } : {}) };
  }
  return config;
}

const q = (name) => `"${String(name).replace(/"/g, '""')}"`;
const log = (...parts) => console.log(...parts);

function convert(value, column) {
  if (value === null || value === undefined) return null;
  switch (column.data_type) {
    case 'jsonb': case 'json':
      // MySQL returns parsed objects. MariaDB (XAMPP) stores JSON as text and returns a string that
      // is already valid JSON: send it unchanged instead of encoding it a second time.
      if (typeof value === 'string') {
        try { JSON.parse(value); return value; } catch { return JSON.stringify(value); }
      }
      return JSON.stringify(value);
    case 'timestamp without time zone':
      if (String(value).startsWith('0000-00-00')) throw new Error(`zero date in ${column.column_name}`);
      return String(value);
    default:
      return value;
  }
}

async function main() {
  const source = await mysql.createConnection(mysqlConfig());
  const target = createPool({ config: parseDatabaseUrl(process.env.DATABASE_URL) });
  const failures = [];
  try {
    await source.query('SET SESSION TRANSACTION READ ONLY');
    // MySQL and MariaDB accept slightly different forms. The session is already READ ONLY, so the
    // weaker forms still cannot write; they only give a less strict consistent snapshot.
    let snapshot = null;
    for (const statement of ['START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY', 'START TRANSACTION WITH CONSISTENT SNAPSHOT', 'START TRANSACTION']) {
      try { await source.query(statement); snapshot = statement; break; } catch { /* try the next form */ }
    }
    if (!snapshot) throw new Error('Could not start a read transaction on the MySQL/MariaDB source');
    log(`Source: MySQL ${(await source.query('SELECT DATABASE() AS db'))[0][0].db} (read-only; ${snapshot === 'START TRANSACTION' ? 'no snapshot, stop the app while copying' : 'consistent snapshot'})`);
    log(`Target: PostgreSQL ${(await target.inner.query('SELECT current_database() AS db')).rows[0].db}${DRY_RUN ? '  [DRY RUN, nothing is written]' : ''}`);

    // Preflight: schema present, target empty, no source column left behind.
    const plan = [];
    for (const table of TABLES) {
      if (table === 'ej_admin_sessions' && !INCLUDE_SESSIONS) { log(`skip   ${table} (admin sessions are not carried over; admins sign in again)`); continue; }
      const [mysqlCols] = await source.query('SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION', [table]);
      if (!mysqlCols.length) { log(`skip   ${table} (not present in MySQL)`); continue; }
      const pgCols = (await target.inner.query("SELECT column_name, data_type, is_identity FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 ORDER BY ordinal_position", [table])).rows;
      if (!pgCols.length) { failures.push(`${table}: missing in PostgreSQL. Run "npm run db:setup" first.`); continue; }
      const pgNames = new Set(pgCols.map((c) => c.column_name));
      const lost = mysqlCols.map((c) => c.name).filter((n) => !pgNames.has(n));
      if (lost.length) { failures.push(`${table}: MySQL columns with no PostgreSQL column (would lose data): ${lost.join(', ')}`); continue; }
      const existing = (await target.inner.query(`SELECT COUNT(*)::int AS n FROM ${q(table)}`)).rows[0].n;
      if (existing > 0 && !DRY_RUN) { failures.push(`${table}: target already holds ${existing} rows. Use an empty database.`); continue; }
      const columns = pgCols.filter((c) => mysqlCols.some((m) => m.name === c.column_name));
      const [pk] = await source.query("SELECT COLUMN_NAME AS name FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = 'PRIMARY' ORDER BY ORDINAL_POSITION", [table]);
      plan.push({ table, columns, pk: pk.map((p) => p.name), identity: pgCols.some((c) => c.is_identity === 'YES') });
    }
    if (failures.length) throw new Error(`Preflight failed:\n  - ${failures.join('\n  - ')}`);

    const report = [];
    for (const item of plan) {
      const { table, columns, pk } = item;
      const [[{ n: total }]] = await source.query(`SELECT COUNT(*) AS n FROM \`${table}\``);
      let copied = 0;
      if (!DRY_RUN && total > 0) {
        const client = await target.inner.connect();
        try {
          await client.query('BEGIN');
          const colList = columns.map((c) => q(c.column_name)).join(', ');
          const perInsert = Math.max(1, Math.min(BATCH, Math.floor(50000 / columns.length)));
          const order = pk.length ? ` ORDER BY ${pk.map((p) => `\`${p}\``).join(', ')}` : '';
          for (let offset = 0; offset < total; offset += perInsert) {
            const [rows] = await source.query(`SELECT ${columns.map((c) => `\`${c.column_name}\``).join(', ')} FROM \`${table}\`${order} LIMIT ? OFFSET ?`, [perInsert, offset]);
            if (!rows.length) break;
            const values = [];
            const tuples = rows.map((row, r) => `(${columns.map((c, i) => { values.push(convert(row[c.column_name], c)); return `$${r * columns.length + i + 1}`; }).join(', ')})`);
            await client.query(`INSERT INTO ${q(table)} (${colList}) VALUES ${tuples.join(', ')}`, values);
            copied += rows.length;
          }
          await client.query('COMMIT');
        } catch (error) {
          try { await client.query('ROLLBACK'); } catch {}
          throw new Error(`${table}: ${error.message}`);
        } finally { client.release(); }
        if (item.identity && pk.length === 1) {
          await target.inner.query(`SELECT setval(pg_get_serial_sequence($1, $2), COALESCE((SELECT MAX(${q(pk[0])}) FROM ${q(table)}), 1), (SELECT MAX(${q(pk[0])}) IS NOT NULL FROM ${q(table)}))`, [q(table), pk[0]]);
        }
      }
      const targetCount = DRY_RUN ? null : (await target.inner.query(`SELECT COUNT(*)::int AS n FROM ${q(table)}`)).rows[0].n;
      report.push({ table, source: Number(total), target: targetCount, copied });
      const ok = DRY_RUN || Number(total) === targetCount;
      if (!ok) failures.push(`${table}: row count mismatch (MySQL ${total}, PostgreSQL ${targetCount})`);
      log(`${ok ? 'ok    ' : 'FAIL  '} ${table.padEnd(26)} MySQL ${String(total).padStart(7)}   PostgreSQL ${DRY_RUN ? '    n/a' : String(targetCount).padStart(7)}`);
    }

    if (!DRY_RUN) {
      for (const [table, column] of MONEY) {
        if (!plan.some((p) => p.table === table)) continue;
        const [[a]] = await source.query(`SELECT COALESCE(SUM(\`${column}\`), 0) AS s FROM \`${table}\``);
        const b = (await target.inner.query(`SELECT COALESCE(SUM(${q(column)}), 0)::text AS s FROM ${q(table)}`)).rows[0];
        const same = Number(a.s) === Number(b.s);
        if (!same) failures.push(`${table}.${column}: total differs (MySQL ${a.s}, PostgreSQL ${b.s})`);
        log(`${same ? 'ok    ' : 'FAIL  '} total ${table}.${column}: MySQL ${a.s}   PostgreSQL ${b.s}`);
      }
    }
    if (failures.length) throw new Error(`Verification failed:\n  - ${failures.join('\n  - ')}`);
    log(DRY_RUN ? '\nDry run complete: schema and columns line up. Nothing was written.' : '\nCopy complete and verified. Now run: node tools/verify-postgres.js');
  } finally {
    try { await source.query('ROLLBACK'); } catch {}
    await source.end().catch(() => {});
    await target.end().catch(() => {});
  }
}

main().catch((error) => { console.error(`\n${error.message}`); process.exitCode = 1; });
