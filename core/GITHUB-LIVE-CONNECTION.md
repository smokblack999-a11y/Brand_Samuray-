# X29 Live GitHub Connection

The runtime includes an optional live GitHub REST transport.

Environment variables:
- GITHUB_TOKEN
- GITHUB_OWNER
- GITHUB_REPO
- GITHUB_WEBHOOK_SECRET

The token is read only from the process environment and is never persisted in the repair queue.

The live transport can:
- read workflow runs;
- create a repair branch from the repository default branch;
- create/update bounded file contents on that branch;
- create a pull request.

Activation is intentionally conditional: the REST client is created only when all three GitHub identity variables are present.

Important: credentials alone do not enable autonomous VERIFIED. X29 still requires a candidate provider, Kill Critic approval, sandbox proof, PR evidence, and a successful post-repair CI run.
