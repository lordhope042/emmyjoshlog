# MySQL to PostgreSQL migration

PostgreSQL becomes the only database for both layers: Prisma (customer API) and the custom `backend` (admin, commerce, providers). The original MySQL database is never modified, so rolling back is a configuration change.

## What changed in the code

| Area | Change |
|---|---|
| `backend/db.js` | Now a `pg` pool with the same interface the code already used (`query` returns `[rows]` for reads and `[{ affectedRows }]` for writes, plus `getConnection`, `beginTransaction`, `commit`, `rollback`, `release`). Session time zone UTC, 30 s statement timeout (`DB_STATEMENT_TIMEOUT_MS`), TLS with certificate verification, production refuses a non-TLS remote host. |
| `backend/sql-translate.js` | Converts the existing MySQL-style SQL on the fly: `?` to `$n`, backticks and Prisma camelCase names to quoted names, `CURRENT_TIMESTAMP(3)`, `DATE_ADD`, `INSERT IGNORE`, `LIKE` to `ILIKE`, `IFNULL`, `FIELD()`, and array parameters for `IN (?)`. It throws on anything it cannot convert safely. All 115 SQL statements in the code translate. |
| `backend/index.js` | Three statements rewritten by hand: the pricing-rule upsert (`ON CONFLICT`) and the two staged-import cleanups (sub-selects). |
| `backend/commerce/service.js`, `legacy-api/src/services/pocketfi.js` | Raw Prisma SQL goes through the translator; deadlock and duplicate-key codes now also recognise PostgreSQL's. |
| `backend/migrations/001-008` | PostgreSQL versions of all eight migrations (native enums for the Prisma tables, `TIMESTAMP(3)` UTC, `BYTEA`, `JSONB`, identity columns, `updated_at` triggers, idempotent). |
| `backend/setup.js` | Runs each migration file as one transaction (PostgreSQL DDL is transactional). |
| `legacy-api/prisma/schema.prisma` | Provider `postgresql`. `migration_lock.toml` and the reference `0_init` updated. |
| `routes/marketplace.js`, `routes/admin.js` | Searches use `mode: 'insensitive'` (MySQL was case-insensitive by default; PostgreSQL is not). |
| `tools/` | `migrate-mysql-to-postgres.js`, `verify-postgres.js`, `check-db-connection.js`. |

## Before you start

1. Install: `npm install pg` and `npm install --save-dev mysql2` (the copy tool needs it; production does not once cut over). Run `npx prisma generate` after the schema change.
2. Delete the empty `legacy-api/prisma/migrations/20261118145243_init` folder.
3. Run the unit tests: `node --test backend/tests/*.test.js` (17 tests, no database needed).
4. Provision PostgreSQL (version 14 or newer) as a **separate** database. Create a dedicated user.

## Environment

```
# New (PostgreSQL). Prisma and the pg pool both read this one value.
DATABASE_URL=postgresql://marketplace:PASSWORD@db.example.com:5432/emmyjosh?sslmode=require&sslcert=/app/certs/database-ca.pem
DB_SSL_CA_PATH=certs/database-ca.pem      # or DB_SSL_CA_BASE64 / DB_SSL_CA
DB_POOL_SIZE=10
DB_STATEMENT_TIMEOUT_MS=30000

# Old MySQL, used only by tools/migrate-mysql-to-postgres.js. Remove after cutover.
MYSQL_URL=mysql://USER:PASSWORD@old-host:PORT/DB?ssl-mode=REQUIRED
MYSQL_SSL_CA_PATH=certs/aiven-ca.pem

# Unchanged. This is the same key the old data was encrypted with.
INVENTORY_ENCRYPTION_KEY_V1=...
```

Notes: `sslmode=require` makes Prisma use TLS; `sslcert` points Prisma at the CA file. The pg pool always verifies the certificate when TLS is on.

## Steps

1. **Back up MySQL** (managed-service backup or `mysqldump --single-transaction`). Keep it. Confirm you can read it.
2. **Rehearse on a copy.** Restore the backup to a scratch MySQL database, point `MYSQL_URL` at it, and do steps 3 to 6 against a scratch PostgreSQL database. Fix anything that fails before touching production.
3. **Create the schema:** `npm run db:setup` with `DATABASE_URL` pointing at the new empty database. This runs migrations 001-008 and creates the admin bootstrap user if none exists. (You can delete that bootstrap row after the copy; the copied admins replace it. To avoid the conflict, run only the migrations: `node -e "require('./backend/setup').runMigrations().then(()=>process.exit())"`.)
4. **Dry run:** `node tools/migrate-mysql-to-postgres.js --dry-run`. It reads MySQL (read-only snapshot), checks every table and column, and writes nothing. It fails if any MySQL column has no PostgreSQL column.
5. **Maintenance window.** Put the site into maintenance, or stop the app, so no orders or deposits land in MySQL during the copy. PocketFi retries failed webhooks, but confirm that with them.
6. **Copy:** `node tools/migrate-mysql-to-postgres.js`. It copies in foreign-key order, one transaction per table, keeps IDs and timestamps exactly, copies encrypted columns byte for byte, resets identity sequences, then compares row counts and money totals (wallet balances, transactions, orders, checkout totals). Admin sessions are not copied (admins sign in again).
7. **Verify:** `node tools/verify-postgres.js`. Checks foreign keys, logical links, negative balances, customers with upper-case emails or usernames (login lower-cases the identifier, so those would be locked out), and decrypts a random sample of encrypted inventory and deliveries with your key. Do not continue if it prints any FAIL.
8. **Smoke test on the new database** with the app pointed at it: register, log in, browse, buy an own-log, fund a wallet (sandbox deposit), place a number order with a provider in test mode, refund, and open the admin overview, orders, inventory and audit pages.
9. **Cut over:** deploy with the PostgreSQL `DATABASE_URL`, run `npm start`, check `/health`, and lift maintenance. Watch logs for errors for the first hour.
10. **After a stable period** (suggest two weeks): remove `MYSQL_URL`, uninstall `mysql2`, delete `tools/check-aiven-connection.js`, and decommission MySQL only after taking a final backup.

## Rollback

Until step 10, MySQL is untouched. To roll back: redeploy the previous release (the MySQL build) or restore the previous `DATABASE_URL` and code, and restart. Anything written to PostgreSQL after cutover (new orders, deposits) would not be in MySQL: if you roll back after real traffic, export those rows first (orders, wallet transactions, payments, webhook events since the cutover time) and replay them into MySQL. This is why the window between cutover and decommission should stay short and the first hours should be watched closely.

## Behaviour differences to know about

- **Case sensitivity:** PostgreSQL string comparison is case-sensitive. Searches and the translator use `ILIKE`; exact lookups (email, username) rely on values being lower-case, which registration already enforces. `verify-postgres.js` reports any that are not.
- **Timestamps** are stored as UTC without a zone. The copy preserves the stored value. If the old MySQL server was not running in UTC, compare one known order's time before and after and adjust.
- **64-bit integers** (kobo amounts, counts) return as JavaScript numbers when exactly representable and as strings otherwise, which matches what mysql2 did.
- **A failed statement aborts the transaction** in PostgreSQL. Code that caught a duplicate-key error and carried on inside a transaction would fail; the one place in the code that catches it (inventory import commit) already aborts with a 409, so it is unaffected.
- `ON UPDATE CURRENT_TIMESTAMP` columns now use a trigger (`ej_touch_updated_at`).
- Prisma now returns PostgreSQL `bigint` raw results as `BigInt`. The code already wraps counts in `Number()`; watch for any new `JSON.stringify` of raw rows in future work.

## Known limits of this work

I could not run PostgreSQL in my environment (no database server, no network). The SQL translator, the pool adapter and every migration statement list were checked by unit tests and by translating all 115 statements in the code, but **the migrations, the copy tool and the verification tool have never run against a real PostgreSQL**. Step 2 (rehearsal on a copy) is therefore not optional. Expect to fix one or two small things there; the tools fail loudly and write nothing partial.
