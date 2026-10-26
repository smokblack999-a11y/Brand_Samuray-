# SAMURAI Commerce Mini App → SQLite integration contract

Status: engineering contract / integration branch. This document does not claim the Mini App is integrated or that any payment flow is operational.

## Source of truth

- Domain, payment-state transitions, Telegram bot workflow, and persistence: `core/commerce.js` + `core/commerce-storage.js` from `feat/samurai-commerce-orders-v1`.
- Mini App UI reference: `feat/samurai-commerce-stripe-test` (`core/mini-app/`).
- Do not copy the Mini App PR's `CommerceStore`, JSON order store, `commerce-http.js`, or `stripe-test.js` as a second backend. Those files use a different order schema and lifecycle.
- Do not merge PR #114 as another independent Commerce API.

## Verified schema mismatch

| Concern | SQLite/domain branch (#113) | Mini App branch (#115) |
|---|---|---|
| Product key | `productId`, configured by `COMMERCE_PRODUCTS_JSON` | `sku`, loaded from `commerce-catalog.json` |
| Order ID | `SAM-` + 12 uppercase hex characters | `ord_` + 24 lowercase hex characters |
| Currency/amount | KZT, `totalKzt`, canonical `money` snapshot | KZT/USD/EUR, `totalMinor` |
| Order lifecycle | `AWAITING_PAYMENT`, `PAYMENT_REVIEW`, `PAID`, delivery states | `pending_payment`, `test_paid`, `fulfilled`, `cancelled` |
| Checkout | Existing `commerce-stripe.js` webhook processor expects the domain's accepted session IDs and KZT amount | `stripe-test.js` and `CommerceStore` persist separate checkout attempts and order records |
| Storage | SQLite via `node:sqlite` and migrations | JSON single-process `commerce.json` |

These are incompatible contracts, not a simple file copy. A direct merge would risk broken lookups, incorrect status mapping, duplicate order records, and webhooks unable to reconcile the correct order.

## Required integration design

1. Keep the Mini App static UI under `core/mini-app/`; serve it only from the existing Core static route.
2. Implement a small HTTP adapter that calls the existing domain API. It must never create or persist orders independently.
3. Use `requireWebAppAuth` and derive the customer identity exclusively from verified `req.telegramWebApp.user.id`; ignore client-supplied customer IDs.
4. Expose only routes that can be implemented with the existing domain semantics:
   - `GET /v1/commerce/catalog`: map the server-side KZT catalog into a documented UI DTO.
   - `POST /v1/commerce/orders`: accept `productId`, `quantity`, `fulfillment`, and, for delivery, `address` + `deliveryZone`; use server prices and an idempotency key.
   - `GET /v1/commerce/orders/:id`: verify the order belongs to the authenticated Telegram user before returning a sanitized DTO.
   - `POST /v1/commerce/orders/:id/cancel`: only map to a domain-supported cancellation transition; never silently cancel an order with an uncertain Checkout attempt.
5. Do not expose a Checkout button until a compatible Stripe TEST session-creation path exists in the domain branch and its session ID is registered on the order before webhook processing. Do not introduce the second Stripe store to make the UI appear functional.
6. Webhook handling must use one signature-verification implementation and one domain payment transition. The event must match the saved order, session, amount, currency, and test-mode flag.
7. Adapt the UI to the actual order IDs/statuses. Do not change the domain schema merely to mimic the Mini App demo schema.

## Required automated tests before enabling the UI

- Missing/invalid/expired Telegram initData is rejected.
- Client-supplied customer ID cannot create or access another customer's order.
- Catalog and order totals come only from server configuration.
- Idempotent retries return the same order and conflicting reuse is rejected.
- Checkout failure/timeout does not create duplicate orders or mark payment as paid.
- Invalid signature, replay, wrong session, amount, currency, and live-mode webhook are rejected.
- A verified test payment transitions the same SQLite order exactly once.
- Restart/retry paths preserve order and payment-attempt state.
- Feature is off by default and unavailable in production.
- Existing Telegram bot and courier workflow tests remain green.

## Release gate

This branch is not a release candidate. Keep all PRs draft/unmerged until the adapter and tests above exist, CI passes at the final head, and the complete Telegram Mini App → test Checkout → signed webhook flow is exercised against a real Stripe test account on deployed HTTPS. Physical-device and courier-delivery tests remain separate gates.
