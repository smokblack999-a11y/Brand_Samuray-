# SAMURAI Software Factory X10 — isolated MVP

This package is deliberately **not wired into the Express Core** and never imports generated code into the Core process.

## Lifecycle

1. Validate the module identifier and Python AST.
2. Write the candidate into a unique staging file.
3. Execute the smoke test in Docker with networking disabled, a read-only root filesystem, dropped Linux capabilities, a non-root UID, and PID/memory/CPU/time limits.
4. Publish the completed file atomically with an exclusive hard link; an existing module is never overwritten.
5. Persist SHA-256 metadata in an atomic registry. If registry persistence fails, the newly published module is removed.
6. Verify the content hash before deletion; deletion uses a tombstone and restores the file if registry update fails.

## CI verification

GitHub Actions verifies the actual Docker runner, not only a fake runner: valid module execution, denied outbound networking, wrong-output rejection, and the full factory create/register/destroy lifecycle. The CI job checks that Docker daemon is available and pulls the configured sandbox image before running integration tests.

## Requirements

- Python 3.10+.
- Docker Engine available to the host running the factory.
- Configure `SAMURAI_FACTORY_IMAGE` to a verified image digest before production. The default `python:3.12-slim` tag is mutable and is used for development/CI only.

## Security boundary

AST checks are defense-in-depth, not a sandbox. Docker must be configured securely. The runner fails closed when Docker is unavailable. Do not mount secrets, the Docker socket, or the Core repository into the sandbox. For hostile multi-tenant workloads, use gVisor or a microVM runtime and independent worker hosts.

## Limitations

- The MVP has no dependency installation, network access, AI code generation, patch application, version promotion, rollback, or Express API integration.
- Registry and module storage are local to one host. POSIX file locking serializes registry writes, but this is not a distributed transaction store.
- If the process or host crashes between filesystem and registry operations, operator reconciliation may still be required.
