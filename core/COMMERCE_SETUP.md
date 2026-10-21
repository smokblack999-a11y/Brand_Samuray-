# SAMURAI Commerce — integration status and setup

This is a first implementation slice for the Telegram order workflow. It is not a production payment launch.

## Features in this branch
- Server-side product prices and delivery-zone fees from environment configuration.
- Persistent JSON order records with unique order IDs.
- Customer Telegram commands: `/start`, `/catalog`, `/myorders`.
- Courier workflow: `/courier`, `/photo ORDER_ID`, `/done ORDER_ID`.
- Test-only Stripe Checkout creation; `PAID` is set only after a valid Stripe signature, a paid Checkout Session, exact amount/currency and matching session ID.
- Courier assignment is blocked until payment is verified. Proof photos are bound to an order and sent to that order's customer.
- Duplicate Telegram update IDs and Stripe event IDs are tracked.

## Required configuration
Copy `core/.env.example` to `core/.env`. Replace the DEMO product and delivery-zone values before using the bot.

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

Prices are stored as whole KZT. Stripe API amounts for KZT use minor units, so this implementation sends and validates KZT totals multiplied by 100.

## Safety limits / not yet implemented
- This implementation intentionally refuses live Stripe keys. No real charge is enabled.
- Test-mode Stripe does not prove that a merchant account in Kazakhstan is eligible for live Stripe processing. Confirm provider/country eligibility before selecting the production provider.
- JSON file storage is suitable only for a single-instance prototype. Use a transactional database before concurrent production traffic.
- Do not use DEMO catalog entries or example delivery prices for real customers.
- Android gallery-photo upload with captured GPS metadata is wired to an order-specific endpoint, but has not yet been built or device-tested. The courier must be assigned to the order, be listed in COMMERCE_COURIER_IDS, and authenticate with a per-courier token. GPS is optional and is not cryptographic proof of location.
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
node --test test/commerce.test.js
npm test
```

## Android API target

The debug build defaults to \`http://10.0.2.2:8787\`, which works for an Android emulator only. For a real phone, build against a deployed HTTPS Core URL:

\`\`\`sh
cd android
./gradlew assembleDebug -PCORE_BASE_URL=https://YOUR_DEPLOYED_CORE_HOST
\`\`\`

Do not ship the placeholder \`https://core.example.invalid\` as a usable endpoint. Core must be deployed and the courier token configured before Android photo upload can work. Each courier must open the bot and send \`/start\` before the bot can message them.
