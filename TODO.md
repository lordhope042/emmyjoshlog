# Emmyjosh Logs Marketplace — outcomes

## 1. Public entry, login, and registration

- The landing page introduces Emmyjosh Logs Marketplace, explains the two available categories, shows the main benefits and lawful-use/service information, and links to registration, login, and marketplace entry points.
- Login provides email address or phone number, password, and a remember-me option if supported by the session design. Registration provides full name, email address, phone number, password, and confirm password.
- If the customer API is unavailable, the interface clearly distinguishes demo/example state from real authentication and never claims an account was created or authenticated.

**Status:** Landing, registration, login, logout and session restoration use the same-origin customer API. API/session cases are covered by synthetic tests; no real customer's account was used for development.

## 2. Marketplace and product details

- The initial marketplace navigation contains exactly two categories: Logs and Virtual Numbers. Do not add categories.
- Users can search products, filter by category, sort by supported attributes, view availability, and open product details.
- Product details present name, category, description, price, availability, delivery information, purchase conditions, and applicable refund/cancellation information. Ratings or availability not returned by the API are shown as unavailable/unconfirmed, not invented.
- Before an authenticated customer submits a live order request, the interface clearly explains that the connected API may debit the wallet and asks for explicit confirmation; the server response, not the click, supplies the order state.
- Only one live order request can be in flight at a time; duplicate clicks are blocked until the server response resolves.
- Example content is preview-only and must not advertise stolen credentials, compromised accounts, unauthorized access, or other account-abuse products. Use lawful product/service descriptions.

**Status:** Customer pages are connected to the `/api/v1` same-origin API. Admin-owned Logs products can use transactional owned-stock checkout; supplier availability/checkout remains gated as recorded below. No live customer purchase was made during development.

## 3. Wallet and deposit experience

- The wallet view includes balance/currency, dedicated virtual-account status and details when available, account-number copy action, funding instructions, and recent wallet activity.
- The documented account flow is customer-initiated from Wallet after sign-in, asks for the required phone number, asks the customer to confirm before contacting a configured provider, returns an existing account when one exists, and otherwise requests account creation through the backend.
- Deposit states distinguish pending from verified. The interface never treats a browser redirect, click, or screenshot as proof of payment, never fabricates a live balance, and shows a funding success state only after an authoritative API response.
- Until the API is reachable and its PocketFi contract is verified, the first deliverable remains a clearly labelled prototype/demo and does not claim real funds were received.

**Status:** Wallet balance and transaction history are API-backed. Virtual-account and deposit states require an enabled provider; PocketFi credit remains off until its final/failed/reversed webhook contract is confirmed. No real funds were requested or credited.

## 4. Customer account pages

- The customer dashboard presents wallet balance, total orders, account/product summary, unread-notification count, recent activity, and a marketplace shortcut.
- Orders/history show order reference, product name from the backend order-item snapshot when available, date, amount, status, and order detail; transaction history shows reference, type, description, amount, date, and status.
- If an order response omits category snapshots, retain the complete All orders list, avoid guessing a category, and explain that category filtering depends on backend metadata.
- Profile/settings supports permitted profile information, password-change, notification-preference, security, and support entry points; sensitive changes are not presented as completed without authoritative confirmation.
- Notifications show type, title/body, timestamps, read/unread state, and a mark-read action. About/Support provides marketplace information, a support form/history entry point, and terms/privacy/refund links or clearly marked placeholders.

**Status:** Dashboard, marketplace, orders, transactions, profile, notifications, support/about and security/logout routes are implemented against the same-origin customer API. External account/payment actions remain gated rather than simulated.

## 5. Separate administrator area

- Provide a separate administrator UI area for dashboard summaries, customer management, products, management view of exactly the two approved categories (Logs and Virtual Numbers), inventory, orders, transactions, virtual-account status, notifications, support, audit-log view, and safe settings, following the project documentation.
- As a frontend prototype, admin pages do not replace backend role checks or claim the UI itself provides security. Sensitive actions display confirmation and do not claim persistence if the API is unavailable.

**Status:** The secure Logs-management area—products, markup, authorized inventory/import, supplier mappings, inventory and audit views—is implemented with real server-side roles, sessions and CSRF. Broader customer/payment/notification/support administration remains outside the current dedicated admin-tools workspace.

## 6. Responsive UI and brand fidelity

- Keep the supplied logo artwork and brand colors as shown in the reference; use the documented orange `#F47713`, deep brown, warm cream/off-white, and white direction without substituting a new logo or palette.
- Use consistent navigation, spacing, buttons, and form controls. Support desktop, tablet, and mobile layouts, with a usable mobile navigation pattern. Preserve the exact supplied logo artwork and the generated hero image in the static build; the local development server may serve bundled copies for the project-storage image URLs.
- Provide visible loading, success, empty, validation-error, network-error, and permission-error states. Support keyboard use and visible focus. Respect reduced-motion settings.

**Status:** Responsive layouts retain the supplied logo and brand palette. Branded accessible loading/error/success states and reduced-motion handling are in place. Platform badge hiding is enabled; publication remains off.

## 7. Configurable API client and honest demo mode

- Keep the supplied `/api/v1` Express API as the integration contract. Support its documented authentication, profile/dashboard, categories/products, wallet/virtual-account, transactions, orders, notifications, and support routes through a configurable non-secret API base URL.
- Send credentialed requests where needed. Restore a configured session through `/auth/me`; on an unauthenticated or expired session, show a sign-in/permission message and do not show demo customer identity or fetch protected customer records. Keep provider secrets out of browser code. If the API is not reachable/configured, show explicitly labelled example data and safe demo interactions; never turn an attempted click into a verified financial or order outcome.
- Cross-site cookie login requires compatible backend CORS, secure cookie, and CSRF behavior; the current supplied backend settings are not assumed to be production-ready.
- Catalog request failures are distinct from an empty catalog and offer an explicit retry action.

**Status:** Customer/admin APIs are hosted same-origin in the unified Express service. Secure session/CSRF and catalog/error paths are covered by isolated tests. Provider credentials are server-only; no live third-party purchase/funding calls were made.

## 8. Backend production blockers and transaction integrity

- Do not treat an API click, ambiguous timeout, or provider redirect as a completed order/payment. Supplier, number-provider and external funding operations remain disabled until their provider-specific contracts and reconciliation paths are confirmed.
- Retriable or ambiguous payment/provider events must be idempotent and reconcilable; inventory reservation must prevent concurrent double-sale; money arithmetic must be minor-unit/decimal-safe; refunds must create a linked wallet credit/ledger entry exactly once; cookie auth must be secure and CSRF-protected; PocketFi payloads/signatures/acknowledgement behavior must be verified from active merchant documentation; seeded administrator credentials must not retain a public fallback.
- The active-number dashboard count filters the completed customer-order relation and the virtual-number product category.
- Preserve database records with additive setup; never reset the user's database or use an unreviewed schema push.

**Status:** The complete automated suite passed 50/50, including the isolated MariaDB test for last-unit concurrency, idempotent replay, insufficient-balance rollback, exactly-once refund and quarantine. Customer checkout retry keys survive reload by customer/intent scope; a session-expiry 401 invalidates concurrent private requests. Supplier purchase and number allocation are gated; PocketFi final transfer semantics remain unconfirmed and credit stays disabled. These results do not constitute a live-provider or production payment certification.

## 9. Project delivery

- Keep the route manifest synchronized with the implemented pages and ensure it is served as JSON before starting the preview server.
- Run the configured language diagnostics and focused project checks, start the site on the configured Preview port, and save the finished change as a Manus checkpoint.
- Publication is not included unless the user separately requests it.

**Status:** The application builds, the 32-route manifest is served as JSON, and `/health` returns 200. The full suite passes 50/50 including isolated SQL integration. The code has been pushed to canonical `origin/main` and the Preview is healthy. The push command did not surface a separate platform version-history receipt, so no receipt is claimed here. Automatic/public publication is not requested.

## 10. Real administrator access and durable Logs products

- Build the admin pricing and custom Logs upload system now and provide the website Preview, retaining the original logo and colors.
- Persist products and rules in MySQL. Admin login uses the user's securely supplied bootstrap email/password, hashed passwords, random revocable sessions, server-side role checks and CSRF on every write; no public demo administrator or authentication bypass.
- Products contain platform, title, description, terms, minimum/maximum quantity, draft/active/archived status, source (own stock or Donmarketplace), and known/unknown acquisition cost. Social platforms stay filters within Logs; top-level categories remain Logs and Virtual Numbers.
- Supplier mappings stay sandbox/read-only until a valid returned product, supplier order status and delivery/reconciliation contract are verified. Admin-owned stock may be sold only through the transaction-safe customer checkout described below.

**Status:** Implemented using the configured MySQL database and secure bootstrap admin. Same-origin session, CSRF-protected writes, role checks, and pricing are covered by tests. Donmarketplace supplier purchase remains disabled.

## 11. Admin markup pricing

- Support mutually exclusive fixed addition, percentage markup, and manual selling-price rules. Product rule overrides platform rule, which overrides the default Logs rule; apply only one rule, never compound scopes.
- Calculate with integer kobo and percentage basis points, rounding upward to one kobo. Validate values and reject below-known-cost selling prices. Unknown cost is not zero: manual price is permitted but margin is unavailable.
- Display server-confirmed unit price and estimated gross markup, applied scope/version, and known cost. Customer-safe catalog responses omit acquisition cost and pricing rules. Changes are audited and existing order-price snapshots are not rewritten.

**Status:** Implemented; isolated pricing tests verify fixed/percentage/manual modes, integer kobo, known/unknown cost and below-cost rejection. Scoped rule resolution and saved-rule calculator are connected; customer catalog responses redact cost/rules.

## 12. Custom Logs entry and encrypted JSONL upload

- One uploaded record is one inventory unit. Support structured single-unit entry and UTF-8 JSONL bulk uploads (one object with payload per line), preserving secret values exactly and avoiding colon splitting.
- Enforce 2 MiB/1,000-record limits, required account fields, reasonable payload limits, administrator authorization and duplicate detection within uploads and existing stock. Reject malformed/oversized input safely without logging sensitive content.
- Workflow: upload, validation, masked preview with line/count/error categories, explicit confirm, atomic all-or-nothing commit. Commit revalidates product/duplicates and is idempotent; stale/expired/replayed uploads cannot duplicate units.
- Persist sensitive staging/stock payloads encrypted with authenticated encryption and an external versioned encryption secret. Do not return plaintext, ciphertext, keys or fingerprints in inventory/admin/audit responses; purge expired staging secrets. Audit actor, IDs/counts/status only.
- Stock screens show available/reserved/sold/quarantined counts and batch history. Public catalog may list active own-stock products with valid prices and availability, but never exposes credentials or claims fulfillment not confirmed by the server.

**Status:** Implemented; isolated HTTP tests verify masked validation, encrypted payload round-trip, ownership, malformed/duplicate rejection, expiry, atomic rollback and idempotent commit replay. No private account stock was uploaded to the project database during development.

## 13. Private portable delivery

- Keep the Manus badge hiding setting enabled and leave automatic publication off. Do not publish the user's personal work.
- Save the delivered implementation checkpoint, provide a healthy Preview, and deliver the requested portable ZIP with frontend/backend code, migrations, lockfile, assets, synthetic tests and setup notes.
- Exclude API/encryption/session secrets, private account inventory/delivery, databases, request captures, node_modules and .git. Preserve required third-party licenses and the original supplied backend for future integration.

**Status:** Generated and integrity-checked the 112-file source-only ZIP with schema, migrations, locks, original logo, assets, code and tests; exporter secret scans and archive inspection found no `.env`, private inventory, DB dump, `node_modules` or Git history. The source is pushed to `origin/main`; badge hiding is enabled, automatic publication is off, and the website remains private/unpublished. The agent session did not surface a separate version-history receipt.

## 14. Legacy checkout bridge, stock reservation and wallet refunds

- Each authorized admin-owned Logs product is mirrored to the customer catalog using the exact same product ID; supplier listings keep their own provider namespace and are not confused with owned stock.
- A signed-in customer submits product ID, quantity, current server-listed unit price and a stable idempotency key. The server rechecks the saved product/pricing/stock and performs wallet debit, row-locked inventory reservation, order snapshot and delivery allocation in one database transaction; insufficient balance or stock leaves both wallet and stock unchanged.
- Two customers cannot buy the last unit concurrently. A repeated identical idempotency request returns the original order; reusing a key for different account or order content is rejected. A lost/uncertain response must not create a second logical purchase.
- A full authorized refund restores the original wallet debit once, records one refund ledger entry, transitions the order to refunded and quarantines/disables any reserved, sold or previously revealed credentials instead of reselling them. External supplier orders are not refunded merely because an API request timed out.
- A customer can reveal sensitive credential delivery only for their own server-confirmed COMPLETED order, after an explicit warning and confirmation. Delivery remains memory-only and is cleared on logout/session expiry; pending, failed, cancelled or refunded orders do not reveal it.

**Status:** Integrated and validated with the isolated disposable MariaDB SQL test plus the frontend regression suite: last-unit concurrency, idempotent replay (including after reload), insufficient-balance rollback, exactly-once refund, inventory quarantine, owner-only delivery and session invalidation passed. No test writes targeted managed/live database data.

## 15. Donmarketplace Logs, 5sim, SMSbower and PocketFi setup

- The Donmarketplace integration is restricted to its Logs catalog and documented `/api/v1` API. Admin can sync/map supplier Logs, save retail rules and review stock/terms. Customer supplier quotes must use a valid active mapping and current supplier stock; supplier cost is not exposed as customer price.
- Donmarketplace sandbox catalog reads work with a secret key, but the reviewed sandbox had no buyable Logs stock. Supplier purchase switches default off; the adapter refuses live mode. Unknown supplier order/delivery outcomes stay in reconciliation with the original idempotency key; there is no automatic second purchase, blind failover or false refund.
- Provider 1 is 5sim and Provider 2 is SMSbower. They use separate environment keys, explicit enable/purchase switches, provider currencies, exchange-rate inputs and markup settings; no currency is inferred from an ambiguous amount. Number purchase, status/SMS refresh, finish and cancel use the selected configured provider only; uncertain allocations do not trigger a second provider request.
- PocketFi's Nigerian merchant adapter uses server-only Bearer credentials, raw-body HMAC-SHA512 webhook verification, original provider references, duplicate-safe transactional wallet credit and explicit settlement/gross policy. Because the official transfer example omits a reliable final event discriminator, ambiguous transfer events remain held and `POCKETFI_TRANSFER_EVENTS_CONFIRMED` stays false until the merchant confirms final/failed/reversed payloads.
- Provider secrets and merchant values remain empty in `.env.example` and outside the ZIP. Integration code is tested with synthetic fixtures only; development did not buy supplier Logs/numbers or process a live payment.

**Status:** Adapters, environment placeholders and admin configuration are implemented. Donmarketplace sync is read-only, provider paid-purchase switches and PocketFi credit remain disabled pending user-supplied credentials, provider/currency details and merchant confirmation.

## 16. Customer session lifecycle and loading feedback

- Customer and admin logouts clear private in-memory data; late requests, old account responses or CSRF token fetches cannot restore data after a session/API-base change.
- Session expiry clears private customer caches and returns the interface to sign-in. Customer order delivery is owner-only and protected; an authenticated request or API response is not displayed as completed checkout unless the server reports that state.
- API/page pending work displays the branded accessible loading indicator. It dismisses on success, failure, abort and timeout and respects reduced-motion preferences.

**Status:** Implemented; regression tests cover stale request/logout handling, reload-safe checkout idempotency, expired-session invalidation, cross-account scope and CSRF-only retry. Owner-only delivery appears only after confirmed completion.

## 17. Portable local development, SQL, source ZIP and Preview

- The root Express server serves the frontend, customer API at `/api/v1` and admin API at `/api/admin-tools` on one local port. Root migrations remain the additive schema authority; local setup never uses Prisma `db push` or resets user tables.
- Document Windows PowerShell and Linux/macOS startup paths, `.env.example` value names, MySQL setup, database migrations, customer/admin sign-in, provider safety defaults and network/package-manager recovery. No `.env`, API key, real stock, database dump, `node_modules` or Git history may be included in the export ZIP.
- Provide the current complete manual MySQL schema and the runnable source ZIP. Keep the website Preview available; do not publish it without a separate request.

**Status:** Windows/Linux/macOS setup instructions, blank env template, complete migration-matched MySQL schema, verified source ZIP, successful build and healthy Preview are ready. The source is pushed to canonical `origin/main`; no separate platform version-history receipt surfaced in this agent session. The Preview stays private and no publication was requested.
