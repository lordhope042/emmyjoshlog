# Donmarketplace Logs integration review

**Reviewed:** 14 November 2026  
**Target:** Emmyjosh Logs Marketplace  
**Scope:** Authorized social-account Logs only. No other Donmarketplace service is included in this supplier integration.

## What was actually verified

Authenticated, read-only requests to the official documentation, service flags, and Logs catalog all returned HTTP 200. The documentation and both API responses identified the mode as `sandbox`. The service flags returned `digital_products: true`. [1] [2] [3]

The actual Logs catalog returned:

```json
{
  "mode": "sandbox",
  "servers": [],
  "categories": ["TikTok"],
  "products": []
}
```

The key works, but this response contains **no buyable Logs products**. No pack IDs, actual product prices, quantities, stock levels, or product-specific platform information could be tested. The example product ID in the documentation is not proof that it exists in this account's sandbox catalog. This result also does not prove that the live catalog is empty. [2]

No order was created. No balance was debited. No delivered account credentials were retrieved. Supplier acceptance, order replay, refunds, and delivery behavior remain untested.

## Confirmed API contract

The base URL is `https://donmarketplace.com/api/v1`. Authentication uses an `Authorization: Bearer` header. The key must remain on Emmyjosh's backend, never in browser JavaScript, local storage, URLs, or product responses. The documentation says sandbox keys do not debit a wallet or call suppliers. Live and child-panel keys debit the key owner's Donmarketplace wallet. [1]

The Logs catalog endpoint is `GET /catalog/logs`. Documentation examples describe `products[]` containing `id`, `name`, `stock`, and `price_minor`; a broader example also includes `category`, `min_qty`, and a public server label. Products should be mapped by the returned ID, not by their display name. The actual catalog currently contains no product rows with which to validate those fields. [1] [2]

The documented purchase body is:

```json
{
  "type": "logs",
  "product_id": "ID returned by the catalog, using its actual type",
  "quantity": "validated integer quantity"
}
```

The annotations above describe the mapping; they are not a literal request to send. The documentation's concrete example uses a numeric product ID and numeric quantity. Requests go to `POST /orders` with Bearer authentication, `Content-Type: application/json`, and an `Idempotency-Key`. The retailer cannot set the supplier's price by sending an Emmyjosh selling price in this request. [1]

Orders are identified by the returned public `order.number`, such as an `MC…` reference. `GET /orders` describes the key owner's last 50 orders, and `GET /orders/{number}` looks up an individual order. An Emmyjosh internal order ID must not be substituted for the supplier's reference. [1]

## Selling price and your markup

The supplier documents monetary amounts as integer **kobo**, not naira. For display, divide `price_minor` by 100. Keep monetary calculations in integer kobo rather than floating-point naira. The documentation's example `160000` kobo represents ₦1,600; that is an example, not a verified current price. [1]

The admin pricing page should distinguish supplier cost from customer selling price. It can support a fixed naira addition, a percentage markup, or an explicitly entered retail price. There should be no invented default profit amount. Supplier cost, markup rules, and estimated margin stay admin-only; customers see the final retail unit price and order total.

The general integration guide says `rank_price_minor` is the account's charged price when present, but the Logs examples show only `price_minor`. The exact Logs cost/discount behavior therefore needs validation with a non-empty catalog and a confirmed supplier response before margin calculations are trusted. [1]

Before purchase, Emmyjosh should refresh or validate the supplier quote and quantity, then snapshot the accepted supplier cost and retail price on its own order. A price increase must not silently change the customer's confirmed total. Supplier wallet funding and customer Emmyjosh wallet funding are separate balances.

## Duplicate-order and lost-delivery risks

### Keep one idempotency key for one logical order

The documentation requires a unique key for each new `POST /orders`, then reuse of the **same key** when retrying that same order. It describes HTTP 409 while a same-key order is processing, and advises retrying temporary failures with the same key. [1]

However, the supplied PHP `buyLogs()` and Python `buy_logs()` convenience methods generate a fresh key internally on every invocation. Calling either helper again after a timeout would not be an idempotent retry. Do not copy that behavior unchanged. Emmyjosh should generate and persist its supplier key with the local order before the first supplier request, then reuse it for recovery.

The supplier docs do not establish the key's retention period, payload-mismatch handling, concurrency guarantees, or whether a replay includes delivered credentials. These are questions for the supplier, not verified API guarantees. [1]

### Do not equate `completed` with safely delivered stock

The Logs response example shows:

```json
{
  "order": {
    "number": "MC260913LOGS01",
    "status": "completed",
    "total_minor": 160000
  },
  "delivery": {
    "lines": ["example account-delivery string"]
  }
}
```

The example is documentation only. It does not prove that every completed response includes delivery or that the number of delivered lines always equals the quantity ordered. Treat `delivery.lines[]` as opaque sensitive values, rather than assuming every line can safely be split into a username and password using one delimiter. [1]

The documented `GET /orders/{number}` example includes order number, status, and total, but **does not define a delivery field**. There is no documented Logs-specific credential-recovery endpoint. If the first purchase response is lost, the current docs do not establish how Emmyjosh can recover the customer's delivery without risking a second purchase. This must be clarified before production fulfillment. [1]

Emmyjosh should store confirmed delivery encrypted, attach it to the correct local order, and reveal it only to that order's authenticated owner. Credential payloads must be excluded from public catalog responses, audit records, application logs, analytics, and routine support views. This applies to supplier stock and your own authorized stock.

## Quantity, catalog, and failure handling

The Logs examples include `stock` and sometimes `min_qty`, but the reviewed documentation does not define a complete Logs maximum-quantity or partial-fulfillment contract. Refresh availability before purchase and enforce returned constraints. Do not advertise a stock count as reserved or guaranteed merely because it appeared in a cached catalog. [1]

The formal Logs operation declares no query parameters, while the PHP/Python catalog helpers send `page` and optional `category`. Pagination and server-side category filtering are therefore not consistently specified. The currently empty sandbox response cannot resolve this inconsistency. Do not implement a guessed pagination loop or assume an empty page means the entire supplier catalog is empty. [1]

The guide documents 60 requests per minute per key, with 20 per minute for `POST /orders`. Cache catalog reads and use bounded retries/backoff rather than retrying indefinitely. [1]

HTTP 401 represents authentication failure; 403 can indicate an unavailable module or insufficient key permission; 404 can indicate a missing order; 409 can indicate an in-progress idempotent request; and 422 covers business/validation failures such as insufficient funds or unavailable stock. Errors may use top-level `message`, with field details in `errors`. Emmyjosh's existing browser adapter primarily reads `error`, so the supplier adapter must support both shapes instead of losing the useful message. [1]

The guide says a 422 was not charged or was refunded, but does not describe a Logs refund reference, timing, partial refund, replacement, dispute endpoint, or reconciliation mechanism. Number-session cancellation/refund endpoints are for OTP numbers and must not be used for Logs. Generic 500/network timeouts remain uncertain outcomes: reconcile the existing order and preserve its idempotency key rather than declaring it failed and buying again. [1]

## Admin page for your own authorized Logs

Your requested admin page should support creating and editing a social-platform product, its description, retail price, status, and authorized stock. Donmarketplace-sourced and own-stock products need explicit source labels. Social platforms are subcategories or filters within the existing **Logs** category, not additional top-level marketplace categories.

Supplier products need a supplier product ID mapping and an admin-controlled retail-price rule. Own-stock products need protected inventory entry/import, authorization/source records, stock validation, and encrypted delivery storage. Imported login material must not be placed in browser local storage or plain audit logs.

The uploaded Express API already has server-side admin role checks for product creation/editing and inventory addition. However, its current inventory stores only `stockReference`. Its order schema has no supplier order mapping, persistent supplier idempotency key, or protected delivery relation. Its current customer order response does not deliver stock. These are backend changes, not just a new admin form.

The previously identified backend issues also remain: concurrent inventory reservation, decimal-safe money handling, refund-ledger credits, webhook reconciliation, secure cross-site sessions/CSRF, and seeded administrator credentials. A supplier API connection does not fix those automatically.

## What is needed before order testing

First, have Donmarketplace make at least one **buyable sandbox Logs product** available for this key, or provide its documented sandbox fixture procedure. It should have a valid ID, quantity rules, cost, and synthetic delivery behavior. Do not substitute a documentation example ID blindly.

Ask the supplier to confirm whether delivery can be retrieved after a lost purchase response or replay, and whether it is one-time. Also confirm quantity/partial-delivery rules, refund/replacement behavior, the authoritative cost field for Logs, and the idempotency retention and replay contract.

After that, an explicitly sandbox-only order test can validate fulfillment without claiming production readiness. A live key, real stock purchase, or supplier-wallet funding is a separate action and was not authorized or performed in this review.

The supplied key is stored securely, but its saved platform scope is `all`, not a Development-only override. Integration code must explicitly require a test key and sandbox mode for this stage. Do not infer that the setting makes production supplier access safe. Because the test key was originally shared in chat, rotate it before long-term use; no key was revoked during this review.

**Current conclusion:** sandbox authentication and read-only Logs access are verified. A complete Logs reseller connection, markup checkout, own-stock delivery, and production ordering are **not yet implemented or tested**. Keep the original Emmyjosh logo and colors unchanged while adding those features.

## References

[1]: https://donmarketplace.com/api/v1/docs "Donmarketplace authenticated API documentation, including Logs operations and integration guides"
[2]: https://donmarketplace.com/api/v1/catalog/logs "Donmarketplace Logs catalog, authenticated sandbox response observed 14 November 2026"
[3]: https://donmarketplace.com/api/v1/services "Donmarketplace enabled-service flags, authenticated sandbox response observed 14 November 2026"
