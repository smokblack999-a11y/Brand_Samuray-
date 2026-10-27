# SAMURAI Commerce Mini App → SQLite integration contract

Status: adapter implementation and regression tests are present in PR #118. Core CI, Core X22 CI, and Android APK build passed on commit `c9bf34ac7466e7c39cc6eb4ce25f1382b106f6af`. Automated tests use the real Commerce domain and in-memory SQLite, but stub Stripe's outbound API response; they do not establish deployed HTTPS or signed-webhook end-to-end readiness.

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
   - No customer cancellation endpoint is exposed. Keep cancellation unavailable until a safe domain transition handles pending or uncertain Checkout attempts.
5. Checkout now calls the existing domain's Stripe TEST session-creation method; the returned session ID is attached to the SQLite-backed order/payment attempt before webhook processing. The adapter rejects non-test session IDs and non-HTTPS/non-`checkout.stripe.com` URLs. Do not introduce a second Stripe store.
6. Webhook handling must use one signature-verification implementation and one domain payment transition. The event must match the saved order, session, amount, currency, and test-mode flag.
7. Adapt the UI to the actual order IDs/statuses. Do not change the domain schema merely to mimic the Mini App demo schema.

## Automated coverage in PR #118

- Feature gate is closed by default and is also fail-closed when `NODE_ENV=production`, even if the test flags are set.
- Customer identity is derived from the verified Telegram WebApp middleware value; client-supplied customer IDs are ignored.
- Missing/malformed idempotency keys are rejected, same-key retries return the same domain order, and domain conflict logic remains the source of truth.
- Customer order lookup and checkout are owner-scoped; missing and foreign orders share the same 404 response.
- Catalog and total are sourced from the domain; provider metadata/internal fields are omitted from public order DTOs.
- Checkout requires a `cs_test_...` session identifier and a trusted Stripe HTTPS hostname; storage errors return bounded responses.
- An integration test uses real Commerce-domain methods and an in-memory SQLite database while stubbing the outbound Stripe session-creation response. It verifies idempotent order creation, persisted session/payment-attempt state, TEST event application, and duplicate event replay.
- CI has passed for Core tests/Docker, Core X22, and APK build at the commit above. Check later commits' checks separately.

## Remaining release gates

- Test a real signed Telegram `initData` request through the actual deployed HTTPS API.
- Complete a Stripe TEST checkout against an actual test account; deliver its signed webhook to the deployed Core and verify order/session/amount/currency matching, retries, and restart recovery.
- Test the Mini App on a physical Android phone, and run the courier workflow separately.
- Verify production secrets, persistent volume and SQLite backup/restore before any public deployment.
- Do not enable the feature flag or merge this PR until these external release gates pass. No live payments, crypto settlement, real bank API, public deployment, or physical-device end-to-end test is claimed.
