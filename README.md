# SamuraiOS — Telegram Business AI Lead Agent

SamuraiOS Core превращает входящие Telegram Business сообщения в управляемый поток лидов:

`business_message → lead score → AI reply → human approval / auto-reply`

## Что это за репозиторий

Это **единый рабочий репозиторий** для SamuraiOS / X10THINC / NEXUS. GitHub здесь используется как источник кода, CI-проверок и контролируемых изменений.

### Главная линия

- `main` — только код, который считается текущей рабочей линией.
- Pull Request — место для проверки новых функций перед попаданием в `main`.
- Draft PR — незавершённая разработка; не считать готовым продуктом.
- Старые эксперименты и E2E-пробы не должны смешиваться с production-потоком.

### Слои проекта

| Слой | Роль |
|---|---|
| **SamuraiOS Core** | Telegram Business, лиды, AI-ответы, API |
| **X10THINC** | reasoning/control layer и доказательная логика |
| **NEXUS** | orchestration / recovery runtime |
| **Kill Critic** | deterministic safety/evidence gate |
| **GitHub Actions** | CI, Android build, recovery routing и проверки |
| **Android** | сборка SamuraiOS APK |

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

## CI / automation

Основные workflows:

- `.github/workflows/core.yml` — Core tests + Docker build + OpenAI smoke
- `.github/workflows/core-x22.yml` — отдельный X22 CI-контур
- `.github/workflows/android.yml` — Android APK build
- `.github/workflows/x10think-recovery.yml` — X10THINK recovery enqueue
- `.github/workflows/nexus-recovery-router.yml` — NEXUS workflow router
- `.github/workflows/openai-secret-check.yml` — ручная/пуш-проверка OpenAI authentication

Экспериментальный X20 failure-probe workflow удалён из `main`: он был предназначен только для искусственного падения CI.

## X10THINC Artifact Relay

Новая X10THINC-функция разрабатывается отдельно в PR, а не напрямую в `main`.

Цепочка:

`source SHA → Kill Critic → tests → Docker artifact → SBOM/provenance → immutable digest → registry → release manifest`

Главное правило: один исходный SHA должен однозначно связываться с проверенным артефактом. Повторная сборка может использовать content-addressed cache.

## Безопасность

Ключи и секреты не коммитить. Использовать GitHub Secrets или переменные окружения.

Kill Critic является **fail-closed базовым защитным gate**, а не полной системой аудита безопасности. Перед production-использованием нужны дополнительные проверки secret scanning, dependency/security scanning и реальные CI-доказательства.

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

Для webhook нужен публичный HTTPS endpoint:

```bash
npm run set-webhook
```

## MVP commercial gate

Не расширять продукт, пока не проверены реальные сообщения минимум одного пилотного бизнеса.

1. Telegram Business Bot получает реальные сообщения.
2. SamuraiOS корректно определяет лидов.
3. AI генерирует полезный ответ без выдуманных условий.
4. Владелец бизнеса может безопасно включить автоответ.
5. Есть измеримый результат: время ответа, количество лидов и конверсии.

Следующий этап после прохождения gate: persistent storage → lead pipeline → dashboard → onboarding → billing.


## X10THINC GitHub Recovery + Revenue RCA

The recovery layer accepts GitHub `workflow_run` events through:

- `POST /api/recovery/github/webhook` — HMAC SHA-256 authenticated GitHub webhook.
- `POST /api/recovery/ci` — internal/API-key recovery route.
- `GET /api/recovery/stats` — recovery counters and latest RCA.

The flow is:

`workflow_run → signature verification → delivery dedupe → failure classification → RCA hypothesis → Kill Critic → persisted evidence`

GitHub's `workflow_run` event is designed for completed workflow activity, and GitHub Apps can use the Checks API to publish richer CI results. urlGitHub workflow_run webhookshttps://docs.github.com/en/webhooks/webhook-events-and-payloads

For this branch, the recovery service deliberately stops at an evidence-backed action proposal. It does not auto-merge or execute destructive remediation. A later agent can consume the RCA and create a Draft PR after its patch passes the Kill Critic and sandbox checks.
