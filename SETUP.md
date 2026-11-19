# Run Emmyjosh Logs Marketplace locally

This source runs the customer website, customer API, admin API and provider adapters from one Node.js process. It does not contain your private `.env`, database, stock credentials or provider keys.

## Requirements

- Node.js 22 or newer.
- MySQL 8-compatible database (local MySQL or MariaDB).
- Either pnpm 11.25.0 or npm. The root `package-lock.json` is provided for an npm install.

## Windows PowerShell setup

From the extracted project folder:

```powershell
Copy-Item .env.example .env
notepad .env
```

At minimum, fill in `DATABASE_URL`, `ADMIN_BOOTSTRAP_EMAIL`, a private `ADMIN_BOOTSTRAP_PASSWORD` of at least 12 characters, `INVENTORY_ENCRYPTION_KEY_V1` (at least 32 random characters), and a private `JWT_SECRET`. Keep the encryption key backed up and unchanged: existing imported stock cannot be decrypted if it is lost. Leave the two local HTTP flags enabled only for `http://localhost` development; remove or set them off for HTTPS hosting.

Create an empty MySQL database for this project, then choose **one** install path:

**pnpm:**

```powershell
npm install -g pnpm@11.25.0 --registry=https://registry.npmjs.org/ --fetch-retries=5 --fetch-timeout=120000
pnpm install --frozen-lockfile
pnpm run db:generate
pnpm run db:setup
pnpm run dev
```

If installing pnpm fails with `ECONNRESET`, that is a registry/network/proxy connection failure; `pnpm` will remain unrecognized until that install succeeds. You can skip the global pnpm step and use the included npm lock instead:

```powershell
npm ci
npm run db:generate
npm run db:setup
npm run dev
```

`npm ci` also requires registry access. If it resets too, check the current network/VPN/proxy/firewall and retry; do not install pnpm from an unrelated untrusted source.

`db:setup` applies only additive, tracked SQL migrations and creates the first admin only if no admin exists. It does not reset a database or seed fake inventory. **Do not run `prisma db push`**: it bypasses the project's migration authority. The complete manual SQL reference is [`docs/sql/Complete_Checkout_Database.sql`](docs/sql/Complete_Checkout_Database.sql); normally use `db:setup` instead of running the SQL manually.

Open `http://localhost:3000`. Admin sign-in is `http://localhost:3000/admin/login`; the customer site is `/`, with the API mounted same-origin at `/api/v1` and the admin API at `/api/admin-tools`. The default port is 3000. If you change `PORT`, change the local URL to match.

## Provider configuration

Provider credentials belong in the **project-root `.env` only**. Never put them in browser JavaScript, SQL, GitHub, screenshots or the source ZIP. Changes take effect after restarting the server. Every provider purchase/credit switch is off in `.env.example`.

- **Donmarketplace Logs:** `DONMARKETPLACE_MODE=sandbox`, `DONMARKETPLACE_BASE_URL=https://donmarketplace.com/api/v1`, and `DONMARKETPLACE_API_KEY` (or its sandbox-only alias). Enable read-only Logs catalog sync with `DONMARKETPLACE_ENABLED=true`. The reviewed sandbox catalog had no buyable stock. Supplier purchases stay blocked until the supplier confirms safe order replay/delivery recovery and you intentionally enable both purchase/contract switches.
- **Provider 1, 5sim:** set `PROVIDER1_5SIM_API_TOKEN`, `PROVIDER1_CURRENCY`, `PROVIDER1_NGN_RATE` and any pricing rule. Provider 1 remains disabled by default. Confirm currency and conversion rate from your own merchant account; the API price alone is not enough to infer them.
- **Provider 2, SMSbower:** set `PROVIDER2_SMSBOWER_API_KEY`, `PROVIDER2_CURRENCY`, `PROVIDER2_NGN_RATE` and any pricing rule. Provider 2 remains disabled by default. It has a separate key and switch from 5sim.
- **PocketFi:** set its token, secret, business ID and agreed webhook signature-header name only after your Nigerian merchant account is ready. The adapter validates the documented sandbox/live base-path pair. Transfer credit remains disabled until PocketFi confirms how final-success events differ from failed/reversed events; ambiguous signed notifications are held for reconciliation, not credited.

Never turn on a purchase/funding flag just to test the screen. 5sim/SMSbower integrations have no documented sandbox in the reviewed material; no live number allocation was performed during development. Provider details and documented constraints are in [`docs/Provider_Setup.md`](docs/Provider_Setup.md).

## Admin pricing and authorized inventory

Create an OWN Logs product, choose its social platform, add accurate terms, and set a price rule before activating it. Fixed and percentage markups use integer kobo; Manual means the final selling price. A displayed gross markup is not guaranteed profit and excludes provider/payment costs.

Use **Admin → Upload Logs** to add authorized stock. The import accepts structured manual units or UTF-8 JSONL. Validate first, inspect redacted row diagnostics, then confirm the atomic import. Raw credential fields are cleared from the browser after validation starts; credentials stay encrypted server-side and are revealed only to the matching customer after a server-confirmed completed order. The system refuses to resell delivered/refunded units.

## What the code verifies—and what it does not

Checkout reserves inventory and debits the wallet in one SQL transaction; a database-level integration test uses an isolated disposable local database to prove that two customers cannot buy the last unit. The same test verifies idempotent order replay and that a refund restores the wallet exactly once while quarantining the delivered unit. The test never targets your production/managed database.

Donmarketplace, 5sim, SMSbower and PocketFi calls have not been used to buy real stock, numbers or payments. Supplier timeout/delivery uncertainty stays in reconciliation; there is no new-purchase retry or provider failover. Do not treat an API response, screenshot, redirect, loading spinner or a `.env` flag by itself as proof of money movement.

Run the isolated test suite with `pnpm test` (or `npm test`). Build the static frontend with `pnpm run build` (or `npm run build`). The server is started with `pnpm run dev` or `npm run dev`. To serve the build with the API, set `SERVE_DIST=1` and run `pnpm start` (or `npm start`). The project has not been publicly published.