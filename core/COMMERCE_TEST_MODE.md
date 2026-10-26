# SAMURAI Commerce — тестовый режим

Этот модуль предназначен для разработки и тестового пилота. Он не является готовой production-платёжной системой.

## Поведение по умолчанию

- `COMMERCE_ENABLED` выключен, если его явно не задать.
- `COMMERCE_MODE` должен быть ровно `test`.
- Commerce-маршруты и Stripe test webhook недоступны при `NODE_ENV=production`.
- `simulate-payment` — отдельная симуляция. Она не подтверждает реальное поступление денег.
- JSON-хранилище рассчитано на один процесс и локальные испытания, не на несколько реплик и не на production.

## Разрешённые test-mode настройки

Копируй шаблон `core/.env.stripe-test.example` в локальный `core/.env` и замени пустые ключи только тестовыми значениями. Не добавляй секреты в Git.

```env
NODE_ENV=development
COMMERCE_ENABLED=true
COMMERCE_MODE=test
COMMERCE_TEST_PAYMENTS_ENABLED=false
STRIPE_TEST_MODE=true
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_SUCCESS_URL=https://your-https-site.example/payment/success
STRIPE_CANCEL_URL=https://your-https-site.example/payment/cancel
```

Для Checkout требуются обе настройки `COMMERCE_ENABLED=true` и `STRIPE_TEST_MODE=true`, `COMMERCE_MODE=test`, тестовый `sk_test_` ключ, `whsec_` webhook secret и HTTPS success/cancel URL. Нельзя использовать `sk_live_`.

## Telegram Mini App

Страница магазина находится по пути `core/mini-app/` и раздаётся Core на `/mini-app/`. После HTTPS-развёртывания владелец бота должен отдельно настроить Web App URL в меню бота (например, через BotFather) на `https://<ваш-домен>/mini-app/`. Этот PR не меняет настройки BotFather и не выполняет развёртывание. При открытии внутри Telegram Mini App передаёт `X-Telegram-Init-Data`; backend проверяет подпись и сам определяет владельца заказа. Если Stripe test Checkout не настроен, интерфейс показывает ошибку, позволяет проверить или отменить неоплаченный заказ и не имитирует поступление денег.

## API

- `GET /v1/commerce/catalog` — публичные поля тестового каталога; данные выдачи не включаются.
- `POST /v1/commerce/orders` — JSON с `sku` и необязательным `quantity`; сумма вычисляется сервером.
- `GET /v1/commerce/orders/:id` — заказ текущего проверенного Telegram WebApp-пользователя.
- `POST /v1/commerce/orders/:id/checkout` — создать или повторно получить Stripe Checkout Session в test mode.
- `POST /webhooks/stripe` — подписанный webhook Stripe test mode. Его raw body разбирается до общего JSON middleware.
- `POST /v1/commerce/orders/:id/cancel` — отменить неоплаченный тестовый заказ.
- `POST /v1/commerce/orders/:id/simulate-payment` — только локальная симуляция; дополнительно требует `COMMERCE_TEST_PAYMENTS_ENABLED=true` и никогда не доступен в production.

Каждый маршрут проверяет Telegram WebApp initData через существующий `requireWebAppAuth`. `customerId` берётся только из подтверждённого сервером `req.telegramWebApp.user.id`, а не из тела запроса или query-параметра. Никогда не помещай `CORE_API_KEY`, Stripe secret или webhook secret в браузер, Telegram Mini App или APK.

## Проверки перед дальнейшей интеграцией

Из `core/` после установки зависимостей запусти:

```bash
node --check server.js
node --check commerce.js
node --check commerce-http.js
node --check stripe-test.js
node --test
```

Потом проверь на настоящем Core полный тестовый цикл: создать заказ → создать Stripe test Checkout Session → доставить подписанный webhook → убедиться, что цифровой demo-заказ выдан ровно один раз → повторно доставить событие → перезапустить Core и проверить сохранённое состояние. Для физического demo-заказа статус должен оставаться `test_paid`, без утверждений о доставке.

## Не включать для реальных клиентов

Перед любым реальным платёжным пилотом нужны транзакционная база данных, проверенная миграция, реальная проверка sandbox E2E против Stripe, надёжная повторная выдача через outbox/очередь, резервное копирование и восстановление, политика возвратов и налогов, мониторинг, а также юридическая проверка приёма платежей в выбранной стране. Текущий JSON store не обеспечивает безопасность остатков при нескольких процессах.
