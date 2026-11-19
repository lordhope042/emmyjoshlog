Emmyjosh SMSBower response diagnostics patch

Included replacement:
- backend/providers/smsbower.js

What changed:
- Logs SMSBower non-JSON responses with the API action, HTTP status, body type, body length, and a short sanitized preview.
- Logs non-2xx SMSBower responses with the same safe diagnostic fields.
- Redacts credential-like values and phone-like numbers from the logged preview.
- Marks a non-JSON getNumberV2 response as an unknown purchase outcome. This is important because the provider may have allocated a number even when its response format is unexpected.
- Does not retry getNumberV2 and does not issue a second purchase.
- Keeps successful allocation normalization for activationId/id and phoneNumber/phone/number.

Install:
1. Back up the current backend/providers/smsbower.js.
2. Replace it with the file at backend/providers/smsbower.js in this ZIP.
3. Restart the backend process.
4. Reproduce only a safe catalogue request first. Do not repeat the affected number purchase merely to generate logs.
5. If a new SMSBower purchase is later authorized after checking the existing order, inspect the backend terminal for lines beginning [SMSBower].

The diagnostic log preview is deliberately limited and sanitized. Do not add API keys, full request URLs, authorization headers, or raw provider credentials to logs.

Important:
- This patch cannot recover the activation reference for an existing order where provider_ref is NULL and no session was saved.
- It cannot establish whether SMSBower allocated that earlier order. Provider-side activation history or support reconciliation is still required.
- No live SMSBower API call or live purchase was performed as part of this patch.
