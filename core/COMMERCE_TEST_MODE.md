# SamuraiOS Telegram Commerce — test mode

Commerce is an MVP layer for the existing Telegram Business webhook. It is not a live payment integration.

## Safety boundary

- `PAYMENT_MODE` defaults to `test`; this build only records simulated payment confirmation.
- No card details are collected and no money is charged.
- `/buy SKU [quantity]` creates a pending test order. It does not create a checkout URL.
- An authenticated operator can mark a test order paid through the API. This decrements stock and returns the configured digital delivery payload, or marks a physical order as requiring fulfilment.
- Keep `AUTO_REPLY=false` until the webhook is configured and tested. Telegram commands are `/catalog`, `/price SKU`, `/stock SKU`, and `/buy SKU [quantity]`.
- Catalog starts empty. Add real product information through the authenticated API; do not put private download secrets in product names or descriptions.

## Configure a product

Set `CORE_API_KEY` and run the Core service. Use the same key in the `X-API-Key` header:

```sh
curl -X PUT "$CORE_URL/api/commerce/products/ITEM-001" \
  -H "X-API-Key: $CORE_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Demo digital item","type":"digital","priceMinor":1999,"currency":"USD","stock":10,"deliveryPayload":"Replace-with-a-test-delivery-instruction"}'
```

`priceMinor` is an integer in the currency's minor units. `type` must be `digital` or `physical`. `stock` must be a non-negative integer.

## Create and confirm a simulated order

```sh
curl -X POST "$CORE_URL/api/commerce/orders" \
  -H "X-API-Key: $CORE_API_KEY" -H 'Content-Type: application/json' \
  -d '{"sku":"ITEM-001","quantity":1,"customerId":"test-customer"}'

curl -X POST "$CORE_URL/api/commerce/orders/ORDER_ID_FROM_RESPONSE/test-pay" \
  -H "X-API-Key: $CORE_API_KEY"
```

Use the order ID returned by the first command. The second command is a simulation, not a payment-provider webhook.

## Current limits

- Orders and inventory are stored in a local JSON file under `DATA_DIR`; this is suitable for local testing, not concurrent multi-instance production.
- There is no real payment provider, checkout session, verified payment webhook, shipping integration, or automatic file hosting in this module.
- For digital products, `deliveryPayload` is returned only after test payment and is intentionally omitted from public catalog responses. Treat it as sensitive.
- Physical orders require a human fulfilment step.
- Product prices are supplied by the operator; the bot does not invent prices or stock.

Run `npm test` in `core/` before using the test workflow.