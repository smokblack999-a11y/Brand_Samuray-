# X10THINC → NEXUS Repair Runtime

workflow_run failure → queue → diagnosis → Kill Critic → sandbox → CI → proof → review.

Hard boundaries:
- resource identity is mandatory;
- Kill Critic runs before sandbox;
- dangerous added diff patterns fail closed;
- sandbox and CI are external evidence, never inferred;
- retry budget is bounded;
- proof requires an allowed transition and observed CI success;
- no auto-merge.

The GitHub adapter should map workflow failures, PR diffs, sandbox results and CI results into this transport-neutral state machine.