# SAMURAI Commerce — integration status and setup

This is a first implementation slice for the Telegram order workflow. It is not a production payment launch.

## Features in this branch
- Server-side product prices and delivery-zone fees from environment configuration.
- Persistent JSON order records with unique order IDs.
- Customer Telegram commands: `/start`, `/catalog`, `/myorders`, and `/pay ORDER_ID` to retry checkout for the customer's own unpaid order.
- Courier workflow: `/courier`, `/photo ORDER_ID`, `/done ORDER_ID`.
- Test-only Stripe Checkout creation; `PAID` is set only after a valid Stripe signature, a paid Checkout Session, exact amount/currency and matching session ID.
- Courier assignment is blocked until payment is verified. Proof photos are bound to an order and sent to that order's customer.
- Duplicate Telegram updates, Stripe payment events, Checkout creation retries and per-recipient Telegram notification results are tracked.
- Payment notification failures are retried by a single-instance worker after restart; successful recipient notifications are not intentionally resent.

## Required configuration
If `core/.env` already exists, do NOT overwrite it: preserve the current secrets and settings, and merge only the commerce variables from `core/.env.example`. If it does not exist, copy the example first. Replace the DEMO product and delivery-zone values before using the bot.

- `TELEGRAM_BOT_TOKEN`: token from BotFather.
- `TELEGRAM_WEBHOOK_SECRET`: random secret used as Telegram's webhook secret token.
- `TELEGRAM_WEBHOOK_URL`: public HTTPS URL ending in `/api/telegram/webhook`.
- `COMMERCE_PRODUCTS_JSON`: product IDs, names and integer KZT prices.
- `COMMERCE_DELIVERY_ZONES_JSON`: exact zone names and integer KZT delivery fees.
- `COMMERCE_COURIER_IDS`: comma-separated Telegram numeric user IDs permitted to take delivery jobs.
- `COMMERCE_COURIER_TOKENS_JSON`: JSON map from each allowed courier Telegram ID to a long random upload token; enter the token in the Android courier screen.
- `COMMERCE_ADMIN_IDS`: comma-separated administrator Telegram IDs.
- `STRIPE_SECRET_KEY`: a Stripe **test** secret key beginning with `sk_test_`.
- `STRIPE_WEBHOOK_SECRET`: the signing secret for the Stripe test webhook destination.
- `COMMERCE_SUCCESS_URL` and `COMMERCE_CANCEL_URL`: customer-facing return URLs.

Set Stripe's test webhook destination to `https://YOUR_HOST/api/commerce/stripe/webhook` and subscribe to `checkout.session.completed` and `checkout.session.async_payment_succeeded`. Configure Telegram's webhook to `/api/telegram/webhook` using the configured secret token.

## First launch checklist

1. Create a Telegram bot with BotFather and set its token in `core/.env`. The Core server must be deployed to a public HTTPS hostname.
2. Preserve any existing `core/.env` values. If there is no file yet, copy the example: `cp .env.example .env`.
3. Set a strong `CORE_API_KEY` and `TELEGRAM_WEBHOOK_SECRET`. Generate values locally without posting them in chat:
   ```sh
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
   Run it separately for the Core API key, webhook secret and each courier token. Never reuse a token between couriers.
4. Replace the sample catalog and delivery zone JSON with real item IDs, names, integer KZT prices and delivery fees. Do not use the example product or the example amount with customers.
5. Add your Telegram numeric user ID to `COMMERCE_ADMIN_IDS`; add each courier's numeric user ID to `COMMERCE_COURIER_IDS`; place matching different 64-character-or-longer random tokens in `COMMERCE_COURIER_TOKENS_JSON`.
6. Put Stripe's `sk_test_...` key and its `whsec_...` webhook signing secret into `core/.env`. Configure the test webhook at `https://YOUR_DEPLOYED_HOST/api/commerce/stripe/webhook`.
7. Run the checks from the `core/` directory:
   ```sh
   npm ci
   npm test
   npm run verify-commerce
   ```
   The preflight checks formatting and required settings without printing secrets. It does not prove the Telegram token, Stripe credentials, public network routes or webhook delivery are valid.
8. Configure Telegram's webhook with `npm run set-webhook` after reviewing `TELEGRAM_WEBHOOK_URL` and `TELEGRAM_WEBHOOK_SECRET`. Then open the bot in private chat and send `/start` for each customer, administrator and courier.
9. Perform the full TEST flow: select item/quantity → pickup or delivery → test Checkout → wait for signed Stripe event → assign courier → upload photo/GPS → confirm the right customer receives the right photo → mark delivered. Do not change to live payments based only on a passing build.

### Telegram commands

- Customer: `/start`, `/catalog`, `/myorders`, `/pay ORDER_ID`.
- Courier: `/start`, `/courier`, click `ВЗЯТЬ ЗАКАЗ`, `/mydelivery`, `/startdelivery ORDER_ID`, `/photo ORDER_ID` and send the photo, finally `/done ORDER_ID`.
- Admin: `/start`, `/admin` for counts, `/orders` for recent orders, `/order ORDER_ID` for one order's delivery/payment status. Commands work only in private chat.
- Admin: use the Core API endpoints with `X-API-Key`; check readiness with `GET /api/commerce/status` (the status response never returns configured secret values).

## Environment examples

```dotenv
COMMERCE_CURRENCY=KZT
COMMERCE_PRODUCTS_JSON='[{"id":"item-1","name":"Example item","priceKzt":5000}]'
COMMERCE_DELIVERY_ZONES_JSON='{"Almaty":1500}'
COMMERCE_COURIER_IDS=123456789,987654321
COMMERCE_COURIER_TOKENS_JSON='{"123456789":"REPLACE_WITH_LONG_RANDOM_TOKEN"}'
COMMERCE_ADMIN_IDS=123456789
STRIPE_SECRET_KEY=sk_test_REPLACE_ME
STRIPE_WEBHOOK_SECRET=whsec_REPLACE_ME
COMMERCE_SUCCESS_URL=https://example.com/payment/success
COMMERCE_CANCEL_URL=https://example.com/payment/cancel
```

Prices are stored as whole KZT. Stripe lists KZT as a two-decimal currency; API amounts use minor units, so this implementation sends and validates KZT totals multiplied by 100. Confirm the payment provider supports KZT for the eventual merchant account: [Stripe currency documentation](https://docs.stripe.com/currencies).

## Safety limits / not yet implemented
- This implementation intentionally refuses live Stripe keys. No real charge is enabled.
- On checkout retry after an expired session, Core queries Stripe first: it recovers an already-paid session or stops if the previous session is not confirmed expired. It does not issue a second payable link while the prior session status is uncertain.
- Test-mode Stripe does not prove that a merchant account in Kazakhstan is eligible for live Stripe processing. Confirm provider/country eligibility before selecting the production provider.
- JSON file storage is suitable only for a single-instance prototype. Do not scale horizontally or run multiple Core instances against the same files. Move orders, payment events, notification outbox and sessions to a transactional shared database before production traffic.
- Do not use DEMO catalog entries or example delivery prices for real customers.
- Android gallery-photo upload with captured GPS metadata is included in the CI-built debug APK, but has not yet been tested on the user's physical device. The app stores timestamp/location in its private sidecar metadata and attempts both a visible image stamp and JPEG EXIF GPS/time fields; if high-resolution decoding fails, EXIF metadata can still be saved. Uploads are limited to 8 per minute per client IP and 10 MiB, validate image signatures, and use SHA-256 to make retries safe when Telegram delivery fails. The courier must be assigned to the order, be listed in COMMERCE_COURIER_IDS, and authenticate with a per-courier token. GPS is optional and is not cryptographic proof of location.
- No real deployment, live webhook delivery, live payment, courier-device test or end-to-end APK test has been performed by this branch creation.

## API
- `GET /api/commerce/catalog` — public configured catalog and delivery zones.
- `GET /api/commerce/orders` — admin API key required.
- `GET /api/commerce/orders/:id` — admin API key required.
- `POST /api/commerce/orders` — admin API key required; creates an unpaid order.
- `POST /api/commerce/orders/:id/assign` — admin API key required; assigns only a paid delivery order.
- `POST /api/commerce/orders/:id/photo-upload` — raw JPEG/PNG/WebP body; requires X-Courier-Id and X-Courier-Token headers, accepts optional GPS metadata headers, and sends the image to the customer only if the order is assigned and paid.
- `POST /api/commerce/orders/:id/proof` — admin API key required; accepts a Telegram photo file ID plus courier ID and optional GPS.
- `POST /api/commerce/orders/:id/delivered` — admin API key required; requires photo evidence first.
- `POST /api/commerce/stripe/webhook` — requires a valid Stripe signature; do not call manually to mark an order paid.

## Verification
Run from `core/`:
```sh
node --check server.js
node --check commerce.js
node --check commerce-stripe.js
node --check commerce-bot.js
node --check scripts/verify-commerce-config.js
node --test test/commerce.test.js
node --test test/commerce-bot.test.js
node --test test/verify-commerce-config.test.js
npm test
npm run verify-commerce
```

## Android API target

The debug build defaults to `http://10.0.2.2:8787`, which works for an Android emulator only. For a real phone, build against a deployed HTTPS Core URL:

```sh
cd android
./gradlew assembleDebug -PCORE_BASE_URL=https://YOUR_DEPLOYED_CORE_HOST
```

Do not ship the placeholder `https://core.example.invalid` as a usable endpoint. Core must be deployed and the courier token configured before Android photo upload can work. Each courier and customer must open the bot in a private chat and send `/start` before the bot can message them. Commerce commands and delivery-address capture are ignored in group chats to avoid exposing private addresses.
