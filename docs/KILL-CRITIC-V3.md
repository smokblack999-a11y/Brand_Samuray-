# Kill Critic v3 — AI Change Firewall

Kill Critic v3 adds a deterministic Intent → Diff consistency gate.

## Decision contract

An AI-generated change is evaluated as:

1. declared intent;
2. actual changed paths;
3. sensitive capabilities;
4. scope constraints;
5. decision: ALLOW, HUMAN_REVIEW, or BLOCK.

The firewall never grants merge authority. Critical changes can be allowed for inspection while remaining subject to the higher-level policy/CI gates.

## Sensitive surfaces

- auth
- crypto
- TLS/SSL
- ACL/IAM/RBAC/permissions
- policy
- GitHub Actions workflows
- Docker/Compose
- Terraform/infrastructure
- agent/MCP configuration

## Example

Intent: `fix flaky parser test`

Changed:
`tests/parser.test.js`
`src/parser.js`
`src/auth/session.js`

Result:

`BLOCK / CRITICAL / UNEXPECTED_SENSITIVE_CHANGE`

This is intentionally deterministic and auditable.

## Production composition

`Intent Firewall → Kill Critic v2 evidence gate → sandbox → CI → Draft PR → Proof Receipt`

No auto-merge is implied by this component.
