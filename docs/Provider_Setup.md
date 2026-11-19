# Provider setup and financial safety

All credentials belong in the **project-root `.env`**, not browser JavaScript, SQL, Git or source ZIP. Copy `.env.example`, supply your values locally and restart the server after any change. All purchase/funding switches default off. The provider adapters are implemented; this is not evidence that your merchant accounts are activated or a live payment was tested.

## Donmarketplace Logs only

Use `DONMARKETPLACE_API_KEY` (or the existing sandbox-only alias `DONMARKETPLACE_SANDBOX_API_KEY`), `DONMARKETPLACE_MODE=sandbox`, and the official `DONMARKETPLACE_BASE_URL=https://donmarketplace.com/api/v1`. Enable catalog reads with `DONMARKETPLACE_ENABLED=true`. In **Admin → Supplier**, sync the Logs catalog. Imported mappings start as drafts. Set a product/platform/default Logs pricing rule, review the acquisition cost/terms, then explicitly activate eligible mappings. Customer quotes must come from current supplier stock and a valid active priced mapping; missing pricing must not silently sell at supplier cost.

The reviewed sandbox had no buyable Logs stock. Do not invent products, delivery or test credentials. Purchases additionally need `DONMARKETPLACE_PURCHASES_ENABLED=true` and `DONMARKETPLACE_DELIVERY_CONTRACT_CONFIRMED=true` after the supplier confirms replay/delivery recovery. One logical purchase retains its supplier idempotency key. Timeout or missing delivery leaves a processing/reconciliation order, never an automatic second buy or false refund. The current adapter deliberately refuses live mode rather than relabeling production as sandbox.

Official source: https://donmarketplace.com/api/v1/docs . The detailed redacted review is included in the source documentation.

## Provider 1: 5sim; Provider 2: SMSbower

| Setting | Provider 1 | Provider 2 |
|---|---|---|
| API secret | `PROVIDER1_5SIM_API_TOKEN` | `PROVIDER2_SMSBOWER_API_KEY` |
| Readiness switch | `PROVIDER1_ENABLED` | `PROVIDER2_ENABLED` |
| Actual allocation switch | `PROVIDER1_PURCHASES_ENABLED` | `PROVIDER2_PURCHASES_ENABLED` |
| Provider/account currency | `PROVIDER1_CURRENCY` | `PROVIDER2_CURRENCY` |
| NGN per one provider unit | `PROVIDER1_NGN_RATE` | `PROVIDER2_NGN_RATE` |
| One markup mode | `PROVIDER1_RETAIL_MODE` | `PROVIDER2_RETAIL_MODE` |
| Markup value | `PROVIDER1_RETAIL_MARKUP` | `PROVIDER2_RETAIL_MARKUP` |

Choose `FIXED` for an NGN addition or `PERCENT` for a percentage addition. Supply positive decimal text for the rate and markup; confirm the provider's actual settlement currency with your own account. Public API price fields do not reliably establish USD/RUB/etc., so the application does not guess. Set both readiness and purchase switches to `true` only when you intend real paid allocations. Neither provider documents a sandbox; synthetic tests never use real API keys or numbers.

5sim uses the current 5SIM-protocol Bearer token and `https://5sim.net`. SMSbower documentation uses the API host `https://smsbower.page/stubs/handler_api.php`; its key is placed in a POST form body, not URL logs. Customer number selection, status/SMS refresh, finish and cancellation are available under **Virtual Numbers**. Refresh is manual, not an unattended polling bot. Allocation timeouts are uncertain side effects: do not retry with a new key or fail over to another provider. 5sim cancellation has documented refund restrictions; SMSbower cancellation alone does not prove a supplier refund.

Official sources: https://5sim.net/docs , https://5sim.net/rules , https://smsbower.app/api?page=client . Their constraints and lifecycle notes are included in `docs/providers/Virtual_Number_Provider_Contracts.md`.

## PocketFi Nigerian merchant payments

Official sources: https://developer.pocketfi.ng/docs/authentication , https://developer.pocketfi.ng/docs/api/create-virtual-account , https://developer.pocketfi.ng/docs/webhooks . This is the Nigerian merchant provider, not a similarly named crypto bot.

Set `POCKETFI_API_TOKEN` (Bearer authentication), `POCKETFI_SECRET_KEY` (only the raw-body HMAC signing key), `POCKETFI_BUSINESS_ID`, `POCKETFI_BANK=kuda` and `POCKETFI_ENABLED=true` when the merchant setup is ready. Never reuse the webhook-signing secret as the API token; they remain separate and the adapter fails closed if the Bearer token is absent. For sandbox use `POCKETFI_MODE=sandbox` and `POCKETFI_BASE_URL=https://api.pocketfi.ng/api/test`; for production the documented authentication table gives `POCKETFI_MODE=live` and `https://api.pocketfi.ng/api/v1`. The docs' overview also displays a conflicting shorter URL; the adapter follows the explicit authentication/endpoints table and validates mode/path. Palmpay is intentionally unavailable because its required NIN/BVN fields are not collected by this app.

Register **`https://YOUR-DOMAIN/api/v1/webhooks/pocketfi`** in the merchant dashboard. The documented Node example reads `http_pocketfi_signature`; `POCKETFI_SIGNATURE_HEADER` must match the actual HTTP header agreed with PocketFi. Every event needs a valid HMAC-SHA512 over the untouched raw request body. No development/mock flag bypasses authentication.

The example transfer payload omits a final status/event discriminator despite the introduction mentioning completed, failed and reversed events. Keep `POCKETFI_TRANSFER_EVENTS_CONFIRMED=false` until PocketFi confirms how to distinguish those outcomes and that the documented signed shape is a final successful credit. Ambiguous signed events are retained for reconciliation without changing balances. Changing the flag does not automatically replay previously retained events; arrange a signed merchant replay/verified reconciliation. A checkout `payment_id` is not assumed to equal a dedicated-account transaction reference.

`POCKETFI_CREDIT_BASIS=settlement` credits the net NGN settlement after fees. Choose `gross` only if you deliberately absorb provider fees. The immutable successful credit is linked to its provider reference; failed database work rolls back and remains retryable. Reusing a reference with a different account/business/amount is a conflict, not a second credit. Virtual-account create timeouts also stay uncertain: reconcile the original operation instead of requesting another account.

## Refund and stock policy

**Admin → Checkout** performs a full **customer wallet** refund, not a bank transfer. It requires a reason and confirmation and uses the original debit snapshot. Repeat requests cannot credit twice. Delivered/reserved credentials are quarantined or disabled rather than resold. External provider orders cannot be manually refunded merely because a request timed out; resolve provider acceptance/refund first. No UI message, redirect or spinner is payment evidence.
