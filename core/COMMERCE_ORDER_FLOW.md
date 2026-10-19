# Samurai Commerce Order Flow — initial domain module

This isolated first layer is not wired into public HTTP or Telegram routes yet.

## Included
- Persistent JSON catalog/order state with atomic writes and restrictive file permissions.
- Server-side price calculation; client-supplied prices are never accepted.
- Stock reservation at order creation and restoration when an unpaid order is cancelled.
- Separate delivery and pickup state paths.
- Payment confirmation requires a trusted bank/provider/manual-review signal and exact amount matching.
- Idempotency for payment event IDs.
- Courier assignment and HTTPS delivery-photo reference.
- Corrupt state fails closed rather than silently resetting commerce data.

## Not included yet
- HTTP routes and Telegram customer/admin/courier menus.
- Real payment-provider adapter or signed webhook verification.
- Role-based authorization for staff/couriers.
- Delivery price calculation, order expiry, refunds, notifications, media storage, and production database.
- Multi-process locking. JSON storage is single-process MVP/testing only.

## Payment safety
A screenshot or forwarded receipt is not authoritative proof of funds. confirmPayment refuses to mark an order paid unless the caller supplies a trusted verification result. That flag is an internal contract and must never be exposed as a client-controlled HTTP input. A future route must derive it only after verifying a provider webhook/bank API or staff-only manual review.

## State sequence
- Delivery: pending_payment -> paid -> assigned -> out_for_delivery -> delivered
- Pickup: pending_payment -> preparing -> ready_for_pickup -> picked_up
- Unpaid cancellation releases reserved stock. Paid cancellation is blocked until a refund workflow exists.

Run tests from core/ with npm test.
