# X20 — Verified Recovery
NEXUS accepts a recovery only after independent evidence.
Pipeline: workflow_run -> queue -> diagnosis -> bounded patch -> policy gate -> sandbox -> tests -> GitHub Draft PR -> CI workflow_run -> commit SHA match -> proof receipt.
Hard rules:
- no direct main push
- no auto-merge
- privileged workflow/infra/security changes require human review
- secrets never enter persisted evidence
- max attempts/files/runtime are enforced
- CI success is insufficient unless CI head_sha equals the recovery commit SHA
- proof receipts are tamper-evident SHA-256 records
GitHub's workflow_run event is the authoritative callback for completed workflow runs, and Git's REST API supports creating blobs, trees, commits and refs. Draft PRs remain non-mergeable until promoted for review.
