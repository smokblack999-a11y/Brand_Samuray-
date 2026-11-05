# SAMURAI Unified Platform — repository and component audit

**Audit date:** 2026-11-05  
**Scope:** GitHub repositories visible to the connected account, selected feature branches, and the uploaded `samurai_sovereign_v54.tar.gz`.  
**Status:** architecture/inventory audit. This document does not claim that the components have been merged, deployed, or live-tested.

## Executive decision

Use **`smokblack999-a11y/Brand_Samuray-` → `core/`** as the canonical server/control-plane repository. Keep Android in `android/`. Treat the other repositories and the v54 archive as sources of modules to port selectively, not as competing production roots.

Do not merge whole feature branches into `main`: several are substantially diverged. Port individual modules only after reviewing their contracts, dependencies, security boundaries, and tests.

## Repository map

| Source | Observed contents | Decision |
|---|---|---|
| `Brand_Samuray-` (public, default `main`) | Node/Express Core, Telegram Business lead flow, API-key auth, rate limiter, dual-AI providers, agent control, NEXUS policy/recovery, Android app, CI workflows | **Canonical core** |
| `Samurai` (private) | NEXUS X17 JSONL/file queue and worker, recovery/demo core, sale materials | Port selected state-machine ideas; do not copy demo process-control claims |
| `project-samurai` (public) | HAMYLION/FastAPI event API, queue/worker, SAMURAI bridge, lead/problem/impact engines, X10Think | Reuse event contracts and selected lead/economics logic after hardening |
| `pylingo-pro` (public) | PyLingo Flask app, Python engine, Telegram integrations, market scanner, money strategies | Reuse lesson content/UI ideas only; rewrite execution and discard simulated financial signals |
| `MVPCore` (public) | Older Android MVP framework and sample MediaHub, GPS/EXIF, gallery/camera and Telegram sharing helpers | Reference implementation only; port selected media logic into current Android app after modernization |
| Uploaded `samurai_sovereign_v54.tar.gz` | Flask v54 dashboard, PyLingo, CodeVerter, SQLite tables, demo Workers/Cron, separate Telegram bot | Legacy UI/prototype source; do not deploy as-is |

## What is already present in canonical Core (`Brand_Samuray-/main`)

| Capability | Evidence in repository | Current interpretation |
|---|---|---|
| HTTP API | `core/server.js` | Express service exists |
| API authentication | `requireApiKey`, `X-API-Key` | Implemented for protected Core routes; verify every new route uses it |
| Rate limiting | `core/rate-limit.js` | In-memory limiter exists; not a distributed quota system |
| Lead intake/scoring | `core/lead-engine.js`, Telegram Business webhook | Implemented as rule-based scoring, not validated conversion prediction |
| AI providers | `core/dual-ai/providers.js` | OpenAI, Anthropic, Ollama adapters exist; Gemini is not present in this adapter |
| AI review | `core/dual-ai/critic.js` | Deterministic checks plus model-based review; not a substitute for security policy |
| Agent control | `core/agent-control.js` | Append-only JSONL job/event history and evidence-gated repair states |
| NEXUS policy | `core/nexus-resource-policy.js`, `core/nexus-repair-orchestrator.js` | Deterministic path/diff gates and repair state machine |
| Android | `android/app` | Existing native Android project; keep separate from server modules |
| CI | `.github/workflows/core.yml`, `core-x22.yml`, Android and recovery workflows | CI exists, but latest main-branch recovery-router workflows have failures (see CI section) |

The current Core is the strongest integration base. Its JSON/JSONL storage is not yet a general multi-tenant transactional database; avoid claiming PostgreSQL-grade durability or cross-process locking.

## Selective module decisions

### 1. SAMURAI Sovereign v54

- Keep the visual dashboard and API reference as a UI source; reimplement calls against authenticated Core endpoints.
- Do **not** copy `/api/run` or `/api/check`: both execute user-supplied Python with `exec()`. The Flask app binds to `0.0.0.0` and has no API authentication in the supplied archive.
- The existing `safe_run()` is not a general sandbox: it allowlists the first executable name but does not fully validate argument combinations, and it is not used by the PyLingo execution routes.
- Workers are SQLite rows with simulated status transitions, not managed OS processes.
- Cron stores schedule strings but has no scheduler/dispatcher.
- Dashboard seed statuses and `tasks_done` are not operational telemetry.
- CodeVerter is an Anthropic-dependent feature and needs auth, quotas, timeout, output limits, and spend accounting before exposure.
- Keep the Telegram bot as a separate process, but replace direct SQLite coupling with authenticated Core API/service calls. The v54 bot currently reads its own SQLite database directly and does not enforce `ADMIN_TG_ID`.

### 2. PyLingo Pro

- The repository's `app/main.py` repeats the unsafe `exec()` pattern and binds Flask to `0.0.0.0`; it is not a safe execution service.
- Preserve lesson definitions, exercise UX, and learning progression only after separating them from code execution.
- A real runner must be isolated (separate process/container where available), with CPU, memory, wall-clock, filesystem, network, and output limits. A restricted Python `builtins` dictionary alone is not a security boundary.
- `strategies/money_strategies.py` contains random simulated arbitrage spreads/trades and random success estimates. These are **not market data, executable trading logic, or evidence of profit**. Do not connect these methods to payments or financial accounts.
- `python/market.py` also generates random scores; market prices are fetched, but the score/heat layer is synthetic.

### 3. Money / Revenue

- The claimed `samurai_money_orchestrator.py` and matching 5-file package were not found in the inspected GitHub trees or in the v54 archive. Treat them as **not supplied / not verified** until their source is provided.
- `feat/revenue-pilot-economics` contains `core/revenue-pilot.js` plus unit tests. It calculates estimates from operator-supplied baseline/pilot metrics and explicitly warns that before/after differences do not prove causality. Good candidate for selective porting.
- Money pipeline should be: observed signal → evidence of demand → offer/product draft → verified unit economics → human-approved pilot → customer response → payment reconciliation → measured net margin.
- No model-generated demand score, sample price, random market signal, or estimated conversion should be labelled as a real sale or profit.

### 4. Commerce / payments

- `feat/samurai-commerce-orders-v1` contains substantial Commerce/order/storage/Stripe-test code and tests, but compare against main reports **283 commits ahead and 72 behind**. Do not merge the branch wholesale.
- The inspected Stripe order adapter explicitly rejects live-mode events and is test-mode oriented. It is not proof of production payment readiness.
- Port exact order, idempotency, money-minor-unit, webhook-signature, and reconciliation modules one at a time. Keep payment state server-authoritative; receipts or client callbacks must never mark an order paid.
- Require signature verification, replay/idempotency handling, read-back, and human approval for refunds or other irreversible payment actions.

### 5. Kill Critic / NEXUS / X10THINC

- Main already contains `nexus-resource-policy.js`, `nexus-repair-orchestrator.js`, `agent-control.js`, and a dual-AI critic.
- `x10thinc/kill-critic-vnext` contains a richer Kill Critic, real-life gates, and a hash-linked proof ledger, but it is **61 commits ahead / 89 behind** main. Port individual tested files; do not merge the branch as a whole.
- `feat/kill-critic-v3-intent-firewall-clean` contains intent-vs-diff checks and tests, but is **5 ahead / 71 behind** main. Review classification edge cases before porting.
- The X10THINC architecture in PR #130 correctly specifies fail-closed approvals, sandboxing, evidence, read-back, and no autonomous merge/deploy. Keep that governance baseline.
- Model-based review is advisory. Deterministic authorization, path allowlists, evidence checks, and human approval must decide whether an action is allowed.

### 6. Event bus / HAMYLION / workers

- `feat/samurai-core-vnext` contains a module registry and in-memory event bus with tests, but is **7 ahead / 9 behind** main. It is a useful lifecycle/event prototype, not a durable event broker: its event sequence, memory, and audit array are process-local.
- `project-samurai/infra/hamylion-core` has a FastAPI event API, idempotency, and Redis-stream queue/worker design. The current auth implementation returns a fixed `default-project`, so multi-tenant isolation is not complete.
- The bridge accepts a caller-supplied `X-API-Key` or falls back to its configured key; do not trust this forwarding boundary without redesigning service-to-service identity.
- The inspected `worker.py` has a suspicious compound `async with` statement after a semicolon; run `py_compile` before considering it usable.
- `Samurai/nexus-x17/server/agent-queue.js` persists jobs in JSON, but read-modify-write operations have no cross-process lock/transaction. Its polling worker also needs bounded concurrency, crash recovery, and idempotent claims before production.

### 7. Android MediaHub

- `MVPCore/sample/.../media` includes camera/gallery flow, GPS snapshot, EXIF coordinate writing, and Telegram sharing.
- It is an older Android Support Library sample. `ExifLocationWriter` silently swallows errors and does not verify the saved EXIF values.
- Reuse as a reference only. Port the relevant camera/GPS/EXIF behaviour into the existing `Brand_Samuray-/android` project using current AndroidX APIs, explicit permission handling, persisted URI access, and tests that read EXIF back after writing.

## Branch divergence — do not merge wholesale

| Branch | Ahead / behind main | Candidate content | Decision |
|---|---:|---|---|
| `feat/samurai-core-vnext` | 7 / 9 | module registry + in-memory event bus | Port selectively |
| `feat/revenue-pilot-economics` | 4 / 2 | economics calculator + tests | Strong selective candidate |
| `feat/kill-critic-v3-intent-firewall-clean` | 5 / 71 | intent/diff firewall + tests | Review then port |
| `x10thinc/kill-critic-vnext` | 61 / 89 | Kill Critic, proof ledger, gates, recovery modules | Port only after focused audit |
| `feat/x10thinc-hamylion-v3` | 52 / 72 | HAMYLION adapter, media ingest, auth additions | Selective review |
| `feat/samurai-commerce-orders-v1` | 283 / 72 | Commerce, orders, Stripe test, Android changes | Never merge wholesale |

## GitHub CI findings

- Draft PR **#130** (`feat/x10thinc-real-life-kill-critic-v1`) is documentation-only; its X22 CI run completed successfully. That does not validate the unimplemented architecture.
- On `main` commit `159dfc68fe9502d1e641343c924b936e25f074a1`, the latest observed X10THINK Agent Control Plane and NEXUS Recovery Router workflow runs failed. Their route jobs fail when required recovery URL/webhook secrets are absent or the remote recovery endpoint does not accept the event. The optional `x10think-recovery.yml` already has a skip-if-unconfigured pattern; the other two workflows should adopt equivalent optional-configuration behaviour or have their secrets/endpoints configured and verified.
- Do not rerun failing workflows repeatedly until the endpoint and secrets are understood. Do not put secrets into logs or repository files.

## Target architecture

```text
Android / Sovereign Web UI / Telegram Bot / CLI
                    |
            Authenticated API Gateway
                    |
        SAMURAI Core (canonical Node service)
          |         |           |
       Lead/CRM   AI Gateway   Commerce
          |         |           |
          +---- Unified Event Contract ----+
                    |
             Durable Job Queue
                    |
       Worker Adapters (allowlisted jobs)
          |         |           |
       Revenue   PyLingo     NEXUS/GitHub
          |         |           |
          +---- Evidence + Audit Ledger ----+
                    |
                Kill Critic
                    |
         Verify / Read-back / Human gate
                    |
            Metrics / Net margin
```

Design rule: one Core API and one canonical identity/data model; modules stay separately testable and can run as separate processes. Do not collapse every subsystem into one giant Flask file or one monolithic Python process.

## Implementation sequence and acceptance gates

1. **P0 — secure baseline:** inventory every route; enforce API auth and per-route rate limits; bind local Termux development to loopback; remove public arbitrary `exec()`; rotate any exposed provider/bot keys; escape UI output; add security regression tests.
2. **P1 — integration contract:** define tenant/workspace identity, event schema, idempotency key, request ID, error format, provider adapter interface, audit event schema, and module health contract.
3. **P1 — core lifecycle:** port module registry only if lifecycle ownership is clear; durable queue and transactional state must not rely on process-local Maps or unlocked JSON read-modify-write.
4. **P1 — AI Gateway:** keep provider keys server-side; support only explicitly implemented adapters; add timeout, cancellation, bounded retry, usage/cost logging, redaction, quotas, and contract tests.
5. **P2 — revenue pilot:** port the economics calculator; add verified customer evidence and actual payment reconciliation. Do not claim positive ROI from estimates alone.
6. **P2 — Commerce:** port order/money modules with isolated tests; begin with Stripe test mode; verify webhook signatures and idempotency before any live billing.
7. **P2 — PyLingo:** port lesson content and UI; execute code only through a hardened isolated runner with resource limits and adversarial tests.
8. **P3 — real workers/scheduler:** implement supervised process adapters and a real scheduler with durable claims, bounded concurrency, retry/dead-letter policy, cancellation, and truthful health.
9. **P3 — Android:** adapt MediaHub GPS/EXIF features into current AndroidX app; verify coordinates by reading EXIF back on device.
10. **Release gate:** run CI, security tests, live provider tests only when credentials are configured, Termux smoke tests on the user's device, and a documented acceptance report. No merge/deploy/payment action without explicit approval.

## Evidence labels

- **Confirmed in source:** file/route/function is present.
- **Tested in CI:** a named workflow run completed with a result.
- **Live-tested:** a real external service/device request was performed and read back.
- **Blocked:** requires device, secret, provider, or permission unavailable to this audit.
- **Not implemented:** no executable implementation found in inspected sources.

A source file existing is not proof that its feature works. A passing unit test is not proof of production safety or customer demand.
