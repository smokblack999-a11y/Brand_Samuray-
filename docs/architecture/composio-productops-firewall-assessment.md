# SAMURAI — Composio ProductOps and Firewall Assessment

Date: 2026-11-15  
Status: Research and architecture decision; no external account connected and no credentials provisioned.

## Executive decision

**Useful for SAMURAI product engineering and multi-tool agents; not a WhatsApp privacy feature.**

Composio for Product & Design demonstrates cross-application workflows such as Figma → product specification → issue tracker, research synthesis in Notion, sprint planning from Linear + PostHog, and launch reporting. The platform provides tool discovery/execution, managed authentication, scoped sessions, and event triggers.

Recommended adoption: **optional, server-side integration in SAMURAI Core**, initially limited to product-engineering workflows. Keep the Android WhatsApp companion independent and fully usable without Composio.

## What it can add

1. **Design-to-delivery:** read selected Figma frames/comments, prepare a reviewed specification, and draft tickets in Notion or Linear.
2. **Engineering coordination:** route approved product tasks to existing GitHub/CI workflows. GitHub remains the authoritative source for commits, checks, branches, and PR state.
3. **Product analytics:** read approved PostHog metrics and produce a sprint/launch summary; never infer impact without source data.
4. **Event-driven runs:** subscribe to specific connected-app events and route signed webhooks into an allowlisted SAMURAI workflow.
5. **Multi-workspace separation:** keep distinct account connections and sessions for separate teams or owners.

## Security design required before implementation

### Trust boundary

- Composio integration runs only in SAMURAI Core or a dedicated server-side worker.
- Never embed a Composio API key, OAuth token, or connected-account credential in an Android APK, Figma file, public repository, or client-side JavaScript.
- Do not send WhatsApp chat bodies, contact lists, phone numbers, notification archives, or media to Composio. The ProductOps integration has no need for them.
- Keep this integration optional. With `COMPOSIO_ENABLED=false`, SAMURAI must start and all existing local-first functions must continue to work.

### Sessions and least privilege

- Create a distinct Composio session per SAMURAI owner/workspace identity.
- Explicitly allow only required toolkits and actions; do not expose the full app catalogue to the agent by default.
- Start with read-only Figma/Notion/Linear/PostHog actions. Permit draft creation only after review.
- Keep connected accounts separate. Never silently switch between personal and business workspaces.
- Use narrowly scoped OAuth scopes and revoke unused connections.

### Runtime guardrails

Use Composio Firewall as an additional classifier-based control, not the sole policy engine:

**Before tool execution (blocking):**
- Any merge, branch deletion, force-push, production deploy, payment, refund, external message, public post, data export, or destructive action not explicitly included in the current task.
- Any action targeting a workspace, repository, branch, recipient, or customer outside the task's allowlist.
- Any attempt to disclose credentials, private keys, customer data, or unreleased product information.

**After tool execution (blocking returned content):**
- Prompt-injection instructions contained in Figma comments, documents, tickets, issue bodies, emails, and other external content.
- Credential-like material and prohibited personal data in returned results.

Important: an after-execution result filter cannot undo a side effect that already happened. Therefore, deterministic preflight rules and explicit human approval remain mandatory for writes and high-impact actions.

### Local deterministic policy remains authoritative

Before any write, SAMURAI must independently validate:
- task ID and owner;
- repository/workspace/branch allowlist;
- action type and target;
- whether the action is read-only, draft-only, or externally consequential;
- whether the current task contains explicit approval;
- an idempotency key and audit record.

Composio Firewall supplements these controls. It does not replace Kill Critic, local authorization, sandbox verification, CI, or human approval.

## Proposed rollout

### Phase 0 — no credentials, no side effects
- Keep this assessment as the decision record.
- Map the first design-to-spec workflow and its exact read/write actions.
- Confirm Composio plan, pricing, data-processing terms, region, retention, audit logs, and OAuth scopes with the account owner.

### Phase 1 — read-only pilot
- One test workspace.
- Figma read/comments + Notion read + Linear read (or the selected issue tracker).
- Composio Firewall result checks enabled where available.
- No GitHub writes, no publishing, no external messaging, no WhatsApp data.
- Compare tool output against manually verified source records.

### Phase 2 — reviewed draft writes
- Permit draft Notion pages and draft tickets only.
- Require approval before posting or assigning external work.
- Store execution trace, tool name, target identity, policy decision, and result reference in SAMURAI audit logs. Do not log secrets or full customer payloads.

### Phase 3 — controlled event-driven automation
- Add only signed, allowlisted triggers.
- Enforce replay protection, idempotency, rate limits, queueing, retries, dead-letter handling, and a kill switch.
- Expand permissions one action at a time based on test evidence.

## Acceptance criteria

- SAMURAI starts normally with Composio disabled or unavailable.
- No secret appears in Git history, logs, APKs, or client bundles.
- Each session is bound to the expected owner and selected workspace.
- Unapproved high-impact writes are rejected locally before tool execution.
- Prompt-injection test fixtures in tool results are blocked before reaching the agent.
- Webhook signatures, replay protection, idempotency, and retry behavior are tested.
- A read-only pilot reconciles its results with source applications.
- No WhatsApp content is transmitted to this integration.

## Explicit non-goals

Composio does **not** provide:
- WhatsApp one-tick control or read/delivery receipt manipulation;
- access to WhatsApp's private message database;
- Anti-View-Once or guaranteed deleted-message recovery;
- a replacement for Android notification access or local encryption.

Those features remain governed by WhatsApp's own client/protocol boundaries.

## Sources

- Product & Design: https://composio.dev/product/composio-for-product-design
- Sessions and user-scoped runtime: https://docs.composio.dev/docs/how-composio-works
- Session configuration and tool filtering: https://docs.composio.dev/docs/configuring-sessions
- Toolkits and action-level restrictions: https://docs.composio.dev/docs/toolkits
- Firewall checks before/after execution and prompt-injection filtering: https://docs.composio.dev/docs/firewall
- Trigger delivery and webhook handling: https://docs.composio.dev/docs/triggers

## Decision

**GO** for a separately gated, server-side ProductOps pilot after an account owner approves the data-processing and plan terms.  
**NO-GO** for placing Composio in the Android WhatsApp companion, sending WhatsApp user data to it, or granting unrestricted agent access.
