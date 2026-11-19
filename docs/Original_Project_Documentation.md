# EMMYJOSH LOGS MARKETPLACE

## Final Project Documentation

**Project type:** Digital marketplace\
**Brand:** Emmyjosh Logs Marketplace\
**Document status:** Final project specification and frontend prototype
documentation\
**Version:** 1.0\
**Date:** November 2026

------------------------------------------------------------------------

## 1. Project Overview

Emmyjosh Logs Marketplace is a web-based marketplace where registered
customers can browse and purchase two service categories:

1.  **Logs**
2.  **Virtual Numbers**

The platform provides a customer account area for managing purchases,
wallet funds, transaction records, notifications, and personal settings.
Customers can fund their wallets by transferring money to a dedicated
virtual bank account linked to their Emmyjosh account.

The intended payment provider is **PocketFi**. Each customer should be
able to request a dedicated virtual account after registration. Once
created, that account remains associated with the customer. Incoming
transfers are confirmed by the payment provider and credited to the
correct Emmyjosh wallet through a secure server-side webhook process.

The platform will also have a separate administrator area for managing
customers, products, inventory, orders, wallet-related support issues,
and platform activity.

### 1.1 Project Goals

-   Provide a simple, responsive marketplace experience.
-   Keep the product offering focused on Logs and Virtual Numbers.
-   Allow customers to register and manage their own accounts.
-   Give each customer a dedicated virtual bank account for wallet
    funding.
-   Automatically credit wallets after verified incoming transfers.
-   Provide clear order and transaction histories.
-   Give administrators controlled tools to manage the marketplace.
-   Maintain secure financial records and prevent duplicate wallet
    credits.

### 1.2 Scope

The initial release covers the customer-facing marketplace, customer
dashboard, wallet and virtual-account workflow, order management,
notifications, profile settings, and administrator functions.

Only the two approved marketplace categories should appear in the
initial product navigation. New categories should not be added until the
business introduces those services.

**Compliance requirement:** All products and services must be lawfully
sourced and offered. The Logs category must not be used to sell stolen
credentials, compromised accounts, unauthorized access, or other
products that facilitate account abuse. Product descriptions,
eligibility, delivery and refund rules must be clear and lawful.

------------------------------------------------------------------------

## 2. Technology Stack

  -----------------------------------------------------------------------
  Layer                   Technology              Responsibility
  ----------------------- ----------------------- -----------------------
  Frontend                HTML5                   Page structure

  Styling                 CSS3                    Responsive layouts and
                                                  visual design

  Frontend behavior       Vanilla JavaScript      Interactions and API
                                                  requests

  Backend                 Node.js                 Server runtime

  API framework           Express.js              REST API and middleware

  Database                MySQL                   Persistent application
                                                  data

  Database access         Prisma ORM              Models, migrations and
                                                  queries

  Payment provider        PocketFi                Dedicated virtual
                                                  accounts and incoming
                                                  payment notifications

  Authentication          Secure server-side      Customer and
                          sessions or JWT in      administrator
                          HTTP-only cookies       authentication

  Validation              Zod or equivalent       Request validation

  Version control         Git and GitHub          Source control

  Frontend hosting        Vercel or equivalent    HTML/CSS/JS delivery
                          static hosting          

  Backend hosting         Render or equivalent    API deployment
                          Node.js hosting         
  -----------------------------------------------------------------------

### 2.1 Architecture Decision

The first frontend prototype uses plain HTML, CSS and JavaScript. The
backend should be developed as a separate Node.js/Express application
and exposed through a versioned REST API.

The frontend must never connect directly to MySQL or contain PocketFi
secret credentials.

### 2.2 High-Level Architecture

``` text
Customer Browser
      |
      v
HTML + CSS + JavaScript
      |
      | HTTPS REST requests
      v
Node.js + Express API
      |
      +--------------------+
      |                    |
      v                    v
   MySQL                PocketFi
      ^                    |
      |                    |
      +---- Verified Webhook
```

All wallet balances, payment verification, order creation, inventory
changes and administrative actions must be controlled by the backend.

------------------------------------------------------------------------

## 3. Brand and User Interface Guidelines

### 3.1 Visual Identity

The interface follows the supplied Emmyjosh Logs brand artwork.

  Design element     Direction
  ------------------ ---------------------------
  Primary colour     Orange
  Secondary colour   Deep brown
  Background         Warm cream / off-white
  Cards              White with subtle borders
  Primary buttons    Orange
  Text               Dark brown / near-black
  Success state      Green
  Pending state      Amber
  Error state        Red

Suggested design tokens:

``` css
:root {
  --orange: #F47713;
  --orange-dark: #E85F00;
  --brown: #421B08;
  --cream: #FFF8EF;
  --white: #FFFFFF;
  --text: #21150F;
  --muted: #82766F;
  --border: #F0E4D9;
  --success: #169B62;
  --warning: #B96612;
  --danger: #D94C3D;
}
```

### 3.2 UI Principles

-   Keep page layouts consistent.
-   Use the same navigation, spacing, button styles and form controls
    throughout the application.
-   Make every page responsive on desktop, tablet and mobile.
-   Provide visible loading, success, empty and error states.
-   Use accessible labels and keyboard-friendly controls.
-   Confirm important actions such as purchases, cancellations and
    account changes.
-   Do not display fabricated balances, payment confirmations or account
    numbers in production.
-   Do not expose sensitive product or customer data in public pages.

------------------------------------------------------------------------

## 4. Application Pages

### 4.1 Public Pages

#### Landing Page --- `index.html`

Purpose: - Introduce Emmyjosh Logs Marketplace. - Explain the two
available service categories. - Display the main benefits and calls to
action. - Direct visitors to registration, login and marketplace entry
points.

Main sections: - Header and navigation - Hero section - Logs and Virtual
Numbers category cards - Trust and service information - Registration
call to action - Footer and support links

#### Login Page --- `login.html`

Fields: - Email address or phone number - Password - Remember-me option,
if supported by the session design

Requirements: - Validate credentials on the server. - Use secure session
cookies. - Apply login rate limiting. - Provide a safe password-reset
process. - Do not reveal whether an email or phone number exists in the
system.

#### Registration Page --- `register.html`

Fields: - Full name - Email address - Phone number - Password - Confirm
password

Requirements: - Validate all fields on the server. - Enforce unique
email and phone values where required. - Hash passwords before
storage. - Verify contact details where required. - Create a customer
account with the default customer role. - Do not create a PocketFi
virtual account automatically unless the business later chooses that
onboarding policy. The current approved flow is customer-initiated
creation from the wallet.

### 4.2 Customer Pages

#### Customer Dashboard --- `dashboard.html`

Displays: - Wallet balance - Total orders - Relevant account or product
summary - Notification count - Recent activity - Marketplace shortcut

Dashboard figures must be retrieved from authenticated API endpoints and
must not be hardcoded.

#### Marketplace --- `marketplace.html`

The marketplace has exactly two initial categories:

1.  Logs
2.  Virtual Numbers

Features: - Search products - Filter by category - Sort by price or
other supported product attributes - View product availability - Open
product details

Products must only be shown as available when the backend confirms that
they can be purchased.

#### Product Details --- `product.html`

Displays: - Product name - Category - Product description - Price -
Availability - Applicable delivery information - Purchase conditions -
Refund or cancellation policy, where applicable

The purchase action must re-check the current price and availability on
the server. Never trust a price supplied by the browser.

#### Wallet --- `wallet.html`

The wallet page displays: - Available balance - Dedicated
virtual-account status - Bank name - Account number - Account name -
Copy-account-number action - Wallet funding instructions - Recent wallet
activity

**Dedicated virtual-account creation flow:**

1.  Customer registers and signs in.
2.  Customer opens Wallet.
3.  Customer selects **Create Virtual Account**.
4.  Customer enters the required phone number.
5.  Frontend sends the request to the Emmyjosh backend.
6.  Backend authenticates the customer and validates the request.
7.  Backend checks whether the customer already has an active virtual
    account.
8.  If one exists, return the existing account instead of creating a
    duplicate.
9.  If none exists, backend calls the PocketFi API using server-side
    credentials.
10. Backend stores the provider reference and returned account details.
11. Frontend displays the account details after successful creation.

The exact fields required by PocketFi, account eligibility, KYC
requirements, supported banks, account permanence and account retrieval
behavior must be confirmed against the merchant's active PocketFi API
documentation before implementation.

#### Automatic Wallet Funding

When a customer transfers money to their assigned virtual account:

1.  PocketFi processes or reports the incoming transfer.
2.  PocketFi sends a webhook to the Emmyjosh backend.
3.  Backend verifies the webhook signature or uses the provider's
    documented verification method.
4.  Backend validates the provider transaction reference, destination
    account, amount, currency and final payment status.
5.  Backend identifies the customer through the stored virtual-account
    mapping.
6.  Backend checks whether the provider transaction has already been
    processed.
7.  Backend creates a wallet credit and transaction record atomically.
8.  Customer's wallet balance is updated.
9.  Customer receives an in-app notification.

**Critical rules:** - Never credit a wallet based only on a browser
redirect or customer screenshot. - Never trust an unverified webhook. -
Process each provider transaction reference only once. - Store the raw
provider event or a safe audit representation for reconciliation. -
Handle duplicate and out-of-order webhook deliveries safely. - Do not
assume the transfer amount equals the wallet credit if provider fees or
business charges apply. Define the fee policy explicitly. - Provide a
reconciliation process for delayed, missing or disputed transfers.

#### Orders and Purchase History --- `orders.html`

Displays: - Order reference - Product - Date - Amount - Order status -
Order details

Suggested statuses: - Pending - Processing - Completed - Failed -
Cancelled - Refunded

Only statuses relevant to the actual delivery workflow should be
enabled.

#### Transaction History --- `transactions.html`

Displays: - Transaction reference - Transaction type - Description -
Amount - Date - Status

Suggested transaction types: - Wallet credit - Purchase debit - Refund -
Approved adjustment

Transaction records should be append-only wherever practical.
Corrections should be represented by new adjustment records rather than
silently rewriting financial history.

#### Profile and Settings --- `profile.html`

Allows customers to: - View and update permitted profile information -
Change password - Manage notification preferences - Review security
settings - Request account support

Sensitive changes should require re-authentication or another suitable
verification step.

#### Notifications --- `notifications.html`

Notification types: - Wallet deposit confirmed - Order completed - Order
status changed - Account/security notice - Support response

Notifications should have read/unread status and timestamps.

#### About and Support --- `support.html`

Provides: - Marketplace information - Contact/support form - Support
request history, when implemented - Links to terms, privacy policy and
refund policy

------------------------------------------------------------------------

## 5. Administrator Area

A separate administrator dashboard is required. It must use role-based
access control and must not rely on hiding links in the browser as its
security mechanism.

Recommended administrator pages:

  Admin page         Main functions
  ------------------ ---------------------------------------------------
  Admin dashboard    Sales, orders, wallet activity and user summaries
  Customers          Search, view and manage customer accounts
  Products           Create, edit, publish and archive products
  Categories         Manage the two approved categories
  Inventory          Manage available stock and delivery records
  Orders             Review and update order processing
  Transactions       Review wallet credits, debits and refunds
  Virtual accounts   View account status and provider references
  Notifications      Publish relevant system notifications
  Support            Review and respond to support tickets
  Audit logs         Review sensitive administrator actions
  Settings           Configure safe platform settings

Administrator actions involving money, customer access, inventory or
order status must be logged with actor, action, target, timestamp and
relevant before/after values.

------------------------------------------------------------------------

## 6. Database Design

The following is the recommended initial relational data model. Exact
columns and indexes should be finalized during backend implementation.

### 6.1 `users`

Stores customer and administrator accounts.

Suggested fields: - `id` - `full_name` - `email` - `phone_number` -
`password_hash` - `role` - `status` - `email_verified_at` -
`phone_verified_at` - `created_at` - `updated_at`

### 6.2 `virtual_accounts`

Stores each customer's PocketFi virtual-account mapping.

Suggested fields: - `id` - `user_id` - `provider` -
`provider_customer_reference` - `provider_account_reference` -
`account_number` - `bank_name` - `account_name` - `phone_number` -
`currency` - `status` - `created_at` - `updated_at`

Important constraints: - Add a unique constraint for the provider
account reference. - Add a suitable unique constraint for the account
number within the provider and currency context. - Enforce the intended
one-active-account-per-customer policy. - Store only the provider data
needed for account operation and reconciliation.

### 6.3 `wallets`

Suggested fields: - `id` - `user_id` - `currency` - `balance` -
`created_at` - `updated_at`

Use a fixed-precision decimal type for money. Do not use floating-point
types for financial balances.

### 6.4 `wallet_transactions`

Suggested fields: - `id` - `wallet_id` - `user_id` - `type` - `amount` -
`currency` - `reference` - `provider_reference` - `status` -
`description` - `created_at`

Use unique references to prevent duplicate processing.

### 6.5 `products`

Suggested fields: - `id` - `category_id` - `name` - `slug` -
`description` - `price` - `currency` - `status` - `created_at` -
`updated_at`

### 6.6 `product_categories`

Initial records: - Logs - Virtual Numbers

Suggested fields: - `id` - `name` - `slug` - `description` - `status`

### 6.7 `product_inventory`

Suggested fields: - `id` - `product_id` - `stock_reference` - `status` -
`reserved_at` - `sold_at` - `created_at`

Inventory fields must be adapted to the lawful product-delivery model.
Do not store stolen credentials or unauthorized access material.

### 6.8 `orders`

Suggested fields: - `id` - `user_id` - `order_reference` - `subtotal` -
`fees` - `total` - `currency` - `status` - `created_at` - `updated_at`

### 6.9 `order_items`

Suggested fields: - `id` - `order_id` - `product_id` -
`product_name_snapshot` - `unit_price` - `quantity` - `line_total`

Store price/name snapshots so historical orders remain accurate if a
product is later edited.

### 6.10 Supporting Tables

  -----------------------------------------------------------------------
  Table                               Purpose
  ----------------------------------- -----------------------------------
  `payments`                          Provider payment attempts and
                                      references

  `payment_webhook_events`            Idempotent webhook event processing

  `notifications`                     Customer notification records

  `support_tickets`                   Customer support requests

  `support_messages`                  Ticket conversations

  `admin_audit_logs`                  Sensitive administrator activity

  `sessions`                          Server-side sessions, if session
                                      authentication is selected
  -----------------------------------------------------------------------

### 6.11 Financial Data Rules

-   Use `DECIMAL` with a suitable precision for monetary values.
-   Use a consistent currency code, initially NGN if that is the
    confirmed operating currency.
-   Record every wallet credit and debit.
-   Use database transactions for balance and ledger updates.
-   Never allow a customer to set their own wallet balance.
-   Do not delete financial records to hide a failed or disputed
    operation.
-   Add unique constraints for payment and transaction references.
-   Use database row locking or an equivalent concurrency-safe approach
    when updating balances.

------------------------------------------------------------------------

## 7. Backend API Plan

All API routes should be versioned under `/api/v1`.

### Authentication

  Method   Endpoint                  Purpose
  -------- ------------------------- ----------------------------
  POST     `/auth/register`          Create customer account
  POST     `/auth/login`             Authenticate customer
  POST     `/auth/logout`            End session
  POST     `/auth/forgot-password`   Start password recovery
  POST     `/auth/reset-password`    Complete password recovery
  GET      `/auth/me`                Get authenticated user

### Customer

  Method   Endpoint               Purpose
  -------- ---------------------- ---------------------------------
  GET      `/users/me`            Get profile
  PATCH    `/users/me`            Update permitted profile fields
  PATCH    `/users/me/password`   Change password
  GET      `/dashboard/summary`   Dashboard summary

### Marketplace

  Method   Endpoint          Purpose
  -------- ----------------- -----------------------
  GET      `/categories`     Get active categories
  GET      `/products`       List/filter products
  GET      `/products/:id`   Product details

### Virtual Accounts

  ----------------------------------------------------------------------------------
  Method                  Endpoint                           Purpose
  ----------------------- ---------------------------------- -----------------------
  POST                    `/wallet/virtual-account`          Create or retrieve
                                                             customer's dedicated
                                                             account

  GET                     `/wallet/virtual-account`          Get current account
                                                             details

  GET                     `/wallet/virtual-account/status`   Get account status
  ----------------------------------------------------------------------------------

The create endpoint must be idempotent at the customer level: repeated
requests should return the existing active account where appropriate.

### Wallet and Transactions

  Method   Endpoint                 Purpose
  -------- ------------------------ -------------------------
  GET      `/wallet`                Get wallet balance
  GET      `/wallet/transactions`   Get wallet ledger
  GET      `/transactions`          Get transaction history

### Orders

  Method   Endpoint        Purpose
  -------- --------------- -------------------------
  POST     `/orders`       Create purchase request
  GET      `/orders`       List customer's orders
  GET      `/orders/:id`   Get order details

### Notifications and Support

  Method   Endpoint                    Purpose
  -------- --------------------------- ---------------------------
  GET      `/notifications`            List notifications
  PATCH    `/notifications/:id/read`   Mark notification as read
  POST     `/support/tickets`          Create support ticket
  GET      `/support/tickets`          List customer's tickets

### Payment Webhook

  Method   Endpoint               Purpose
  -------- ---------------------- ---------------------------------
  POST     `/webhooks/pocketfi`   Receive PocketFi payment events

The webhook must follow PocketFi's exact current signature, payload and
acknowledgement requirements. Do not invent header names or payload
fields. Confirm them from the merchant API documentation and test
environment.

### Administrator APIs

Admin endpoints should be grouped under `/admin` and protected by
server-side role checks. They should cover customer management, product
management, inventory, orders, transactions, virtual-account status,
notifications, support and audit logs.

------------------------------------------------------------------------

## 8. PocketFi Integration Specification

PocketFi is the selected payment provider for the dedicated
virtual-account workflow.

### 8.1 Required Provider Capabilities to Confirm

Before implementation, verify the following against the active PocketFi
merchant documentation and account:

-   Dedicated virtual-account creation endpoint
-   Required customer identity fields
-   Phone-number format and verification requirements
-   KYC or business onboarding requirements
-   Supported banks and currencies
-   Whether accounts are permanent or temporary
-   Whether the API can retrieve an existing account
-   Account creation response fields
-   Incoming transfer webhook event
-   Webhook authentication/signature verification
-   Transaction lookup or verification endpoint
-   Settlement timing and transfer fees
-   Sandbox/test-mode availability
-   Rate limits and error response formats

Do not begin production integration based only on assumptions or example
screenshots.

### 8.2 Account Creation Flow

``` text
Customer clicks Create Virtual Account
                 |
                 v
Frontend sends authenticated request
                 |
                 v
Backend validates phone and customer
                 |
                 v
Check existing active virtual account
          /               \
       Found             Not found
         |                  |
Return saved account    Call PocketFi
                            |
                            v
                    Store provider response
                            |
                            v
                    Return account details
```

### 8.3 Incoming Transfer Flow

``` text
Customer transfers money to assigned account
                 |
                 v
PocketFi reports incoming payment
                 |
                 v
PocketFi webhook reaches Emmyjosh API
                 |
                 v
Verify authenticity and payment status
                 |
                 v
Check provider transaction reference
                 |
          Already processed?
             /       \
           Yes        No
           |           |
       Ignore safely   Resolve customer account
                       |
                       v
                Database transaction
                - Record payment
                - Credit wallet
                - Record ledger entry
                - Create notification
                       |
                       v
                Commit transaction
                       |
                       v
                Acknowledge webhook
```

### 8.4 Wallet Credit Safety

The webhook handler must: 1. Verify the event authenticity. 2. Validate
the event type and final status. 3. Match the receiving account to one
stored for a customer. 4. Validate currency and amount. 5. Check the
unique provider transaction reference. 6. Start a database transaction.
7. Insert the payment/event record with a unique reference. 8. Credit
the wallet and create the ledger record. 9. Create a notification. 10.
Commit the transaction. 11. Return the acknowledgement required by
PocketFi.

If processing fails, the system must not partially credit a wallet.
Retry handling and reconciliation must be designed around PocketFi's
delivery and retry rules.

------------------------------------------------------------------------

## 9. Purchase and Order Processing

A purchase should be handled entirely by the backend.

Recommended process:

1.  Customer selects a product.
2.  Frontend submits product ID and quantity.
3.  Backend authenticates the customer.
4.  Backend loads the current product price and availability.
5.  Backend validates eligibility and purchase limits.
6.  Backend checks wallet funds.
7.  Backend reserves available inventory where applicable.
8.  Backend creates the order and order items.
9.  Backend records the wallet debit.
10. Backend completes the order or moves it into the appropriate
    fulfillment state.
11. Backend creates a notification.
12. Frontend displays the authoritative order result.

The order, wallet debit and inventory reservation must be protected
against race conditions and partial failure.

Refunds should be recorded as separate credit transactions linked to the
original order and debit.

------------------------------------------------------------------------

## 10. Security Requirements

### Authentication and Authorization

-   Hash passwords using Argon2id or bcrypt with a suitable work factor.
-   Use HTTPS in production.
-   Use secure, HTTP-only and appropriately configured SameSite cookies.
-   Protect state-changing requests against CSRF when cookie-based
    authentication is used.
-   Enforce role-based permissions on every protected backend route.
-   Apply rate limiting to login, registration, password recovery and
    sensitive operations.

### Input and Output

-   Validate all input on the server.
-   Use parameterized queries through the ORM.
-   Escape or safely render user-provided content.
-   Limit request body size and accepted file types.
-   Do not expose stack traces or secret configuration in production
    responses.

### Payment and Wallet

-   Keep PocketFi API secrets only in backend environment variables.
-   Verify payment webhooks using PocketFi's documented mechanism.
-   Use unique provider references and idempotent processing.
-   Never accept a wallet balance or payment status from the browser as
    authoritative.
-   Log payment failures and support reconciliation.

### Administration

-   Require administrator authentication and role checks.
-   Log sensitive administrator actions.
-   Protect account suspension, wallet adjustment, refund and inventory
    operations.
-   Consider stronger authentication for administrator accounts.

### Data Protection

-   Collect only information required for account and payment operation.
-   Restrict access to personal information.
-   Define retention and deletion rules.
-   Publish a privacy policy and terms before launch.
-   Do not log passwords, API secrets, full payment credentials or
    unnecessary sensitive data.

------------------------------------------------------------------------

## 11. Validation, Error Handling and User Feedback

Every page and API workflow should support:

-   Loading state
-   Success state
-   Empty state
-   Validation error
-   Network/server error
-   Permission error
-   Retry where safe

Examples: - Account creation pending - Virtual account successfully
created - Virtual account already exists - Payment received and
verified - Payment still pending - Product unavailable - Insufficient
wallet balance - Order processing - Order completed - Order failed or
refunded

Messages must reflect verified backend results. The frontend must not
display a success message merely because a button was clicked.

------------------------------------------------------------------------

## 12. Testing Plan

### Frontend Tests

-   Check all page links.
-   Test mobile, tablet and desktop layouts.
-   Test forms and validation.
-   Test search and category filters.
-   Test empty, loading and error states.
-   Check keyboard navigation and visible focus.
-   Check browser console for errors.

### Backend Tests

-   Registration and login validation.
-   Role-based access control.
-   Product visibility and availability.
-   Duplicate order prevention.
-   Wallet balance concurrency.
-   Payment webhook signature validation.
-   Duplicate webhook delivery.
-   Unknown virtual-account reference.
-   Invalid amount or currency.
-   Failed database transaction rollback.
-   Refund and adjustment behavior.

### PocketFi Sandbox Tests

-   Successful virtual-account creation.
-   Repeated account-creation request.
-   Invalid phone or customer data.
-   Provider timeout or unavailable response.
-   Successful incoming transfer.
-   Duplicate webhook.
-   Invalid webhook signature.
-   Delayed payment notification.
-   Failed or reversed transfer, if supported.
-   Transaction verification and reconciliation.

### Release Criteria

Do not launch wallet funding until verified payment events reliably
credit the correct customer exactly once under duplicate delivery and
retry conditions.

------------------------------------------------------------------------

## 13. Deployment and Environment Configuration

### Suggested Environment Variables

``` env
NODE_ENV=production
PORT=5000

DATABASE_URL=

SESSION_SECRET=
JWT_SECRET=

POCKETFI_BASE_URL=
POCKETFI_API_KEY=
POCKETFI_SECRET_KEY=
POCKETFI_WEBHOOK_SECRET=

CLIENT_URL=
```

Use only the exact credentials and configuration names supplied by
PocketFi. The variable names above are placeholders for the project's
configuration design.

### Deployment Steps

1.  Create the MySQL database.
2.  Configure production environment variables.
3.  Run Prisma migrations.
4.  Seed the initial Logs and Virtual Numbers categories.
5.  Deploy the Express API.
6.  Deploy the static frontend.
7.  Configure the frontend API base URL.
8.  Configure the PocketFi webhook URL in the provider dashboard.
9.  Test virtual-account creation and incoming transfer events in the
    supported test environment.
10. Run security, payment and mobile responsiveness checks.
11. Enable production traffic only after successful end-to-end tests.

### Backups and Monitoring

-   Schedule automated database backups.
-   Monitor API errors and uptime.
-   Monitor webhook delivery and processing failures.
-   Record payment reconciliation exceptions.
-   Alert administrators to repeated failed payment processing.
-   Test database restoration periodically.

------------------------------------------------------------------------

## 14. Current Frontend Prototype Files

The initial HTML prototype contains these pages:

  File                   Page
  ---------------------- --------------------------------------
  `index.html`           Landing page
  `login.html`           Login
  `register.html`        Registration
  `dashboard.html`       Customer dashboard
  `marketplace.html`     Marketplace
  `product.html`         Product details
  `wallet.html`          Wallet and virtual-account interface
  `orders.html`          Orders and purchase history
  `transactions.html`    Transaction history
  `profile.html`         Profile and settings
  `notifications.html`   Notifications
  `support.html`         About and support
  `css/style.css`        Shared styles
  `js/app.js`            Shared frontend interactions
  `README.md`            Prototype setup notes

### Prototype Limitations

The current prototype is a visual and navigation foundation only.

It does not yet implement: - Real registration or login - Database
persistence - PocketFi virtual-account creation - Payment webhook
verification - Automatic wallet crediting - Real product inventory or
fulfillment - Real purchases and refunds - Administrator dashboard and
APIs - Production-grade authorization

Displayed example balances, product prices, names and activity are
placeholder content. They must be replaced with real backend data before
launch.

------------------------------------------------------------------------

## 15. Recommended Development Phases

### Phase 1 --- Project Foundation

-   Organize frontend and backend repositories or folders.
-   Configure Node.js, Express, Prisma and MySQL.
-   Establish environment configuration.
-   Create migrations and seed the two marketplace categories.
-   Implement shared API error handling and validation.

### Phase 2 --- Authentication and Customer Accounts

-   Registration
-   Login and logout
-   Password recovery
-   Customer profile
-   Session management
-   Role-based authorization

### Phase 3 --- Marketplace

-   Product categories
-   Product listing and search
-   Product details
-   Inventory and availability
-   Admin product management

### Phase 4 --- PocketFi Virtual Accounts and Wallet

-   Confirm PocketFi merchant API requirements.
-   Implement dedicated virtual-account creation.
-   Save and retrieve customer account details.
-   Implement verified incoming-payment webhooks.
-   Implement idempotent wallet credits.
-   Build wallet and transaction views.

### Phase 5 --- Orders and Fulfillment

-   Cart or direct purchase flow, based on final business rules.
-   Wallet debit
-   Inventory reservation
-   Order processing and delivery
-   Refund handling
-   Customer order history

### Phase 6 --- Notifications and Administration

-   In-app notifications
-   Support tickets
-   Admin dashboard
-   Customer and order management
-   Audit logs

### Phase 7 --- Testing and Launch

-   Automated tests
-   PocketFi sandbox tests
-   Security review
-   Responsive UI review
-   Production deployment
-   Backup and monitoring setup

------------------------------------------------------------------------

## 16. Decisions and Items Requiring Confirmation

The following project decisions are established:

-   Brand: Emmyjosh Logs Marketplace.
-   Initial marketplace categories: Logs and Virtual Numbers only.
-   Frontend prototype: HTML, CSS and JavaScript.
-   Backend direction: Node.js and Express.
-   Database: MySQL.
-   ORM: Prisma.
-   Payment provider: PocketFi.
-   Wallet funding: customer-specific dedicated virtual account.
-   Account creation: customer initiates it from the wallet after
    registration and supplies a phone number.
-   Incoming transfers: automatically credit the matched customer's
    wallet after verified provider notification.
-   Customer and administrator interfaces: separate areas with shared
    backend and database.
-   Design direction: orange, cream, white and dark brown.

The following must be confirmed before final production implementation:

1.  PocketFi's exact virtual-account API and required customer fields.
2.  PocketFi account permanence, KYC and supported bank details.
3.  Incoming webhook signature and transaction-verification contract.
4.  Whether wallet credits are net of transfer fees.
5.  Exact Logs product types, lawful descriptions, stock and delivery
    process.
6.  Virtual Number provider, supported countries, delivery and usage
    restrictions.
7.  Refund, cancellation and support policies.
8.  Whether customers can purchase directly or must use a cart.
9.  Administrator roles and permissions.
10. Production hosting, domain and backup arrangements.

------------------------------------------------------------------------

## 17. Conclusion

Emmyjosh Logs Marketplace is designed as a focused two-category
marketplace with a customer wallet and dedicated virtual-account
funding.

The most important financial workflow is the link between a customer's
Emmyjosh account, their dedicated PocketFi virtual account and their
internal wallet. That relationship must be securely stored and enforced
by the backend. Every incoming transfer must be authenticated, verified,
matched to the correct customer and processed exactly once.

The HTML prototype establishes the visual direction and page structure.
The next major milestone is to build the backend foundation, connect
MySQL, implement authentication, and then integrate PocketFi's verified
virtual-account and webhook workflow.

**End of Documentation**
