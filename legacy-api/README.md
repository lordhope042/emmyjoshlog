# Emmyjosh Logs Marketplace — Backend API

Node.js + Express + Prisma + MySQL backend for the Emmyjosh Logs Marketplace.
Implements Phases 1–4 of the project documentation: foundation, auth,
marketplace, wallet + PocketFi virtual-account skeleton, plus an admin API skeleton.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create the MySQL database, then copy `.env.example` to `.env` and fill in
   `DATABASE_URL` and a strong `JWT_SECRET`.
3. Create tables and seed:
   ```bash
   npm run db:generate
   npm run db:migrate   # creates a migration
   npm run db:seed      # Logs + Virtual Numbers categories, admin, demo products
   ```
4. Run:
   ```bash
   npm run dev          # http://localhost:5000
   ```

Seeded admin login: `admin@emmyjoshlogs.com` — set a real password via
`ADMIN_PASSWORD` env var before seeding, then change it.

## PocketFi (wallet funding)

- Without PocketFi credentials, set `MOCK_POCKETFI=true` for local dev only.
  The create-account endpoint then returns a fake account so the frontend
  flow can be tested end to end.
- Before production: confirm from the merchant's active PocketFi docs the
  exact virtual-account endpoint, required customer fields, webhook
  signature header, event names and acknowledgement contract, then update
  `src/services/pocketfi.js` and `src/routes/webhooks.js` (marked TODO).
- Wallet credits only ever happen in the verified webhook path, inside a
  database transaction, keyed by the unique provider transaction reference —
  duplicate deliveries are acknowledged and ignored safely.

## API overview (all under /api/v1)

| Area | Endpoints |
|---|---|
| Auth | POST /auth/register, /auth/login, /auth/logout, GET /auth/me |
| Users | GET/PATCH /users/me, PATCH /users/me/password |
| Dashboard | GET /dashboard/summary |
| Marketplace | GET /categories, GET /products, GET /products/:id |
| Wallet | GET /wallet, GET /wallet/transactions, GET/POST /wallet/virtual-account, GET /wallet/virtual-account/status |
| Orders | POST /orders, GET /orders, GET /orders/:id |
| Notifications | GET /notifications, PATCH /notifications/:id/read, POST /notifications/read-all |
| Support | POST /support/tickets, GET /support/tickets |
| Webhook | POST /webhooks/pocketfi |
| Admin | /admin/summary, /admin/customers, /admin/products, /admin/orders, /admin/transactions, /admin/virtual-accounts, /admin/audit-logs, /admin/support/tickets |

## Security notes

- JWT in an httpOnly cookie (`token`), bcrypt (cost 12) password hashing,
  zod validation on every write route, rate limiting on auth endpoints.
- All balances are DECIMAL; the browser never supplies prices or balances.
- Admin routes require server-side role checks; sensitive actions write to
  `admin_audit_logs`.

## Still to build (per documentation)

- Password recovery (forgot/reset with single-use tokens)
- Refund flow (REFUND wallet transaction linked to the original order)
- Admin product publish/archive UI flows, notifications broadcast
- Reconciliation tooling for failed/unmatched webhooks
- Automated tests (auth, RBAC, duplicate webhook, concurrency)
