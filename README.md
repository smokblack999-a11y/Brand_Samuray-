# SamuraiOS — Telegram Business AI Lead Agent

SamuraiOS Core превращает входящие Telegram Business сообщения в управляемый поток лидов:

`business_message → lead score → AI reply → human approval / auto-reply`

## Что уже есть

- Telegram Business webhook endpoint: `POST /api/telegram/webhook`
- Проверка Telegram webhook secret
- Дедупликация событий по business connection + chat + message ID
- Детектор и score лида 0–100
- Hot / warm / cold intent
- OpenAI Responses API integration
- Модель по умолчанию: `gpt-5.6-luna`
- Таймауты для OpenAI и Telegram API
- Защита административных API через `X-API-Key`
- Безопасный режим по умолчанию: `AUTO_REPLY=false`
- Health endpoint: `GET /health`
- OpenAI readiness check: `GET /health/openai`
- Smoke и E2E-подобные тесты для API, auth и Telegram webhook

Telegram Bot API поддерживает `business_connection` и `business_message`; connected Business Bots могут обрабатывать сообщения бизнеса и отвечать от его имени. urlTelegram Bot APIhttps://core.telegram.org/bots/api

## Быстрый запуск

```bash
cd core
cp .env.example .env
npm ci
npm test
npm start
```

Заполнить в `.env`:

```env
OPENAI_API_KEY=...
TELEGRAM_BOT_TOKEN=...
TELEGRAM_WEBHOOK_URL=https://YOUR-DOMAIN.example.com/api/telegram/webhook
TELEGRAM_WEBHOOK_SECRET=replace-with-random-secret
CORE_API_KEY=replace-with-admin-api-key
BUSINESS_NAME=My Business
AUTO_REPLY=false
```

Для webhook нужен публичный HTTPS endpoint. После запуска зарегистрировать webhook:

```bash
npm run set-webhook
```

Ключи и секреты не коммитить. Использовать GitHub/VPS secrets или переменные окружения.

## MVP commercial gate

Не расширять продукт, пока не проверены реальные сообщения минимум одного пилотного бизнеса. Критерии:

1. Telegram Business Bot получает реальные сообщения.
2. SamuraiOS корректно определяет лидов.
3. AI генерирует полезный ответ без выдуманных условий.
4. Владелец бизнеса может безопасно включить автоответ.
5. Есть измеримый результат: время ответа, количество лидов и конверсии.

Следующий этап после прохождения gate: persistent storage → lead pipeline → dashboard → onboarding → billing.
