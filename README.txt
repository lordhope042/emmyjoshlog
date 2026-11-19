EMMYJOSH — SMSBOWER PHONE ASSIGNMENT / RECOVERY PATCH

Files
- backend/providers/router.js
- backend/providers/smsbower.js

What this patch fixes
1. The number dispatch flow now keeps the provider activation reference and
   normalized session outside the try block as soon as the provider returns.
2. If the provider allocates a number but the first database completion write
   fails, the catch path retries persistence using the SAME activation ID and
   session. It never sends a second getNumberV2 purchase request.
3. If SMSBower returns an activation ID but omits the phone number, the adapter
   attaches the activation reference and partial session to the error. The
   router persists that reference for later status reconciliation.
4. The adapter normalizes SMSBower's activationId/phoneNumber response into
   id/activationId and phone/phoneNumber/number consistently.

Install
1. Back up your current backend/providers/router.js and smsbower.js.
2. Replace those two files with the matching files in this patch.
3. Restart the server.
4. Test only with a fresh quote and a controlled low-cost test if purchases
   are enabled. Do not retry an existing paid order or reuse its idempotency key
   to force another provider allocation.

Important limitation
This patch improves persistence and reconciliation. It cannot manufacture a
phone number if SMSBower did not return one, nor can it prove whether a previous
activation exists at SMSBower. Existing unassigned orders should be reconciled
using their saved provider_ref / activationId and the provider's activation
history. Do not cancel or purchase again until that activation is checked.

Validation performed
- node --check passed for both JavaScript files.
- Mocked SMSBower adapter test passed for a successful response containing
  activationId + phoneNumber.
- Mocked partial-allocation test passed: activationId is retained when the
  phone number is absent.
- ZIP integrity check passed.
- No live SMSBower API request or production database mutation was performed.
