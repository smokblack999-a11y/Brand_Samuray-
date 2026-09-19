# X29 Runtime

X29 Runtime is the bounded bridge between the persistent queue, Architect Core and X28.

Pipeline:

workflow_run → durable queue → X29 planner → X28 diagnosis/Kill Critic → sandbox → CI verifier → proof/stop.

All execution capabilities are injected adapters. The default runtime cannot edit a repository, merge, deploy or claim VERIFIED.

Required production adapters:
- candidateProvider: obtains a bounded repair proposal from an approved model/service.
- sandbox: executes only allowlisted commands in an isolated environment.
- pullRequest: creates a reviewable PR after proof.
- ciVerifier: observes GitHub CI and returns evidence.
