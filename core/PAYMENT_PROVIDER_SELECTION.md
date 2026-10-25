# SAMURAI Commerce — payment provider selection and launch blockers

Review date: 2026-10-25. This is an engineering decision record, not legal or banking advice. No live payment method is enabled by this document.

## Confirmed implementation facts

- The current commerce Checkout adapter supports KZT only and is deliberately Stripe TEST-only (`sk_test_...`; signed `whsec_...` webhook). It has no live payment mode.
- Customer receipt photos now create a `PAYMENT_REVIEW` status and are sent to configured administrators; they do not set `paymentStatus=PAID`.
- An explicitly-confirmed manual bank reconciliation command can mark a reviewed order paid only after an admin confirms that settled funds were independently checked in the bank/payment-provider ledger. It records admin Telegram ID, bank reference and timestamp. This is an operator attestation, not automatic bank verification.
- `USDT`, `BTC`, crypto addresses, chain monitoring, card processors other than the test adapter, currency conversion and multi-country pricing are not implemented.
- Do not deploy the demo catalogue or use sample prices/credentials in a customer-facing store.

## Stripe: useful in tests, not a default Kazakhstan production provider

Stripe's current global availability page lists supported merchant countries/regions and does not list Kazakhstan. It says Payments are not supported for businesses outside its supported countries/regions. Stripe's help page says opening an account in another country requires, among other things, a legal entity, tax ID, physical location, phone, identity document, working website and a physical local bank account where required. Source URLs:
- https://stripe.com/global
- https://support.stripe.com/questions/requirements-to-open-a-stripe-account-in-another-country?locale=en-GB

Decision: keep Stripe TEST for automated integration tests. Do not present Stripe as the eventual live provider merely because the test Checkout API works. Do not use a false country, borrowed entity, or another person's account to bypass availability.

## Kazakhstan candidate: Kaspi Pay / Payments service

Official Kaspi partner documentation says the Payments service is for Kaspi Pay partners; suppliers need to apply, and the published partner eligibility states a Kazakhstan-registered individual entrepreneur or LLP supplying goods/services in Kazakhstan. A Kaspi Pay account is required. Sources:
- https://guide.kaspi.kz/partner/ru/payments/distributor/general/q4387
- https://guide.kaspi.kz/partner/ru/payments/distributor/connection/q4389
- https://guide.kaspi.kz/partner/ru/payments/distributor/connection/q2385

Decision: potential local acquiring candidate only, not yet an integration. Before writing its adapter, confirm the actual business is eligible, apply through the official route, obtain the current merchant technical specification, and verify whether order-linked API/webhooks/status querying are available to this merchant. A receipt/screenshot or manual payment notification is not authoritative API confirmation.

## Multiple countries: a country/provider matrix is required

Before enabling a country, record and approve:
- merchant's real legal entity and country of establishment;
- buyer countries served and country where goods are fulfilled;
- enabled display/settlement currencies and each currency's minor-unit precision;
- supported acquiring/transfer provider and merchant account eligibility;
- whether payment status can be retrieved through an authenticated API or signed webhook;
- refunds/chargebacks, fee, settlement currency, reconciliation and payout rules;
- privacy/data retention, tax, consumer returns, sanctions/KYC/AML requirements;
- delivery zones, address formats, pickup rules and service hours.

Unknown country/provider combinations must be disabled by default. A customer's country must not be allowed to choose a different merchant account, destination account or wallet address.

## USDT / BTC: stop gate before code connects to real funds

USDT requires a specific chain and exact token contract; ticker-only configuration is unsafe. BTC requires an explicit network (testnet first), a trusted node/provider, confirmation policy and unique deposit identity/order correlation. Verification must check network, asset, exact destination, value, transaction hash, confirmation count, underpayments, overpayments, expiry/FX rules and duplicate transaction hashes independently of the user's screenshot or submitted hash.

Country/legal gate: Kazakhstan AFM has published a warning that unbacked digital assets including Bitcoin and settlement in such assets are restricted, with an exception described for exchanges licensed by AIFC. Kazakhstan's digital-assets law was updated on 2026-07-23, so the precise current regime for the real merchant, asset, custody/payment route and cross-border settlement needs specialist local review; do not infer that a stablecoin is permitted merely because it is called USDT. Sources:
- https://www.gov.kz/org/afm/press/news/details/722187?lang=ru
- https://adilet.zan.kz/rus/docs/Z2300000193

Decision: no crypto addresses or mainnet payment buttons are shown to customers until the network, regulated service model, country legality, custody model and refund/reconciliation procedure have been explicitly approved. Never request or store wallet seed phrases or private signing keys in Telegram, source code, logs or this chat.

## Recommended integration architecture

Do not change `COMMERCE_CURRENCY=KZT` to another currency as a shortcut. Before adding a second market:
1. Introduce an order money object using `{ amountMinor: integer, currency: ISO-4217, minorUnitScale: integer }`; calculate totals and delivery fees server-side.
2. Preserve compatibility/migration for existing `totalKzt`, `unitPriceKzt`, `itemsTotalKzt`, `deliveryFeeKzt` orders and historical receipts.
3. Add a typed provider interface: `createPaymentAttempt(order, config)`, `verifyWebhook(rawBody, headers)`, `queryPayment(providerReference)`, `normalizeStatus(...)`, `refund(...)` only when supported.
4. Persist `payment_attempt_id`, provider, merchant account, expected amount/currency, environment, provider transaction/event IDs, verified timestamp and verifier source. Enforce idempotency on both provider event ID and transaction ID.
5. Enforce a single state-transition service. A provider/chain adapter supplies evidence; only domain logic can transition `AWAITING_PAYMENT`/`PAYMENT_REVIEW` to `PAID` after exact match checks.
6. Keep receipts as evidence artifacts, separate from authoritative payment status and separate from courier delivery photos.
7. Move JSON files to a transactional database and implement a durable outbox before production or multiple server instances.

## OpenAI / DevDay applicability

OpenAI function calling and Structured Outputs are useful for optional catalogue Q&A and extracting candidate fields from a bank receipt into a review form. Strict schema improves shape, not truth or authorization. AI may not set PAID, alter the server-calculated total, choose a wallet address, choose an account, assign a courier or choose the photo recipient. Those decisions must be made by deterministic server-side policy and authenticated provider evidence. Official docs:
- https://developers.openai.com/api/docs/guides/function-calling
- https://developers.openai.com/api/docs/guides/structured-outputs
- DevDay recap: https://openai.com/index/devday-2026-recap/

## Minimum release gate

- unit and integration tests for valid and invalid signatures, duplicate event, duplicate transaction, mismatched amount/currency/order/session, internal storage failure and provider timeout;
- verify a real test provider account/webhook and test checkout end-to-end;
- test that a fake receipt never dispatches a courier; only an audited admin bank attestation or verified provider adapter may confirm payment;
- test restart recovery and outbox retries; verify a duplicate payment incident is visible to admin and retried if Telegram is unavailable;
- verify courier assignment is only after PAID and the original proof photo reaches only the Telegram ID linked to the same order;
- test country/provider eligibility and legal approval before enabling any production payment route.

Current decision: continue test-only provider adapter + manual bank-review flow. Live card integration, automatic bank API, USDT and BTC remain explicitly unimplemented.