'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { toPostgres, expandArrayParams } = require('../sql-translate');

test('placeholders become $n and ? inside strings are kept', () => {
  assert.equal(toPostgres("SELECT * FROM ej_admin_users WHERE email = ? AND role = 'a?b' AND id = ?"),
    "SELECT * FROM ej_admin_users WHERE email = $1 AND role = 'a?b' AND id = $2");
});
test('backtick and Prisma table names are quoted', () => {
  assert.equal(toPostgres('SELECT id FROM `User` LIMIT 1'), 'SELECT id FROM "User" LIMIT 1');
  assert.equal(toPostgres('SELECT o.* FROM `Order` o WHERE o.id=? FOR UPDATE'), 'SELECT o.* FROM "Order" o WHERE o.id=$1 FOR UPDATE');
  assert.equal(toPostgres('UPDATE Wallet SET balance=balance-?,updatedAt=CURRENT_TIMESTAMP(3) WHERE id=? AND balance>=?'),
    'UPDATE "Wallet" SET balance=balance-$1,"updatedAt"=LOCALTIMESTAMP(3) WHERE id=$2 AND balance>=$3');
});
test('camelCase columns and aliases are quoted, keywords and snake_case are not', () => {
  assert.equal(toPostgres('SELECT id,userId,orderReference FROM ej_checkout_orders ORDER BY createdAt DESC'),
    'SELECT id,"userId","orderReference" FROM ej_checkout_orders ORDER BY "createdAt" DESC');
  assert.equal(toPostgres('SELECT COUNT(*) AS count, MAX(updated_at) AS lastSeen FROM t'), 'SELECT COUNT(*) AS count, MAX(updated_at) AS "lastSeen" FROM t');
});
test('text inside string literals is never touched', () => {
  assert.equal(toPostgres("SELECT 'userId, `x`, ?' AS note"), "SELECT 'userId, `x`, ?' AS note");
  assert.equal(toPostgres("INSERT INTO ProductCategory (id,name) VALUES (?,'O''Brien Product')"),
    `INSERT INTO "ProductCategory" (id,name) VALUES ($1,'O''Brien Product')`);
});
test('INSERT IGNORE becomes ON CONFLICT DO NOTHING', () => {
  assert.equal(toPostgres('INSERT IGNORE INTO ej_checkout_allocations (order_id,status) VALUES (?,?)'),
    'INSERT INTO ej_checkout_allocations (order_id,status) VALUES ($1,$2) ON CONFLICT DO NOTHING');
  assert.equal(toPostgres('INSERT IGNORE INTO ProductInventory (id,productId,reservedAt) VALUES (?,?,CURRENT_TIMESTAMP(3));'),
    'INSERT INTO "ProductInventory" (id,"productId","reservedAt") VALUES ($1,$2,LOCALTIMESTAMP(3)) ON CONFLICT DO NOTHING');
});
test('DATE_ADD / DATE_SUB / IFNULL / LIKE', () => {
  assert.equal(toPostgres('VALUES (?, ?, DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 8 HOUR))'), "VALUES ($1, $2, (LOCALTIMESTAMP(3) + INTERVAL '8 hours'))");
  assert.equal(toPostgres('WHERE x < DATE_SUB(NOW(), INTERVAL 15 MINUTE)'), "WHERE x < (LOCALTIMESTAMP(3) - INTERVAL '15 minutes')");
  assert.equal(toPostgres("WHERE name LIKE ? AND IFNULL(a,0) > 1"), 'WHERE name ILIKE $1 AND COALESCE(a,0) > 1');
});
test('existing double-quoted identifiers are left alone', () => {
  assert.equal(toPostgres('SELECT "User".id FROM "User" WHERE id = ?'), 'SELECT "User".id FROM "User" WHERE id = $1');
});
test('constructs that cannot be translated safely throw', () => {
  assert.throws(() => toPostgres('INSERT INTO t (a) VALUES (?) ON DUPLICATE KEY UPDATE a=VALUES(a)'), /ON DUPLICATE KEY/);
  assert.throws(() => toPostgres('UPDATE ej_own_import_rows r JOIN ej_own_imports i ON i.id=r.import_id SET r.x=1'), /UPDATE ... JOIN/);
  assert.throws(() => toPostgres('DELETE r FROM ej_own_import_rows r JOIN ej_own_imports i ON i.id=r.import_id'), /DELETE alias/);
});
test('comments are preserved and not rewritten', () => {
  assert.equal(toPostgres('SELECT 1 -- userId ?\n, ?'), 'SELECT 1 -- userId ?\n, $1');
});

test('FIELD() ordering becomes a CASE expression', () => {
  assert.equal(toPostgres("SELECT * FROM ej_admin_pricing_rules ORDER BY FIELD(scope, 'PRODUCT', 'PLATFORM', 'DEFAULT') LIMIT 1"),
    "SELECT * FROM ej_admin_pricing_rules ORDER BY (CASE scope WHEN 'PRODUCT' THEN 1 WHEN 'PLATFORM' THEN 2 WHEN 'DEFAULT' THEN 3 ELSE 0 END) LIMIT 1");
});
test('array parameters expand like mysql2 did, in the right positions', () => {
  const out = expandArrayParams("SELECT 1 FROM t WHERE a IN (?) AND note = '?' OR b IN (?) AND c = ?", [['x', 'y'], ['z'], 5]);
  assert.equal(out.sql, "SELECT 1 FROM t WHERE a IN (?, ?) AND note = '?' OR b IN (?) AND c = ?");
  assert.deepEqual(out.params, ['x', 'y', 'z', 5]);
  assert.equal(toPostgres(out.sql), "SELECT 1 FROM t WHERE a IN ($1, $2) AND note = '?' OR b IN ($3) AND c = $4");
  assert.equal(expandArrayParams('SELECT ? IN (?)', [1, []]).sql, 'SELECT ? IN (NULL)');
});
