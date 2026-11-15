# SAMURAI Software Factory X10 — isolated MVP

This package is deliberately **not wired into the Express Core** and never imports generated code into the Core process.

## Lifecycle

1. Validate the module identifier and Python AST.
2. Run the Factory Source Critic before any Docker execution: reject import-time execution, decorators/default calls with import-time effects, unsupported async entry points, dynamic execution and selected process-launch/file-I/O calls.
3. Write the candidate into a private staging directory.
4. Execute the smoke test in Docker with networking disabled, a read-only root filesystem, dropped Linux capabilities, a non-root UID, and PID/memory/CPU/time limits.
5. Publish the candidate as an immutable version artifact.
6. Atomically switch the active module path and persist SHA-256 version metadata.
7. Promote a new version only after its sandbox smoke test passes.
8. Roll back to a previously validated immutable version.
9. Verify hashes before module deletion; deletion uses tombstones and restores files if the registry update fails.

## Migration from the original Software Factory prototype

- The original `generate_module(name)` file-writing step is replaced by `SoftwareFactory.create(name, source)`, which validates and stages supplied source without overwriting existing modules.
- The original same-process `spec_from_file_location(...).exec_module(...)` test/build path is replaced with `DockerSandboxRunner`.
- The original `build()` behavior that imported generated files into `sys.modules` is intentionally removed. The Core process must not import untrusted generated code.
- The original in-memory registry of live Python module objects is replaced with a validated, locked JSON registry containing SHA-256 hashes and version history.
- The original file deletion path is replaced with hash verification and tombstone-based cleanup.

## CI verification

GitHub Actions runs unit tests and real Docker integration tests: valid module execution, denied outbound networking, wrong-output rejection, timeout cleanup, full create/register/destroy, version promotion/rollback, and concurrent create attempts. CI verifies the Docker daemon and pulls the sandbox image before running these checks.



## Data-driven test contracts

Each module version stores a JSON-only contract with 1–20 cases and a 32 KiB maximum. Only modules with a stored Source Critic decision of `APPROVED` can be invoked; legacy modules without review evidence must be re-promoted and reviewed first. Every case contains exactly `input` and `expected`. The Docker runner invokes `run(input)` for each case and requires an exact result match. Runtime invocation also accepts one JSON input up to 32 KiB and returns one JSON result up to 32 KiB. Contracts are data, never executable test code. A promotion may supply a new contract; changing the contract alone creates a new version. Rollback restores the code review report and contract recorded for the selected version.

Example:

```json
{
  "cases": [
    { "input": [1, 2], "expected": [2, 4] },
    { "input": [-3, 0], "expected": [-6, 0] }
  ]
}
```

Use synthetic test data only. Do not place customer records, API tokens, passwords or personal information in test vectors or registry metadata.

## Requirements

- Python 3.10+.
- Docker Engine available to the host running the factory.
- Configure `SAMURAI_FACTORY_IMAGE` to a verified image digest before production. The default CI image is pinned to the SHA-256 manifest digest verified by GitHub Actions on 15 November 2026. Any override supplied through `SAMURAI_FACTORY_IMAGE` must also use an explicit `@sha256:<64-hex>` digest.

## Security boundary

AST checks are defense-in-depth, not a sandbox. Docker must be configured securely. The runner fails closed when Docker is unavailable. Do not mount secrets, the Docker socket, or the Core repository into the sandbox. For hostile multi-tenant workloads, use gVisor or a microVM runtime and independent worker hosts.




## Source review policy

Each accepted version stores a `sourceReview` report with the policy version and findings. Promotion is blocked unless the Factory Source Critic returns `APPROVED`; rollback restores the review metadata corresponding to the selected version. Legacy versions without recorded review data are explicitly marked `LEGACY_UNVERIFIED` rather than being presented as reviewed.

The existing Core `kill-critic.js` checks factual claims in customer-facing text (prices, availability, discounts, deadlines, completed actions and guarantees). It is not a source-code analyzer and is deliberately not applied to Python source. The Factory Source Critic is a separate static code policy; Docker remains the execution boundary, and AST checks are not a sandbox.

## Optional Express Core API bridge

The dependent HTTP integration branch adds `core/software-factory-http.js` and `core/software_factory_x10/worker.py`. It is separate from the standalone Factory MVP and remains disabled by default.

When deliberately deployed on a dedicated Docker-capable worker host, the configuration is:

```dotenv
SOFTWARE_FACTORY_ENABLED=true
SOFTWARE_FACTORY_MODE=docker
SOFTWARE_FACTORY_PYTHON=python3
SOFTWARE_FACTORY_ROOT=./data/software-factory-x10
SAMURAI_FACTORY_IMAGE=python:3.12-slim@sha256:5e2bdb1b0d542d5039cffb8181c65930093949194a65c365dfb1b0fe13a4fa5b
REQUEST_TIMEOUT_MS=30000
```

The Docker image must be preloaded before Core starts. Startup fails closed unless the feature flag is enabled with the exact `docker` mode, a configured Core API key, Python 3.10+, a healthy Docker daemon, the digest-pinned image present locally, and a Core request timeout of at least 30 seconds.

Authenticated endpoints under `/v1/software-factory`:

- `GET /modules`
- `POST /modules` with `{ "name": "processor", "source": "...", "contract": { "cases": [{ "input": [1, 2], "expected": [2, 4] }] } }`
- `POST /modules/:name/promote` with `{ "source": "..." }`
- `POST /modules/:name/rollback` with optional `{ "version": 1 }`
- `POST /modules/:name/run` with `{ "input": [1, 2, 3] }` — executes the active SHA-256-verified version in a fresh Docker container
- `DELETE /modules/:name`

All endpoints use the existing Core `requireApiKey` middleware and a per-IP rate limit. The Node bridge starts the Python worker with `spawn` and no shell, passes a minimal environment rather than Core secrets, enforces input/output/time limits, and returns sanitized errors with the Core request ID.

**Do not expose `CORE_API_KEY` to browsers, Telegram Mini Apps, clients, or generated modules.** These endpoints are for a trusted backend/admin integration only. This is not a public customer-facing module runtime. Keep `SOFTWARE_FACTORY_ENABLED=false` until the dedicated HTTP/Docker integration CI is green and the deployment host has been explicitly prepared.

## Limitations

- The MVP has no AI code generation, dependency installation, patch application, Express API integration, or autonomous GitHub PR creation from inside the factory.
- Generated modules are never imported into the Core process. The optional privileged `/run` endpoint invokes each active version in a fresh isolated Docker container; it is not a persistent in-process plugin API or a public customer-facing runtime.
- Run inputs and JSON results are limited to 32 KiB. Output must be JSON-serializable. Each invocation has a time limit and no network access.
- Registry and artifacts are local to one host. A POSIX workspace lock serializes module lifecycle transitions across local processes, and registry writes have their own lock. This is not a distributed transaction store or a multi-host shared filesystem protocol.
- A process or host crash between artifact promotion and registry update can still require operator reconciliation.
