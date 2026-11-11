# SAMURAI Seller Agent Integration V1 — branch implementation notes

Status: isolated integration prototype on `feat/samurai-seller-agent-integration-v1`. This is not a production release and is not merged.

## What this branch connects

- Seller Memory is instantiated lazily; importing the module no longer creates a SQLite database or opens a file handle.
- Telegram Business webhook resolves `business_connection_id` through a server-only `SELLER_TENANT_MAP_JSON`.
- Only approved knowledge and approved practice examples are retrieved for that mapped tenant.
- The retrieved items are passed into `generateReply` as bounded context. The prompt treats customer text as untrusted and forbids memory from serving as evidence of current stock, current pricing, payment state, or completed actions.
- Seller-owner API operations derive `tenantId` and `actorId` from server configuration. Request JSON fields with those names are ignored.
- Knowledge and practice examples are created as pending and require explicit owner approval before retrieval.
- Seller learning audit rows reject SQL UPDATE and DELETE through database triggers.
- The Telegram Business webhook now acknowledges a valid business message after successful processing. A processing error returns a non-2xx response so Telegram can retry; failed lead claims can be reclaimed by the existing `claimEvent` behavior.

## Server-only configuration

Set `SELLER_LEARNING_DB_PATH` and `SELLER_TENANT_MAP_JSON` in the Core process environment. Do not commit live values.

Example shape only:

```json
{
  "TELEGRAM_BUSINESS_CONNECTION_ID": {
    "tenantId": "seller-001",
    "ownerId": "telegram-owner-id",
    "ownerToken": "REPLACE_WITH_A_UNIQUE_RANDOM_SECRET_AT_LEAST_32_CHARACTERS"
  }
}
```

The object key must be the exact Telegram Business Connection ID. `tenantId` and `ownerId` are server-controlled identifiers. `ownerToken` is a per-business secret; store it only in the server secret manager/environment and never in a client application.

An unmapped Business Connection receives no Seller Memory context. Existing generic lead handling remains available. Invalid mapping JSON fails closed for Seller Agent operations.

## Owner API

All routes require these headers:

- `X-Telegram-Business-Connection-Id`: exact key configured in `SELLER_TENANT_MAP_JSON`.
- `X-Seller-Owner-Token`: corresponding per-business owner token.

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/seller/knowledge?status=pending` | List this tenant's knowledge |
| POST | `/api/seller/knowledge` | Add a pending knowledge entry |
| PATCH | `/api/seller/knowledge/:id` | Edit entry; resets it to pending and increments version |
| POST | `/api/seller/knowledge/:id/review` | Approve or reject knowledge |
| GET | `/api/seller/practice?status=pending` | List this tenant's practice examples |
| POST | `/api/seller/practice` | Save customer context, AI draft, and seller correction as pending |
| POST | `/api/seller/practice/:id/review` | Approve or reject a correction |
| GET | `/api/seller/audit` | Read this tenant's audit events |

Approval body shape:

```json
{ "decision": "approved" }
```

Practice creation body shape:

```json
{
  "customerContext": "Customer asks whether discount is available",
  "aiDraft": "The AI draft goes here",
  "sellerFinal": "The seller's corrected final answer goes here",
  "outcome": "edited",
  "reason": "Discounts are not allowed"
}
```

Do not send `tenantId` or `actorId`; the API ignores them and supplies trusted values from the configured map.

## Safety boundaries and remaining work

- `AUTO_REPLY=false` remains the default. Kill Critic remains in the auto-send path.
- Seller Memory is retrieval-based; no model fine-tuning or autonomous model-weight updates occur.
- Commerce remains the source of truth for catalog pricing, order totals, payment state, and delivery state.
- The owner API is an authenticated backend surface, not a finished owner dashboard or Telegram command flow.
- Corrections are not automatically captured from every outgoing/edited Telegram message; an authorized owner/operator must submit a practice example.
- The SQLite store is intended for one Core instance. Do not run multiple Core replicas against the same SQLite file.
- Audit triggers prevent normal SQL UPDATE/DELETE operations but are not cryptographic tamper-proof storage against an administrator who can modify the database file or schema.
- A persistent outbound seller-reply outbox with bounded retry/dead-letter handling is still required. This iteration returns a webhook error before acknowledgement to allow Telegram retry, but a network-ambiguous Telegram send can still cause a duplicate reply.
- Knowledge export, deletion/retention workflows, dashboard UX, authenticated owner onboarding, and PostgreSQL multi-instance support remain outstanding.
- No live Telegram Business staging run, payment, delivery, paid pilot, or production deployment is claimed by this branch.

## Verification required before merge

1. Run all `core` tests with the exact branch commit.
2. Verify tenant map parsing and owner token behavior with two separate configured Business Connections.
3. Verify approved entries affect a mocked OpenAI Responses request and pending/rejected entries do not.
4. Force a webhook processing failure and confirm Telegram receives a non-2xx response; then confirm retry does not create a duplicate lead.
5. Test manual correction submission, approval, retrieval, edit-reset-to-pending, and tenant isolation.
6. Run a real seller-authorized Telegram Business staging test with `AUTO_REPLY=false`.
7. Implement and test durable outbound reply outbox, retention/export/delete controls, and owner dashboard before production.
