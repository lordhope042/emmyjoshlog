# Virtual-number provider contract notes

Research date: 2026-11-14. Scope is limited to provider 1 = 5SIM and provider 2 = SMSBower. No purchase, API-key use, account login, or live API request was performed.

## Environment placeholders

The following names are implementation placeholders; Emmyjosh supplies the values. They are not provider-prescribed variable names.

```text
PROVIDER1_5SIM_API_TOKEN=
PROVIDER2_SMSBOWER_API_KEY=
```

Keep each secret server-side. Do not put either secret in browser code or logs.

## Provider 1 — 5SIM (`5sim.net`)

The official 5SIM support page says to use the new 5SIM protocol/API documentation and to select a 5SIM-protocol API key, rather than the deprecated API1 protocol. [1] The official API reference uses `https://5sim.net` and `Authorization: Bearer $token` with `Accept: application/json`. [2]

### Catalog, country, service, and cost

- Country catalog: `GET https://5sim.net/v1/guest/countries` with `Accept: application/json` and no authorization. The documented response is an object keyed by the provider country slug. Each country includes `iso`, `prefix`, `text_en`, and product keys such as `virtual18: {"activation": 1}`. [2]
- Product/operator availability: `GET https://5sim.net/v1/guest/products/{country}/{operator}`. The documented shape is an object keyed by product, for example `{"facebook":{"Category":"activation","Qty":133,"Price":21}}`; `Category` is `activation` or `hosting`, `Qty` is available quantity, and `Price` is numeric. `{country}` and `{operator}` may be `any`. [2]
- Price/availability catalog: `GET https://5sim.net/v1/guest/prices`, optionally filtered with `?country={country}`, `?product={product}`, or both. The response nests `country -> product -> operator -> {cost, count, rate}`. `cost` is a numeric two-decimal price, `count` is quantity, and `rate` is delivery percentage when available. [2]
- Currency: the API reference does not declare a currency field or an explicit currency contract for `cost`, `Price`, or `price`; the public site displays dollar signs, but do not hard-code USD from the API response alone. Store the provider amount as a provider/account-balance unit unless the account/payment documentation confirms the settlement currency. [2] [3]

### Authentication and balance

- Balance/profile: `GET https://5sim.net/v1/user/profile`.
- Headers: `Authorization: Bearer $PROVIDER1_5SIM_API_TOKEN`, `Accept: application/json`.
- Response shape includes `{id, email, balance, rating, default_country:{name,iso,prefix}, default_operator:{name}, frozen_balance, default_forwarding_number, vendor}`. `401` is documented for unauthorized access. [2]

### Activation lifecycle

5SIM documents mutating activation operations as `GET` endpoints. Preserve that documented method unless 5SIM supplies a newer contract; do not silently convert them to `POST`.

1. **Buy activation:**
   `GET https://5sim.net/v1/user/buy/activation/{country}/{operator}/{product}`

   Optional query parameters are `forwarding`, `number`, `reuse`, `voice`, `ref`, and `maxPrice`. `maxPrice` applies only when `operator=any` and takes priority over the account max-price setting. [2]

   Successful response shape:

   ```json
   {
     "id": 11631253,
     "phone": "+447350690992",
     "operator": "vodafone",
     "product": "facebook",
     "price": 21,
     "status": "PENDING",
     "expires": "2018-10-13T08:28:38.809469028Z",
     "sms": null,
     "created_at": "2018-10-13T08:13:38.809469028Z",
     "forwarding": false,
     "forwarding_number": "",
     "country": "england"
   }
   ```

   Documented purchase failures include insufficient balance/rating, invalid or missing country/operator/product, no free phones, server offline, and `500 internal error`. The reference says maximum waiting time is 15 minutes and the no-SMS timeout is 5 minutes. [2]

2. **Check status and receive activation SMS:**
   `GET https://5sim.net/v1/user/check/{id}`

   Response uses the same order object and includes `sms`, an array of message objects. The documented example message has `created_at`, `date`, `sender`, `text`, and `code`. A `404` means order not found; `500` is internal error. [2]

   Documented order statuses are `PENDING` (preparation), `RECEIVED` (SMS receipt state), `CANCELED`, `TIMEOUT`, `FINISHED`, and `BANNED`. [2]

3. **Finish:**
   `GET https://5sim.net/v1/user/finish/{id}`

   Successful response is the order object with `status: "FINISHED"`. [2]

4. **Cancel/refund path:**
   `GET https://5sim.net/v1/user/cancel/{id}`

   Successful response is the order object with `status: "CANCELED"`. The API documents errors for order not found, expired order, order already having SMS, and hosting order. [2]

   The official rules say payment is debited immediately at purchase and refunded when the order is canceled; they also describe automatic refund in some cases when no SMS arrives. The manual says activation orders normally last 5–30 minutes and may auto-cancel if no SMS arrives after about five minutes; an automatic refund can rarely take up to 15 minutes. [3] [4] The rules also say no refund is provided for an account ban or for a customer’s incorrect API/software use, and that a number already used should be handled with the provider’s ban flow rather than treated as a normal cancel refund. [3]

5. **Ban (not a refund endpoint):**
   `GET https://5sim.net/v1/user/ban/{id}`. The response is the order object with `status: "BANNED"`; the API documents the same not-found/expired/has-SMS/hosting restrictions. [2]

6. **SMS inbox caveat:**
   `GET https://5sim.net/v1/user/sms/inbox/{id}` returns `{Data:[...],Total:n}`, but 5SIM explicitly says this endpoint is only for rented numbers and does not work for one-time activation numbers. For one-time activations, use the `sms` array returned by `/check/{id}`. [2]

### 5SIM constraints and risk

The API docs do not document an idempotency key, client-supplied purchase token, or a safe replay rule for `buy/activation`. The returned numeric `id` is the order ID, but it is available only after a successful response. Therefore treat purchase as **non-idempotent/unknown on transport failure**: a timeout after the server accepted the request may have created and charged an order. Do not immediately retry the purchase or fail over to SMSBower. First reconcile using any returned order ID, `GET /v1/user/orders?category=activation` (history), balance, and provider support if necessary. Only a confirmed provider-side failure should permit another purchase. [2]

No official 5SIM sandbox/test endpoint or test credentials were found in the API reference or support instructions. Do not label a live account as test mode. The rules prohibit illegal activity, fraud/deception, impersonation, phishing/smishing, spam, social engineering, bypassing third-party security measures, and paid subscriptions; violations can lead to suspension/termination without refund. The rules also state that service access is unavailable to residents of the United States and Russia. [3]

## Provider 2 — SMSBower (`smsbower.com` documentation; API host is `smsbower.page`)

**Domain distinction:** the official client documentation is linked/served through the SMSBower site and canonicalizes to `https://smsbower.app/api?page=client` (the `smsbower.com/api/?page=client` URL serves the same documentation). The documentation explicitly says that API requests go to `https://smsbower.page/stubs/handler_api.php`; do not guess or replace that API host with `smsbower.com` or `smsbower.app`. [5]

### Authentication, catalog, and cost

- Transport: the official client page says requests may be `GET` or `POST`, and all requests use the API endpoint below with an `api_key` parameter. The examples are query-string `GET` requests. [5]
- API key placeholder: `api_key=$PROVIDER2_SMSBOWER_API_KEY`.
- Balance: `GET https://smsbower.page/stubs/handler_api.php?api_key={api_key}&action=getBalance` returns `ACCESS_BALANCE:{yourBalance}`; `BAD_KEY` is the documented invalid-key error. [5]
- Service catalog: `GET https://smsbower.page/stubs/handler_api.php?api_key={api_key}&action=getServicesList` returns JSON such as `{"status":"success","services":[{"code":"kt","name":"KakaoTalk"}]}`. Use the returned `code` as the service value for purchase/pricing. [5]
- Country catalog: `GET https://smsbower.page/stubs/handler_api.php?api_key={api_key}&action=getCountries` returns country objects with `id`, `rus`, `eng`, and `chn`; the separate official “Other” page lists country IDs and API-partner country names. [5] [6]
- Prices/availability: `GET https://smsbower.page/stubs/handler_api.php?api_key={api_key}&action=getPrices&service={service}&country={country}`. `service` and `country` are optional and default to all. The documented JSON shape is:

  ```json
  {
    "Country": {
      "Service": {"cost": 0.12, "count": 542}
    }
  }
  ```

  `getPricesV2` exposes price buckets and counts; `getPricesV3` exposes per-provider entries containing `count`, `price`, and `provider_id`. [5]

- Currency: SMSBower’s client documentation calls these fields `cost`, `price`, and account balance but does not state a currency code. Do not assume USD or another currency from the numeric response; preserve the provider amount and obtain the account’s settlement currency from SMSBower before displaying or converting it. [5]

### Activation lifecycle

1. **Buy/get activation number:**
   `GET https://smsbower.page/stubs/handler_api.php?api_key={api_key}&action=getNumber&service={service}&country={country}&maxPrice={maxPrice}&providerIds={providerIds}&exceptProviderIds={exceptProviderIds}&phoneException={phoneException}&ref={ref}&userID={userID}&minPrice={minPrice}`

   The documented required selection inputs are `service` and `country`; the other filters are optional or reseller-specific. The legacy response is a colon-delimited string:

   ```text
   ACCESS_NUMBER:{activationId}:{phoneNumber}
   ```

   `BAD_KEY`, `BAD_ACTION`, and `BAD_SERVICE` are documented errors. `getNumberV2` uses the same selection parameters and returns JSON:

   ```json
   {
     "activationId": "id",
     "phoneNumber": "number",
     "activationCost": "activationCost",
     "countryCode": "countryCode",
     "canGetAnotherSms": "canGetAnotherSms",
     "activationTime": "activationTime",
     "activationOperator": "activationOperator"
   }
   ```

   Prefer V2 if the integration needs structured purchase metadata, but keep parsing the exact documented response version selected by the implementation. [5]

2. **Status and SMS:**
   `GET https://smsbower.page/stubs/handler_api.php?api_key={api_key}&action=getStatus&id={activationId}`

   Documented text responses are:

   ```text
   STATUS_WAIT_CODE
   STATUS_WAIT_RETRY:{lastCode}
   STATUS_CANCEL
   STATUS_OK:{activationCode}
   ```

   Documented errors are `BAD_KEY`, `BAD_ACTION`, and `NO_ACTIVATION`. The status endpoint is the SMS/code retrieval operation; the docs do not define a separate “get SMS body” endpoint for this activation flow. [5]

3. **Request another SMS:**
   `GET https://smsbower.page/stubs/handler_api.php?api_key={api_key}&action=setStatus&status=3&id={activationId}`. The docs describe status `3` as a free request for another code and return `ACCESS_RETRY_GET` when waiting for that new SMS. [5]

4. **Finish:**
   `GET https://smsbower.page/stubs/handler_api.php?api_key={api_key}&action=setStatus&status=6&id={activationId}`. The docs describe status `6` as completing the activation and return `ACCESS_ACTIVATION` on success. There is no separate finish endpoint. [5]

5. **Cancel/refund path:**
   `GET https://smsbower.page/stubs/handler_api.php?api_key={api_key}&action=setStatus&status=8&id={activationId}`. The docs describe status `8` as reporting that the number was used and canceling the activation; success is `ACCESS_CANCEL`. Cancellation before two minutes is explicitly rejected with `EARLY_CANCEL_DENIED`; the docs say cancellation is possible after two minutes following purchase. [5]

   The client API documentation does not specify a separate refund endpoint, a refund amount, a refund currency, or whether every status-8 cancellation is automatically credited. Treat the balance effect as provider behavior that must be verified on the account, not as a guaranteed API contract. [5]

6. **Optional readiness status:**
   `setStatus` with `status=1` reports that the number is ready/SMS has been sent and returns `ACCESS_READY`; the docs call this optional in the normal chronology. [5]

### SMSBower constraints and risk

The client API docs do not document an idempotency key, client request ID, replay protection, or a lookup by a caller-generated reference. `getNumber` returns an activation ID only after acceptance. Therefore treat `getNumber` as **non-idempotent/unknown on transport failure**: a timeout can mean the activation was accepted and balance debited. Do not retry blindly and do not fail over to 5SIM until the original activation is reconciled. Use the activation ID if it was returned, otherwise check the account/activation view available to the account or contact SMSBower support; the client API page does not document a definitive “find by unknown request” method. [5]

No official SMSBower sandbox/test endpoint, test credentials, or test-mode switch is documented on the official client API page. No prohibition list or refund policy sufficient to define marketplace policy was found in that API page; do not infer that production activations are safe for testing or that any service is permitted. Obtain and record SMSBower’s current account terms before enabling real purchases. The API page does state that obtaining a number means agreeing to the project rules. [5]

## Cross-provider implementation rules

- Use separate provider adapters and separate secret placeholders. Never send a 5SIM Bearer token to SMSBower or an SMSBower `api_key` to 5SIM.
- Treat each purchase as a financial side effect with an **unknown outcome** after timeout, connection reset, proxy failure, or response parse failure. Persist an internal request record before calling the provider, but do not treat that record as provider idempotency.
- On unknown purchase outcome, reconcile before retry or failover. A fallback purchase can create two paid activations when the first request was accepted but its response was lost.
- Keep provider-native IDs exactly: 5SIM numeric order `id`; SMSBower activation ID (legacy string field or V2 JSON field). Do not assume the IDs are interchangeable.
- Do not promise refund-on-timeout. 5SIM documents cancellation/automatic no-SMS refund behavior with specific limits; SMSBower’s client API page does not specify refund mechanics beyond the cancellation status flow.
- Do not add a sandbox flag, USD conversion, or idempotency guarantee to the marketplace contract until the provider documents it or the account owner confirms it in writing.

## References

[1]: https://5sim.net/support/working-with-api "5SIM Working with API"
[2]: https://5sim.net/docs "5SIM API documentation"
[3]: https://5sim.net/rules "5SIM Rules"
[4]: https://5sim.net/manual "5SIM Manual"
[5]: https://smsbower.app/api?page=client "SMSBower Client API Documentation"
[6]: https://smsbower.app/api?page=other "SMSBower Other API Documentation — countries and services"
