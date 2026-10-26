# SAMURAI Commerce — multi-country payment and courier requirements

Status: requirements baseline for the next implementation slice. This document does not enable live payments or claim that crypto/bank-transfer adapters are implemented.

## Product requirements

1. Customer opens the Telegram bot in a private chat. The server binds every order to the numeric Telegram user ID, not a display name or username.
2. The server is the source of truth for product prices, stock, fulfillment options, fees, currency, payment state, assigned courier, and photo ownership.
3. Customer selects product and quantity, then pickup or delivery. Delivery requires an address and a configured service zone. The bot shows item subtotal, fee, currency, and exact total before checkout.
4. Each order receives an immutable ID and a payment attempt/reference. Payment instructions must be generated from an enabled provider/configuration, not from text supplied by a customer.
5. Uploaded receipts/screenshots are unverified evidence only. They must never transition an order to PAID by themselves.
6. Courier dispatch is permitted only after a provider-backed payment confirmation or an explicitly audited admin reconciliation. Courier identity is a numeric Telegram ID; usernames are display-only and can change.
7. Courier proof must be attached server-side to one order, uploader identity, timestamp, GPS metadata (when permission is granted), and a cryptographic content hash. The server resolves the customer from the stored order and sends the exact uploaded photo only to that customer.
8. Delivery completion is blocked until the proof has been successfully delivered to the order's customer.
9. All customer, admin and courier workflows are private-chat only unless a separately reviewed group workflow is implemented.
10. Keep the current Stripe integration in TEST mode only. Never accept live-mode Stripe keys or events in this slice.

## Countries, currencies, and fulfillment

- Multiple countries are in scope, but each launch country must be explicitly configured: ISO country code, supported settlement/display currency, currency precision, enabled providers, catalog availability, delivery zones/fees, and legal/operator review.
- Do not assume every provider supports every country or currency. A country/provider combination stays disabled until provider eligibility and settlement behavior are verified.
- Pickup and courier delivery are both required. Pickup has no delivery fee; delivery fees are server-calculated from configured zones. Never accept a client-supplied total.
- Replace KZT-specific field names and validation with integer minor-unit amounts plus an explicit ISO currency code in the payment abstraction before enabling additional currencies. Existing stored KZT orders must remain readable through a migration/compatibility path.

## Payment-provider contract

Every provider adapter must expose a server-side contract equivalent to:
- create payment intent/instructions for a known order and payment attempt;
- verify provider callback/webhook signature or independently query provider status;
- normalize the result to pending, paid, failed, expired, or refunded;
- return a provider transaction ID, order reference, amount in minor units, currency, and provider environment (test/live);
- deduplicate provider event IDs and transaction IDs;
- reject mismatched amount, currency, order reference, recipient account, asset, network, or environment;
- never mark paid based solely on a screenshot, browser redirect, client message, or unverified webhook.

### Bank cards

Use a supported payment processor's test environment and signed webhook/API reconciliation. A card receipt or success page alone is not proof of payment. Provider eligibility and merchant-country support must be verified before any live rollout.

### Bank transfer / account requisites

Manual bank transfer must remain PAYMENT_REVIEW until an authorized operator reconciles it against an actual bank statement or an authenticated bank API. Do not infer payment from a receipt image or SMS text. Automatic bank verification is provider- and bank-specific and is not yet implemented by this requirements document.

### USDT and BTC

- USDT network must be explicitly selected before implementation (e.g. one specific supported chain); the ticker alone is insufficient because addresses and transaction formats differ by network.
- BTC must use a configured Bitcoin network and trusted node/provider. Testnet is required for automated development tests; mainnet payments remain disabled.
- A crypto payment record must bind chain/network, asset, exact receiving address, expected amount, transaction hash, confirmation policy, and order/payment-attempt ID. Never trust a customer-provided transaction hash without independently querying the selected chain/provider.
- Reject underpayments, overpayments unless an explicit audited policy exists, wrong-token transfers, wrong-network transfers, wrong destination addresses, and transactions below the configured confirmation threshold. Handle exchange-rate expiry and duplicate transaction hashes.
- No seed phrases, private keys, wallet recovery phrases, or wallet signing secrets belong in Telegram chats, source code, GitHub, or this conversation. Prefer a processor/custody service or a watch-only receiving address architecture; wallet signing is out of scope for the first test slice.
- USDT/BTC adapters are NOT implemented merely by this document. No crypto address should be shown to a customer until a testnet adapter and verification tests exist.

## Order state machine

- AWAITING_PAYMENT: order and immutable total created.
- PAYMENT_REVIEW: manual receipt submitted or provider result cannot yet be conclusively reconciled.
- PAID: only a verified provider result matching order, payment attempt, amount, currency and provider environment, or a separately audited admin reconciliation.
- PREPARING: paid order accepted by an authorized courier/admin.
- READY: preparation/photo proof is attached and validated, where required by workflow.
- DELIVERED: delivery/pickup completion rules passed.
- PAYMENT_FAILED, EXPIRED, CANCELLED, REFUNDED: terminal or explicitly controlled transitions; no silent resurrection of cancelled/refunded orders.

All state transitions must be validated server-side and recorded in an audit trail. Duplicate callbacks and retries must be idempotent.

## Safe implementation sequence

1. Add country/currency configuration and integer-minor-unit payment types, with compatibility for existing KZT demo orders.
2. Add a generic test-only payment-attempt record and manual-receipt PAYMENT_REVIEW path; receipt upload never changes paymentStatus to PAID.
3. Add provider adapter contract and negative tests (wrong order, amount, currency, signature, duplicate event, live-mode event).
4. Add crypto TESTNET adapters only after a specific USDT chain and trusted BTC testnet provider/node are selected; keep mainnet disabled.
5. Deploy Core with HTTPS, configure Telegram webhook, and run end-to-end test orders using fake/demo products and test credentials.
6. Move JSON storage to transactional persistent database and durable notification outbox before multi-instance or production use.
7. Require a documented release gate before enabling any live payment provider.

## Acceptance criteria

- A fake/forged receipt cannot mark an order paid or dispatch it to a courier.
- A valid test provider callback only pays the matching order and exact amount/currency.
- Duplicate webhook/event delivery does not double-pay, duplicate-assign, or send a photo to a different customer.
- An unknown country/currency/network/provider is rejected closed.
- Live Stripe events/keys and crypto mainnet payments remain rejected/disabled.
- Customer cannot select or overwrite the final price, recipient Telegram ID, courier ID, or proof ownership.
- Photo is sent only to the Telegram ID stored on the same order, and delivery cannot complete before successful photo delivery.