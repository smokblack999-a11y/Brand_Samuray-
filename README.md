# SamuraiOS — Telegram Business AI Lead Agent

SamuraiOS Core превращает входящие Telegram Business сообщения в управляемый поток лидов:

`business_message → lead score → AI reply → human approval / auto-reply`

## Что уже есть

- Telegram Business webhook endpoint: `POST /api/telegram/webhook`
- Детектор и score лида 0–100
- Hot / warm / cold intent
- OpenAI Responses API integration
- Модель по умолчанию: `gpt-5.6-luna`
- Безопасный режим по умолчанию: `AUTO_REPLY=false`
- Автоответ включается только явно через `AUTO_REPLY=true`
- Health endpoint: `GET /health`
- Smoke tests для lead engine

Telegram Bot API поддерживает `business_connection` и `business_message`, а connected Business Bots могут обрабатывать сообщения бизнеса и отвечать от его имени.

## Быстрый запуск

```bash
cd core
cp .env.example .env
npm install
npm test
npm start
```

Заполнить в `.env`:

```env
OPENAI_API_KEY=...
TELEGRAM_BOT_TOKEN=...
BUSINESS_NAME=My Business
AUTO_REPLY=false
```

Ключи не коммитить. Использовать GitHub/VPS secrets или переменные окружения.

## MVP commercial gate

Не расширять продукт, пока не проверены реальные сообщения минимум одного пилотного бизнеса. Критерии:

1. Telegram Business Bot получает реальные сообщения.
2. SamuraiOS корректно определяет лидов.
3. AI генерирует полезный ответ без выдуманных условий.
4. Владелец бизнеса может безопасно включить автоответ.
5. Есть измеримый результат: время ответа, количество лидов и конверсии.

Следующий этап после прохождения gate: persistent storage → lead pipeline → dashboard → onboarding → billing.
