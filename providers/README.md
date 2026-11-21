# Provider integration scope

`router.js` exports `createProviderRouter({ db, fetchImpl, commerce, env })` for the customer `/api/v1/providers` mount and `createProviderAdminRouter({ db, fetchImpl, env })` for the authenticated admin `/providers` mount. The customer router calls the legacy `requireAuth` middleware itself; parent routing owns CSRF and mounting.

Provider 1 is 5SIM and provider 2 is SMSBower. Their separate secrets are `PROVIDER1_5SIM_API_TOKEN` and `PROVIDER2_SMSBOWER_API_KEY`. Quotes require explicit `PROVIDER1/2_ENABLED`, `PROVIDER1/2_CURRENCY`, positive `PROVIDER1/2_NGN_RATE`, and a fixed or percentage markup (`PROVIDER1/2_RETAIL_MODE` plus `PROVIDER1/2_RETAIL_MARKUP`). Purchases additionally require the corresponding `PROVIDER1/2_PURCHASES_ENABLED` switch. Missing currency/rate/markup disables quotes; no currency or rate is inferred.

## Donmarketplace live catalog (read-only)

The supplied Donmarketplace documentation confirms `GET /catalog/logs`, Bearer-token authentication, and product fields `id`, `name`, `stock`, and `price_minor`. The existing adapter calls `https://donmarketplace.com/api/v1/catalog/logs` and reads those fields. The updated configuration permits `DONMARKETPLACE_MODE=live` for catalog reads, but **keeps live supplier purchases disabled**, even if `DONMARKETPLACE_PURCHASES_ENABLED=true` is present. Live mode accepts `sk_live_` or `cp_live_` key prefixes from `DONMARKETPLACE_API_KEY`; sandbox accepts `sk_test_` from `DONMARKETPLACE_SANDBOX_API_KEY` or `DONMARKETPLACE_API_KEY`. A key for the wrong mode is ignored.

After rotating the credential pasted into chat, place the replacement only in the project-root `.env` (alongside the root `server.js`), never in frontend storage or source files. Use this non-secret configuration:

```dotenv
DONMARKETPLACE_MODE=live
DONMARKETPLACE_API_KEY=<rotated live key>
DONMARKETPLACE_BASE_URL=https://donmarketplace.com/api/v1
DONMARKETPLACE_ENABLED=true
DONMARKETPLACE_PURCHASES_ENABLED=false
DONMARKETPLACE_DELIVERY_CONTRACT_CONFIRMED=false
```

The admin action `POST /providers/logs/sync` reads the live catalog and saves new or changed supplier products as DRAFT records for review. It does not place supplier orders or debit the supplier balance. Configure retail pricing and activate mappings only after checking the catalog. Existing admin-created/manual `OWN` inventory is a separate source and is not overwritten by supplier sync; it must remain independently manageable and sellable.

## Payment and supplier-cost flow

The intended later payment stage is: the customer pays the website's retail price, while the Donmarketplace supplier account is charged the supplier cost. Retail margin and supplier cost must remain separately recorded. The current provider checkout path uses the customer's marketplace wallet and can call Donmarketplace to place an order; connecting an external website payment method is a separate step and is not enabled by the live-catalog change.

All quotes are persisted in `ej_provider_quotes` with a short expiry and user binding. A purchase reserves the local external order and atomically claims `RESERVED -> DISPATCHED` before the external call. Provider timeouts, connection failures, and malformed mutating responses remain `RECONCILIATION`; the code never retries or fails over automatically. Logs delivery is completed only when `delivery.lines.length` exactly equals the ordered quantity, and delivery is passed to commerce as opaque encrypted values. SMSBower cancellation never asserts a refund; it remains pending reconciliation. 5SIM cancellation is refunded only after an authoritative `CANCELED` response with no SMS.

Known live-purchase blocker: the supplied documentation excerpt does not describe lost-response order recovery. Keep live purchases disabled until Donmarketplace confirms how to recover an order accepted upstream when the response is lost. The 5SIM and SMSBower integrations also document no sandbox/test endpoint or caller idempotency for activation purchases; purchases remain separately gated.
