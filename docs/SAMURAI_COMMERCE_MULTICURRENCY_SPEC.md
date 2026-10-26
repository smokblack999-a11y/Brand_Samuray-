# SAMURAI Commerce — multi-country payments and delivery specification

Status: design baseline for implementation. This document does not claim that all payment adapters exist or are production-ready.

## Confirmed product requirements
- Multiple countries and currencies; do not assume one global currency.
- Payment methods: bank cards, bank transfer/manual bank reconciliation where supported, USDT and BTC.
- USDT network is intentionally undecided; never accept USDT until the exact chain and token contract/address are configured.
- Both pickup and courier delivery.
- Server-calculated prices, fees, currency, order status, payment state, courier assignment, photo evidence, and customer Telegram ID are authoritative.
- Stripe remains TEST mode only. No live payments.
- Never request bot tokens, API keys, wallet private keys, seed phrases, bank credentials, or payment secrets in chat.

## Order lifecycle
DRAFT -> AWAITING_PAYMENT -> PAYMENT_REVIEW (optional) -> PAID -> PREPARING -> READY_FOR_PICKUP or COURIER_ASSIGNED -> IN_DELIVERY -> PHOTO_RECEIVED -> DELIVERED.
CANCELLED is allowed only through an explicit policy and never erases payment/audit history. A submitted screenshot is evidence, not a payment confirmation. Courier dispatch is blocked until a trusted verifier records PAID.

## Required order snapshot
- order_id, created_at, updated_at, customer_telegram_id
- country_code, currency, locale
- item lines: product_id, immutable product name/price snapshot, quantity, subtotal
- fulfillment: pickup or delivery, delivery zone, fee, address (restricted to assigned courier/admin)
- total and currency
- payment method/provider, provider reference, payment status, verified amount/currency, verified timestamp
- courier Telegram ID, state transitions, photo evidence (Telegram file ID, hash, capture time, GPS and accuracy where permitted)
- notification outbox and idempotency keys

## Payment adapter contract
Each adapter must implement create-instructions/create-payment (where applicable), verify-status, handle-signed-webhook (where supported), and reconcile. Every successful verification must return a normalized immutable result: provider, provider transaction/event ID, order reference, amount in minor units, ISO currency or crypto asset, network, destination, confirmations/status, and verification timestamp.

Reject if any order reference, receiver/destination, network, asset, amount, currency, or status mismatches. Deduplicate provider events and transaction IDs. Unknown status, missing provider access, delayed webhook, or ambiguous transfer must fail closed: PAYMENT_REVIEW/AWAITING_PAYMENT, never PAID.

### Bank cards
- Start with Stripe TEST Checkout only, using test keys and signed test webhook.
- Do not treat redirect to success_url as proof of payment.
- A provider's verified webhook/API status and exact amount/currency/order reference are required.

### Bank transfer
- Automatic confirmation only through a bank/provider API with authenticated data, if available for the chosen country/bank.
- Otherwise show reference and instructions, keep PAYMENT_REVIEW, and require an authorized operator to verify the credit in the recipient account. Screenshots/receipts alone cannot flip the order to PAID.
- Do not store bank login credentials.

### USDT
- Select a single explicit chain before enabling a network (e.g. TRON/TRC-20 or Ethereum/ERC-20; examples only, not a decision).
- Configure asset contract/address, receiving address, minimum confirmations, amount/expiry policy, and trusted node/API source.
- Validate chain ID, token contract, destination, transaction success, exact token amount, confirmation depth, and unused transaction hash.
- Never infer the chain from a screenshot or ticker symbol alone. Do not request or store seed phrases/private keys.

### Bitcoin
- Verify the transaction using a trusted Bitcoin node or provider API: transaction inclusion, successful output to the configured address, exact amount, confirmation depth, and unique txid.
- Define exchange-rate source, quote timestamp, tolerance, and payment window before accepting BTC-denominated settlement. No exchange-rate assumption is implicit in this spec.

## Telegram and courier identity
- Customer identity is Telegram numeric user ID, not display name or username.
- Courier is allow-listed by Telegram numeric ID; usernames may change and are not authorization.
- Admin/courier commands work only in private chats unless a narrowly scoped group flow is explicitly designed.
- Assign a delivery only after payment is verified. Send the courier minimum required customer/address details.
- A courier photo upload must authenticate the courier and match an active assigned order. Store order ID + file ID + hash + capture time + GPS metadata as one proof record. Send that exact file to the order's recorded customer ID. Never select the recipient from client-supplied fields in the upload request.
- Mark delivery complete only after Telegram confirms sending the same proof photo to the correct customer.

## Internationalization and money
- Country, currency, provider availability, tax/legal rules, and payment method availability are explicit configuration.
- Store amounts as integer minor units and store ISO 4217 currency where applicable; never use floating-point amounts.
- Crypto amounts use integer base units or precise decimal strings with asset/network metadata, never binary floats.
- Product and fee prices are immutable snapshots on an order. A later catalog edit must not alter an existing order.
- No automatic currency conversion without a configured quote source, quote expiry, rounding rule, and disclosed final amount.

## Storage and operational requirements
- Current JSON-file store is prototype/single-instance only. Before real multi-user production, migrate orders, payment events, state transitions, and notification outbox to a transactional shared database with unique constraints.
- Keep webhook signature verification, request size limits, rate limits, secret redaction, access control, audit trail, backups, and monitoring.
- Retry Telegram delivery from an outbox. Expect at-least-once delivery; deduplicate business actions.
- Secrets are set in the deployment provider's secret-variable UI, not committed to Git or posted in chat.

## Release gates
1. Unit tests for each payment adapter: valid payment, wrong amount, wrong asset/network/address, replayed event/txid, pending/unavailable verifier, and duplicate webhook.
2. Test-mode Stripe order end-to-end, including signed webhook; no live keys.
3. Simulated bank and crypto adapters must be labelled SIMULATION and must never transition a real order to PAID.
4. Courier authorization tests: wrong courier, wrong order, unpaid order, wrong customer routing, duplicate photo, Telegram send failure.
5. Deploy to HTTPS; health endpoint and Telegram webhook tested with secrets kept private.
6. Physical Android test: camera/GPS permission, image upload, server receives correct order binding, correct customer receives same photo.
7. Production is blocked until country/provider availability and applicable legal/compliance obligations are reviewed and persistent transactional storage is in place.

## Explicitly undecided
- Countries and settlement currencies.
- Bank(s) and availability of bank APIs.
- Card provider availability for each country.
- USDT network/token contract.
- BTC exchange-rate source, quote policy, and confirmation depth.
- Delivery zone pricing, pickup location, tax/receipt requirements.
