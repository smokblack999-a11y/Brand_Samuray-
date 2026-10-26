# SAMURAI Commerce — technical review and implementation decisions (2026-10-25)

## Review scope and source quality

The supplied forum URL ends in `/13`. The corresponding comment is a joke about the naming of ChatGPT Spaces and is not a technical guide. Use the root DevDay topic as an announcement index and the official OpenAI documentation for implementation details.

Primary sources reviewed:
- DevDay 2026 official recap: https://openai.com/index/devday-2026-recap/
- DevDay 2026 sessions: https://openai.com/devday/2026/
- Function calling: https://developers.openai.com/api/docs/guides/function-calling
- Structured model outputs: https://developers.openai.com/api/docs/guides/structured-outputs
- Agents SDK: https://developers.openai.com/api/docs/guides/agents/sdk
- Webhooks: https://developers.openai.com/api/docs/guides/webhooks
- API data controls: https://developers.openai.com/api/docs/guides/your-data
- Rate limits and retry handling: https://developers.openai.com/api/docs/guides/rate-limits
- Evals: https://developers.openai.com/api/docs/guides/evals
- Codex Security: https://help.openai.com/en/articles/20001107-codex-security

## What is relevant from DevDay

1. Codex code review and security scanning are useful as review layers for a payment/order repository. They do not replace unit/integration tests, review of diffs, or a release gate.
2. Function calling and Structured Outputs can make an assistant's proposed arguments/schema more reliable, but a schema is not authorization and does not prove a payment. Server-side validation and authorization remain mandatory.
3. Agents API / Agents SDK orchestration, handoffs, tool search and guardrails are not required for the first reliable commerce release. Start with simple, narrowly scoped read-only AI tools; introduce an agent runtime only after permissions, tracing, approvals and evaluations are in place.
4. Decisions API is announced as a limited-preview routing/classification capability. Do not make the payment ledger or routing of funds depend on a limited-preview API.
5. OpenAI webhooks relate to events produced by OpenAI, not Stripe. Stripe webhooks need Stripe's own raw-body signature verification and event validation.
6. The Evals documentation advises the platform is being deprecated during late 2026. Keep the critical commerce regression suite in version-controlled Node tests; do not make CI correctness depend on a hosted evaluation feature whose lifecycle is changing.

## Trust boundaries

- Telegram is an identity and messaging transport, not a payment authority. Store numeric Telegram user IDs from the update; never authorize by username alone.
- The Core service owns price, currency, delivery fee, order state, payee/chain configuration, courier assignment, and photo-to-customer mapping.
- Stripe TEST events can mark paid only after a verified signature and exact order/session/amount/currency/environment match.
- A bank-transfer receipt/photo is evidence only. It can create PAYMENT_REVIEW; it cannot set PAID. Confirm only from authenticated bank data or a separately audited reconciliation process.
- A USDT/BTC transaction must be verified independently against the selected network/provider and bind asset, network, address, exact amount, transaction hash, confirmation policy, and order/payment attempt. A submitted hash or screenshot alone is untrusted input.
- A vision/LLM model may extract candidate details from a receipt, but its output can only prefill a review form. It must never resolve payment status or trigger dispatch.
- The server stores the customer Telegram ID and derives the recipient from the persisted order. Never accept a model-supplied or courier-supplied customer ID for delivery.
- Raw receipt images, complete bank/card details, seed phrases, private keys, and recovery phrases must never be sent to the LLM or written to logs.

## OpenAI integration: safe scope

Allowed first slice:
- Optional product Q&A grounded strictly in the server catalog.
- Read-only `get_order_status(order_id)` where the server binds the authenticated Telegram user and returns only that customer's order.
- Optional receipt field extraction into an explicit schema (`claimed_amount`, `currency`, `claimed_reference`, `claimed_time`, `confidence`, `needs_human_review`) with all extracted fields treated as unverified.
- Customer-support response drafting, with a safe fallback when the model is unavailable.

Do not expose tools that let a model mark payments PAID, modify a total, invent payment requisites, select a wallet address, assign a courier, mark a delivery complete, or choose the photo recipient. If future write tools are added, require strict tool schemas, independent authorization, allowlisted actions, and explicit confirmation at the application layer.

## Critical reliability gaps to close before public testing

- Implemented in this branch: `stripe-webhook-policy.js` returns 4xx for known permanent signed-event validation rejections and retryable 5xx for unknown/internal processing or storage failures. A regression test checks permanent vs transient codes. This reduces lost paid events but still needs a test against the real deployed Stripe webhook and persistent storage.
- Implemented in this branch: repeat events for the same paid Checkout Session stay idempotent, while a different paid Session for an already-paid order creates a `REVIEW_REQUIRED` incident, preserves the first recorded payment, and alerts admins. The notification worker retries admin alerts. Tests cover the incident and notification retry.
- JSON file storage is single-instance prototype storage. Atomic renames help prevent partial writes but are not a transactional database or a durable event/outbox guarantee. Add persistent transactional storage before production/multiple instances.
- Implemented in this branch: `paymentReceipts` and courier `proof` are separate order fields. Customer `/receipt ORDER_ID` sets `PAYMENT_REVIEW`, forwards the picture to admins and never sets `PAID`. `/confirmbank ORDER_ID BANK_REFERENCE` presents the receipt again and requires a second admin confirmation after the operator independently checks settled funds in the bank/provider ledger. The manual attestation records administrator ID, transaction reference, amount, currency, time and receipt IDs. This is not a bank API and is not automatic verification.
- Multi-country payments require a configured market/country, currency, currency minor-unit scale, provider eligibility, settlement currency, and payment attempt. Do not generalize the current KZT-only amount fields by simply changing an environment variable.
- USDT network remains deliberately unspecified. Keep all crypto customer-facing routes disabled until one exact testnet network and its trusted node/indexer are selected.
- HTTPS deployment needs persistent storage, correct health/readiness checks, configured webhook endpoints, secrets stored only in host variables, and a real-device build with a configured Core URL.


## Provider eligibility findings (checked 2026-10-25)

- Stripe's current global availability list does not list Kazakhstan and says payments are not supported for businesses outside supported countries/regions. Its cross-country account requirements include a legal entity and local presence/banking requirements. Keep Stripe as a TEST harness unless the actual merchant entity is legally eligible: https://stripe.com/global and https://support.stripe.com/questions/requirements-to-open-a-stripe-account-in-another-country?locale=en-GB.
- Official Kaspi Pay partner documentation describes online "Payments" for eligible partners; a supplier must apply and have a Kaspi Pay account. This is a candidate to investigate, not an integrated adapter; merchant eligibility and a current API/webhook specification are still needed: https://guide.kaspi.kz/partner/ru/payments/distributor/general/q4387 and https://guide.kaspi.kz/partner/ru/payments/distributor/connection/q4389.
- Kazakhstan AFM has published a warning on unbacked digital assets and crypto settlement, with an exception described for exchanges licensed by AIFC. The digital-assets law was updated in July 2026. Obtain local legal review for the actual merchant and payment/custody route before enabling BTC/USDT; this engineering note is not legal advice: https://www.gov.kz/org/afm/press/news/details/722187?lang=ru and https://adilet.zan.kz/rus/docs/Z2300000193.

## Test plan / release gate

Required negative tests:
- wrong/missing Stripe signature, live event, wrong mode, malformed amount, wrong currency, wrong order, wrong Session, repeated event, second successful Session, unavailable storage, and Stripe timeout;
- forged receipt, receipt for another user's order, receipt submitted after paid/cancelled status, unknown asset/network, wrong destination, underpayment, duplicate transaction hash, and insufficient chain confirmations;
- customer attempts to see another customer's order/address/photo; courier attempts to upload to an unassigned order; photo delivery failure followed by retry; duplicate Telegram updates;
- concurrent checkout attempts and restart recovery; backup/restore; invalid/missing required production environment settings;
- AI tool arguments attempting to override user identity, order total, payment state, wallet destination, courier ID, or photo recipient.

Release rules:
1. Keep Stripe TEST-only and all crypto mainnet features disabled.
2. Run `npm ci`, `npm test`, `npm run verify-commerce`, syntax checks, Docker build, and Android APK build.
3. Validate a complete test-mode order on the deployed HTTPS Core and physical Android device.
4. Verify the photo reaches the exact customer from the database and cannot be routed using filename, caption, AI output, or courier-provided chat ID.
5. Before production, migrate to a transactional database plus a durable outbox and document a separate legal/provider eligibility review for each country/payment method.