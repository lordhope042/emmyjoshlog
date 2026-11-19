# Emmyjosh admin tools backend

This directory contains the additive admin-tools backend for the `/api/admin-tools` mount. It does not modify the legacy API schema or shared frontend/server/config files. All tables use the `ej_admin_` prefix.

## Exports

- `require('./backend').createAdminRouter(options)` returns the Express router. `options.db` may provide an injected mysql2-compatible pool/connection factory for isolated integration tests; production defaults to the lazy pool from `db.js`.
- `require('./backend').isReady()` returns `{ setupReady, databaseConfigured }` without opening a connection. `GET /session` includes `setupReady`.
- `backend/db.js` exports the lazy `pool`, `getPool()`, `createPool()`, `parseDatabaseUrl()`, and `closePool()`. URL query parameters are not forwarded as arbitrary mysql2 options. TLS is enabled for `mysqls://` and explicit required SSL modes with certificate verification enabled.
- `backend/crypto.js` exports exact kobo money conversion/calculation, scrypt password helpers, AES-256-GCM payload encryption, HKDF-separated encryption/HMAC keys, session hashes, and internal HMAC fingerprints. Fingerprints and ciphertext never appear in API responses.
- `backend/setup.js` exports `runMigrations()`, `bootstrapAdmin()`, `setup()`, `assertBootstrapEnv()`, and `splitStatements()`.

## Setup

The parent/deployment runner should execute `node backend/setup.js` once with `DATABASE_URL`, `ADMIN_BOOTSTRAP_EMAIL`, `ADMIN_BOOTSTRAP_PASSWORD` (at least 12 characters, preserving password bytes exactly), and `INVENTORY_ENCRYPTION_KEY_V1` (at least 32 characters). The encryption secret is validated before any database setup. The runner applies unfinished files in `backend/migrations/`, records versions in `ej_admin_migrations`, and creates the bootstrap admin only when no admin exists; changing the bootstrap email later cannot add another admin. It never replaces an existing password and never seeds synthetic products, rules, or inventory. MySQL DDL may implicitly commit, so migrations are written to be idempotent and should be retried after a failed run. This implementation did not connect to or mutate a managed database during development.

## Authentication and request rules

Every route requires `X-EJ-Request: 1`; there is no CORS allowance or preview/development bypass. Login is `POST /login` with JSON `{email,password}`. Sessions use a random opaque `ej_admin_session` cookie, store only a SHA-256 token hash, use `HttpOnly; SameSite=None; Secure; Path=/api/admin-tools` in deployed HTTPS and `HttpOnly; SameSite=Lax` without `Secure` only when `ADMIN_LOCAL_HTTP=1`, and are eight hours long. Authenticated writes, including logout, require JSON and `X-Admin-CSRF`; the CSRF token is a stable HMAC of the session cookie under a dedicated scrypt-root/HKDF-derived key and is hashed at rest, so GET/session refreshes do not rotate it. Login is scrypt-based, constant-time verified, and rate limited. Failed authentication is fail-closed.

## Routes

- `GET /session` returns `{user,csrfToken,setupReady}`.
- `POST /login`, `POST /logout` establish and clear admin sessions.
- `GET /summary` returns product, available-unit, import, pricing-rule, and disabled-supplier summary counts.
- `GET /products`, `POST /products`, `PATCH /products/:id` manage products. `DONMARKETPLACE` products are always `DRAFT`; supplier acquisition is not implemented. `ACTIVE` owned products must have a valid positive retail price.
- `GET /pricing-rules`, `POST /pricing-rules`, `DELETE /pricing-rules/:id` manage versioned `DEFAULT`, `PLATFORM`, and `PRODUCT` rules. Resolution is product, then platform, then default. Active-product effects are revalidated before a rule transaction commits.
- `POST /pricing/preview` performs an unsaved calculation using integer-kobo arithmetic: `FIXED` adds a fixed naira markup to known cost, `PERCENT` applies a ceiling percentage margin, and `MANUAL` is a direct retail override. Unknown cost is allowed only for manual retail pricing; retail below cost is rejected.
- `POST /imports/validate` accepts only confirmed JSONL, up to 2 MiB and 1,000 nonempty rows. Valid rows in a committable batch are encrypted into staging; invalid batches retain no staged payload ciphertext. Raw credentials, fingerprints, and ciphertext are never returned. Password strings are not trimmed, but empty passwords and trim-empty identifiers are rejected. Diagnostics retain physical JSONL line numbers, including blank lines. Upload/existing duplicates are reported without revealing values.
- `POST /imports/:id/commit` locks the import/product, rechecks expiry/ownership/duplicates, inserts all units atomically, purges staged ciphertext, and returns an idempotent replay result for the same commit token. `GET /imports` lists redacted import history and purges expired staging rows.
- `GET /inventory` lists safe metadata only. `PATCH /inventory/:id/status` permits only `AVAILABLE`/`QUARANTINED` transitions; sold/reserved units cannot be reactivated.
- `GET /audit` returns redacted action metadata, counts, statuses, and rule versions only.
- `GET /catalog` and `GET /catalog/:id` expose only active owned products with valid positive pricing. Responses include `category: "Logs"`, `categorySlug: "logs"`, availability/counts, quantity bounds, and `checkoutEnabled: false`; cost, rules, fingerprints, ciphertext, and credentials are absent.
- `GET /supplier` explicitly reports sandbox mode and disabled purchases. There are no supplier calls, wallet/order mutation routes, or real payment flows.

## Test evidence

Run:

```sh
node --test tests/*.test.js
```

The pure suite covers integer money and ceiling-percent arithmetic, pricing/product validation and source/status priority, JSONL bounds/password preservation/upload dedupe, authenticated encryption and deterministic internal fingerprints, and public response redaction. No test opens a managed connection or writes managed database state.


## Split product catalogues

Migration `007_own_catalog.sql` creates the separate `ej_own_products`, `ej_own_inventory_units`, `ej_own_imports`, and `ej_own_import_rows` tables. Manually managed products and stock use these tables. Donmarketplace supplier synchronization continues to use `ej_admin_products` and `ej_admin_inventory_units`. The customer marketplace combines own-stock listings with Donmarketplace supplier quotes; the two sources retain separate fulfilment paths. Run the normal setup command (`node backend/setup.js`) to apply any pending migration. Back up the database before deployment.


## Product source pricing workflow

The admin UI groups products into **Don Logs** and **My SocialLogs**. Own SocialLogs use the selling price entered in the product form and are not priced from platform/default rules. Don Logs require an individual product-scoped `MANUAL` selling-price override: `PATCH /products/:id/don-price` validates that the selling price is at least the synced API cost, stores the override, and activates that one Don Log in a single transaction. `PATCH /products/:id/don-activation` deactivates an active Don Log while retaining its saved price. Customer Donmarketplace quotes are generated only for active supplier listings with a valid per-product manual price.
