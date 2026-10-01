# SamuraiOS X10 Unified Control Plane

PostgreSQL is authoritative for incident state, transitions, kill switch and proof receipts.
Redis is not required for correctness; it can be added later as transport/acceleration.

The X10 service receives observed failures and candidate patches from the existing NEXUS/X10THINC recovery layer. It enforces the FSM and deterministic policy, sends approved candidates to the isolated sandbox runner, records evidence, and stops at HUMAN_APPROVAL_REQUIRED.

The sandbox runner is a separate trust boundary. It uses a disposable Docker execution, network disabled, read-only root filesystem, dropped capabilities, no-new-privileges, PID/CPU/memory limits and an allowlisted image. Do not expose the sandbox API publicly.

Required environment:
DATABASE_URL
SANDBOX_URL

Optional:
X10_MAX_ATTEMPTS=3
SANDBOX_IMAGE=node:22-bookworm-slim
SANDBOX_ALLOWED_IMAGES=node:22-bookworm-slim
