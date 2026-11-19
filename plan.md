# Emmyjosh Logs Marketplace — implementation plan

**Status:** Approved by the user; keep the reference logo and brand colors unchanged. The authorized checkout/provider extension is implemented; customer-owned stock checkout is enabled behind server validation, while external provider purchases/funding remain disabled by default.

## Scope and approach

Build the responsive marketplace website shown in the supplied 13-screen reference and described in the final project documentation. The first deliverable will be a working front-end prototype: public landing, login and registration, customer dashboard, marketplace and product details, wallet/deposit, orders, transactions, profile/settings, notifications, About/Support, mobile navigation, and a separate administrator area with the documented management sections. Preserve the two approved categories—Logs and Virtual Numbers—and the orange, cream, white, and deep-brown brand palette.

Use vanilla HTML, CSS, and JavaScript to match the documented frontend stack. Run the customer API and encrypted administrator tools through the same Express/MySQL server; retain Prisma for the customer ORM and versioned root SQL for additive schema setup. Organize the frontend as a maintainable static project with shared styles, reusable page/navigation rendering, API clients, and clearly isolated demo data. No frontend bundle may contain provider credentials.

The site uses the same-origin `/api/v1` customer API by default and retains an explicitly labelled demo mode for example balances/orders. A click, redirect, spinner or request is never represented as verified payment or fulfillment; custom-owned stock checkout requires a signed-in customer, server-side pricing/stock validation, explicit confirmation and an authoritative response. Customer delivery is shown only for the account owner after confirmed completion. Donmarketplace supplier purchase and PocketFi transfer-credit switches remain disabled pending external contract/merchant confirmation; no provider credentials ship in source.

Marketplace content must preserve the requested category names while avoiding listings or language that facilitates stolen credentials, compromised accounts, unauthorized access, or account abuse. Example listings and copy will be framed around lawful products/services only.

## Design direction

- **Design movement:** Warm, conversion-focused African digital commerce, following the user's supplied interface reference.
- **Core principles:** Clear hierarchy; trustworthy money-related states; consistent orange/brown brand cues; responsive navigation and readable forms.
- **Color philosophy:** Orange signals action and energy; deep brown anchors trust; cream and white keep product and account surfaces calm. Use green/amber/red only for verified success, pending, and error states.
- **Layout paradigm:** Spacious landing page with a split hero; compact app shell for account pages, with persistent desktop navigation and a collapsible mobile menu.
- **Signature elements:** Orange-to-amber action buttons; rounded white cards on warm cream; a small shield/check motif for trust and verified states.
- **Interaction philosophy:** Direct feedback, visible loading/empty/error states, confirmations for purchases/settings, and no success claims without an API success response.
- **Animation:** Restrained short transitions for menus, tabs, and card feedback; respect reduced-motion preferences; no animation that disguises pending financial state.
- **Typography system:** Inter or a similar clean sans serif for interface text, with bold compact display weights for headings and prices.
- **Brand essence:** A focused, approachable marketplace for lawful digital services; personality: clear, energetic, dependable.
- **Brand voice:** Practical and reassuring. Example lines: “Your digital services, in one place.” “Funding is only marked complete after provider verification.”
- **Wordmark and logo:** Use the Emmyjosh Logs logo artwork from the supplied reference as-is. Do not redraw, replace, or alter its mark, spelling, proportions, or colors.
- **Signature brand color:** Emmyjosh orange, using the documented `#F47713` with a deeper orange for hover/action emphasis.

## Project structure

- `index.html` — application shell and document metadata.
- `css/style.css` — responsive tokens, layout, components, and page-specific styles.
- `js/app.js` — route selection, navigation, and event wiring.
- `js/api.js` — `/api/v1` client, API-base configuration, and safe error handling.
- `js/data.js` — explicitly labelled preview-only sample data and UI helpers.
- `assets/` — brand/hero assets used by the landing page.
- `server.js` — minimal local/Preview static server on the configured port.
- `public/manus-routes.json` — route manifest synchronized with the page routes.

## Delivery workflow

After approval, register JavaScript, HTML, and CSS diagnostics; create the detailed outcome checklist; generate any planned homepage hero asset; implement the site and page flows; start the server on the configured Preview port; check the route manifest and run focused code checks; then save the finished work as a Manus checkpoint. Publication is not included unless the user separately requests it.

## Inherited backend findings and current boundaries

The original stock-race, floating-point checkout/refund, duplicate wallet-credit, public administrator fallback and missing CSRF/session protections were corrected in the authorized extension. A database-level test uses a disposable loopback MariaDB to verify last-unit concurrency, stable order replay, insufficient-balance rollback, exactly-once refund and inventory quarantine. Customer authentication and supplier/payment adapters also have synthetic security tests. The active-number dashboard count now filters completed customer orders and the virtual-number product category. Do not confuse tests with live supplier/merchant verification: Donmarketplace sandbox stock was empty, provider purchase switches are off, and PocketFi's published transfer example does not distinguish final success from failed/reversed events.

## Approved extension — 14 November 2026

Build the admin pricing and custom authorized Logs upload system now, with a working website Preview. Preserve original Emmyjosh brand and existing customer API adapter. Add a same-origin Express/MySQL admin extension under `/api/admin-tools`, with persistent product records, one-of fixed/percentage/manual pricing rules at product/platform/default scopes, integer-kobo calculations, authenticated admin sessions, encrypted JSONL upload staging and atomic/idempotent commit, masked stock/import/audit screens, and a customer-safe own-stock catalog. New frontend modules `js/admin-tools.js` and `css/admin-tools.css` own these pages and mount within the existing route app. New backend modules live in `backend/`, with versioned additive SQL migrations and isolated unit tests. Preserve the supplied original backend in a separate `legacy-api/` directory for portable handoff and future customer-wallet integration; do not expose it as a static asset.

Use project-managed MySQL for durable administrator data; never store stock secrets in browser storage. Initial administrator credentials and an inventory encryption passphrase/key are supplied securely by the user, never seeded with a public fallback. Restore real admin sessions via a same-origin session endpoint; require CSRF tokens for writes. Secure Preview cookies use SameSite=None; Secure, with explicit plain-HTTP local handling. Credentials/encryption material remain external to the source ZIP.

Admin-owned Logs are available in the customer catalog and can be purchased through the same transactional customer wallet/order records; owner delivery is protected and only follows server-confirmed completion. Supplier Logs catalog sync is sandbox/read-only because no buyable supplier stock was present and delivery recovery remains unverified. Donmarketplace purchases, 5sim/SMSbower paid allocations and PocketFi automatic transfer credits are disabled by default. Keep clear availability/checkout labels; never simulate real supplier stock, number allocation, payment or delivery. Use synthetic fixtures and isolated test storage only; preserve user records.

Serve the frontend and admin API together on the existing port 3000. Restrict static serving to public frontend assets; backend source, SQL, secrets, fixtures, and project metadata must not be HTTP-accessible. Prepare a container declaration for future portability/publication, but do not publish. Keep `hideManusBadge:true`. Deliver a source ZIP containing code, assets, migrations, lockfile and setup instructions, excluding keys, private stock, database dumps, node_modules and Git data.

## Authorized extension — unified checkout and provider setup

Start from the user's latest ZIP while excluding private .env files and installed dependencies. Keep the original logo/colors and publication off; deliver a clean updated source ZIP. Root additive SQL setup is the database migration authority; Prisma remains the customer ORM, not a mechanism to reset/push administrator tables.

Bridge encrypted admin-owned inventory into legacy customer Order/Wallet records using the same product ID for the customer Product mirror. Add durable checkout metadata, allocations, owner-only encrypted order delivery and persistent request/supplier idempotency. Lock stock and wallet rows, verify allocation counts and use exact minor-unit money. Full wallet refunds credit once and quarantine allocated/revealed stock rather than reselling credentials.

Add server-only Donmarketplace Logs catalogs, pricing/sync, order/recovery adapters. Provider 1 is 5sim and Provider 2 SMSbower with country/service quotes and activation/SMS/finish/cancel adapters. Leave blank separate key fields and explicit currency conversion/markup controls. No blind retry or provider failover after uncertain allocation. Unknown delivery/payment results remain reconciliation, never fabricated completion or automatic refunds.

Implement PocketFi from developer.pocketfi.ng: documented Bearer auth, virtual-account body, raw-body HMAC-SHA512 signature and duplicate-safe retryable wallet credit. Document inconsistent base summaries and missing final-transfer semantics. Until that merchant contract is confirmed, ambiguous signed notifications are retained but do not credit real wallets. Provider switches default disabled; no real external purchase or funding operation is performed during development.

Preserve existing email/password auth with secure cookies and CSRF, visible customer/admin logout and session cache cleanup. Add an accessible orange branded spinner with reduced-motion support for real page/request pending states, order delivery/session pages, and authenticated admin refund/reconciliation controls.

New modules: backend/commerce/ owns checkout/refund/coordinator; backend/providers/ owns provider transports; additive backend/migrations/ owns schema; legacy-api/src/ keeps customer route compatibility/PocketFi; js/ keeps existing shell and enhanced delivery/number/loading UX; docs/ records sourced provider limitations/environment setup; tests/ verifies financial/provider invariants without managed financial test writes. Fix clean dependency installs, Prisma generation, Docker/config routing and source export of all migrations.
