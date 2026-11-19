'use strict';

// Post-migration checks against the PostgreSQL database. Read-only.
//   node tools/verify-postgres.js [--sample=25]
// Needs DATABASE_URL and INVENTORY_ENCRYPTION_KEY_V1 (the same key the old system used).

require('dotenv').config();
const { createPool, parseDatabaseUrl } = require('../backend/db');
const { decryptPayload, inventorySecret } = require('../backend/crypto');

const sample = Number((process.argv.find((a) => a.startsWith('--sample=')) || '--sample=25').split('=')[1]) || 25;
const issues = [];
const ok = (message) => console.log(`ok    ${message}`);
const bad = (message) => { issues.push(message); console.log(`FAIL  ${message}`); };

async function main() {
  const db = createPool({ config: parseDatabaseUrl(process.env.DATABASE_URL) });
  const one = async (sql, params = []) => (await db.inner.query(sql, params)).rows;
  try {
    const version = (await one('SHOW server_version'))[0].server_version;
    ok(`connected, PostgreSQL ${version}`);

    const fks = await one("SELECT conname FROM pg_constraint WHERE contype = 'f' AND NOT convalidated");
    fks.length ? bad(`unvalidated foreign keys: ${fks.map((f) => f.conname).join(', ')}`) : ok('all foreign keys are validated');

    // Links the application relies on that are not declared as foreign keys.
    const links = [
      ['checkout orders without a customer order', 'SELECT COUNT(*)::int AS n FROM ej_checkout_orders c LEFT JOIN "Order" o ON o.id = c.order_id WHERE o.id IS NULL'],
      ['checkout orders without a customer', 'SELECT COUNT(*)::int AS n FROM ej_checkout_orders c LEFT JOIN "User" u ON u.id = c.user_id WHERE u.id IS NULL'],
      ['allocations without a checkout order', 'SELECT COUNT(*)::int AS n FROM ej_checkout_allocations a LEFT JOIN ej_checkout_orders c ON c.order_id = a.order_id WHERE c.order_id IS NULL'],
      ['PocketFi operations without a customer', 'SELECT COUNT(*)::int AS n FROM ej_pocketfi_operations p LEFT JOIN "User" u ON u.id = p.user_id WHERE u.id IS NULL'],
    ];
    for (const [label, sql] of links) { const n = (await one(sql))[0].n; n ? bad(`${n} ${label}`) : ok(`no ${label}`); }

    const negative = (await one('SELECT COUNT(*)::int AS n FROM "Wallet" WHERE balance < 0'))[0].n;
    negative ? bad(`${negative} wallets have a negative balance`) : ok('no negative wallet balances');
    const totals = (await one('SELECT COUNT(*)::int AS wallets, COALESCE(SUM(balance),0)::text AS total FROM "Wallet"'))[0];
    ok(`wallets: ${totals.wallets}, total balance ${totals.total} (compare with the MySQL figure printed by the copy tool)`);

    const mixed = (await one('SELECT COUNT(*)::int AS n FROM "User" WHERE email <> LOWER(email) OR username <> LOWER(username)'))[0].n;
    mixed ? bad(`${mixed} customers have upper-case letters in email or username; login lower-cases the identifier, so these customers could not sign in. Lower-case them first.`) : ok('all customer emails and usernames are lower-case');
    const dupes = (await one('SELECT COUNT(*)::int AS n FROM (SELECT LOWER(email) FROM "User" GROUP BY 1 HAVING COUNT(*) > 1) d'))[0].n;
    dupes ? bad(`${dupes} duplicate emails when compared case-insensitively`) : ok('no case-insensitive duplicate emails');

    const stuck = (await one("SELECT COUNT(*)::int AS n FROM ej_checkout_orders WHERE state IN ('RECONCILIATION','DISPATCHED')"))[0].n;
    console.log(`info  ${stuck} checkout orders are in RECONCILIATION/DISPATCHED (same as MySQL; resolve them as before)`);

    // Encrypted data must still decrypt with the existing key.
    const secret = inventorySecret(process.env.INVENTORY_ENCRYPTION_KEY_V1);
    for (const [table, column, idColumn] of [
      ['ej_own_inventory_units', 'payload_ciphertext', 'id'],
      ['ej_admin_inventory_units', 'payload_ciphertext', 'id'],
      ['ej_checkout_orders', 'delivery_ciphertext', 'order_id'],
    ]) {
      const rows = await one(`SELECT ${idColumn} AS id, ${column} AS cipher FROM ${table} WHERE ${column} IS NOT NULL ORDER BY random() LIMIT $1`, [sample]);
      let failed = 0;
      for (const row of rows) { try { decryptPayload(row.cipher, secret); } catch { failed += 1; } }
      if (!rows.length) console.log(`info  ${table}.${column}: no rows to test`);
      else failed ? bad(`${table}.${column}: ${failed} of ${rows.length} sampled rows failed to decrypt (wrong INVENTORY_ENCRYPTION_KEY_V1?)`) : ok(`${table}.${column}: ${rows.length} sampled rows decrypt correctly`);
    }
  } finally { await db.end().catch(() => {}); }
  if (issues.length) { console.log(`\n${issues.length} problem(s) found. Do not switch traffic yet.`); process.exitCode = 1; }
  else console.log('\nAll checks passed.');
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
