# SAMURAI Software Factory X10 — isolated MVP

This package is deliberately **not wired into the Express Core** and does not auto-run generated code in the Core process.

## Lifecycle
1. Validate module identifier and Python AST.
2. Write candidate into a unique staging file.
3. Execute one smoke test in Docker with network disabled, read-only root, dropped capabilities, non-root UID, PID/memory/CPU/time limits.
4. Publish with exclusive file creation (never overwrite).
5. Register SHA-256 metadata only. Generated modules are not imported into Core.

## CI verification\n\nGitHub Actions verifies the actual Docker runner (not only a fake runner): valid module execution, denied outbound networking, and rejection of incorrect output. Local unit tests skip these integration cases when Docker is unavailable. The default image tag is configurable through `SAMURAI_FACTORY_IMAGE`; pin it to a verified image digest before production.\n\n## Requirements
- Python 3.10+
- Docker Engine available to the host running the factory.
- A pre-pulled, pinned Python image is recommended. Before production, pin image by digest and scan/update it.

## Security boundary
AST checks are defense-in-depth, not a sandbox. Docker must be configured securely; the runner fails closed when Docker is unavailable. Do not mount secrets or the Core repository into the sandbox. For hostile multi-tenant workloads, use gVisor or a microVM runtime and independent worker hosts.

## Limitations
- The MVP has no dependency installation, network access, AI code generation, patch application, version promotion, rollback, or Express API integration.
- Registry and file publication are local filesystem operations, not a multi-host transactional store.
- Registry update failure after file publication requires operator reconciliation; this MVP does not claim crash-atomic two-resource transactions.
