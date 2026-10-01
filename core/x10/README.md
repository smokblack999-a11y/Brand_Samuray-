# SamuraiOS X10 Unified Control Plane

X10 unifies Incident, strict FSM, Policy Gate, Kill Switch, Sandbox contract and Proof Receipt.

The repository currently uses a deterministic local authoritative adapter for development/tests. The PostgreSQL schema is included separately. Redis is not authoritative.

Flow:
DETECTED -> RECALLING_PATTERNS -> PROPOSING_PATCH -> POLICY_CHECKING -> SANDBOX_PENDING -> SANDBOX_RUNNING -> SANDBOX_VERIFIED -> CRITIC_EVALUATION -> PROOF_GENERATION -> HUMAN_APPROVAL_REQUIRED

AI proposes. Policy, Sandbox, Critics and Proof constrain execution. Merge remains human-controlled.
