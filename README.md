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

## Revenue Control Plane — X26/X27/X28/X31

Current branch adds a measurable revenue loop on top of the Telegram lead core:

`lead/event → X26 decision → action → X27 outcome → attribution → cost → learning → X26 calibration`

### Revenue API

- `POST /api/revenue/decision` — choose the next economic action for a tenant.
- `POST /api/revenue/outcome` — record WON/LOST/UNKNOWN/REFUNDED/CANCELLED outcome with idempotent event identity.
- `POST /api/revenue/cost` — record realized execution cost and provider/model telemetry.
- `POST /api/revenue/rca` — analyze loss telemetry into evidence-backed hypotheses.
- `GET /api/revenue/summary` — current attributable revenue, gross profit, cost and economic multiple.
- `GET /api/revenue/ledger` — inspect tenant revenue records.
- `GET /api/revenue/integrity` — verify the tenant hash chain.

All revenue endpoints require `X-API-Key`. Tenancy can be selected with `X-Tenant-Id` or `TENANT_ID`.

### Attribution rules

X27 does not equate contact with causality. Assisted attribution uses the estimated incremental share above baseline conversion probability. A WON event without qualifying evidence is not treated as automatically 100% Samurai-generated revenue.

### Persistence status

The current runtime ledger is file-backed for a single Core process. `core/revenue-schema.sql` defines the PostgreSQL target shape for the production multi-worker implementation. Do not deploy the file ledger as a horizontally scaled authoritative database.

### Calibration

X26 starts with a deterministic heuristic probability. Observed learning records are blended into future action probabilities with a conservative Bayesian-style prior so sparse samples do not dominate early decisions.

### X29–X32 layers

X29 `experiment-engine.js` supports deterministic variant assignment, explicit holdouts, Wilson intervals and outcome analysis.

X30 `revenue-genome.js` groups realized outcomes by segment and action so future decisions can use observed patterns.

X31 `revenue-black-box.js` creates a SHA-256 hash chain. The integrity endpoint detects accidental or unauthorized record modification inside the ledger.

X32 `autonomous-revenue-loop.js` models the lifecycle from discovery through audit, decision, execution, outcome, attribution and learning.

### Autonomous send gate

`REVENUE_AUTO_GATE=true` adds two independent conditions before a Telegram AI reply can be sent automatically:

`Revenue Gate → allowed economic action`

`Kill Critic → PASS`

When the critic is unavailable, the candidate is blocked rather than sent.

### Shadow-mode rollout

Use `REVENUE_SHADOW_MODE=true` before autonomous sending. Samurai computes the revenue decision, runs cost telemetry, records `EXECUTION.status=SHADOWED`, and does not send the customer message.

Recommended promotion sequence:

1. Shadow mode: collect decisions and real business outcomes.
2. Compare predicted incremental profit with realized attributable gross profit.
3. Calibrate action probabilities and verify ledger integrity.
4. Enable `REVENUE_AUTO_GATE=true` while keeping a conservative budget.
5. Only after Kill Critic PASS + Revenue Gate approval should automatic sending be enabled.
6. Disable shadow mode only after duplicate delivery, refund and opt-out paths are tested.

### Production gate

Before horizontal scaling, switch authoritative storage to PostgreSQL, install and lock the `pg` dependency, run the schema, configure strict tenant-bound API keys, and test duplicate delivery/restart/refund paths under load.

### Evidence

X31 adds SHA-256 hash chaining to decision/outcome/cost/learning records. This makes accidental modification detectable through `GET /api/revenue/integrity`; it is not a cryptographic signature or an external immutable audit service.

## MVP commercial gate

Не расширять продукт, пока не проверены реальные сообщения минимум одного пилотного бизнеса.

1. Telegram Business Bot получает реальные сообщения.
2. SamuraiOS корректно определяет лидов.
3. AI генерирует полезный ответ без выдуманных условий.
4. Владелец бизнеса может безопасно включить автоответ.
5. Есть измеримый результат: время ответа, количество лидов и конверсии.

Следующий этап после прохождения gate: persistent storage → lead pipeline → dashboard → onboarding → billing.
