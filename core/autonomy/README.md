# Samurai Reliability Autopilot

This is the product direction for SamuraiOS: a reliability control plane that turns failed CI into evidence-backed repair candidates.

## Why this is the wedge

Most AI coding tools optimize for writing code. This system optimizes for a measurable business event: **a failed build becoming a verified, reviewable repair**.

The loop is deliberately split into independent gates:

`failure → evidence → diagnosis → minimal patch candidate → Kill Critic → tests → PR → human approval`

No production deployment, auto-merge, secret access, or workflow-permission escalation is allowed by the default policy.

## Components

- `incident-schema.json` — machine-readable incident contract.
- `diagnose.js` — evidence-only OpenAI diagnosis layer.
- `repair-engine.js` — deterministic evidence gate.
- `kill-critic.js` — hard rejection gate for unsafe scope.
- `policy.json` — explicit limits and non-negotiable safety rules.
- `reliability-diagnosis.yml` — failure-triggered diagnosis workflow.

## Productization path

1. Connect GitHub App installation and receive Actions/PR events.
2. Normalize failures into incidents.
3. Deduplicate repeated failures by signature + repository + SHA.
4. Diagnose from logs and repository evidence.
5. Generate a minimal patch proposal.
6. Run Kill Critic before any patch is offered.
7. Run tests in an isolated environment.
8. Open a PR with evidence, not just an AI explanation.
9. Measure repair rate, false-fix rate, time-to-green, and rollback rate.
10. Charge for verified engineering outcomes rather than chat volume.

The highest-value future capability is a verified repair rate dashboard: customers see how many failures were detected, diagnosed, fixed, verified, rejected, and escalated to humans.
