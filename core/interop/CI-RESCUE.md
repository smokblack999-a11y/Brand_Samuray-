# SAMURAI CI Rescue v0.1

## Product loop

`GitHub CI FAIL -> job logs -> bounded evidence -> Kill Critic -> reproduction -> causal check -> patch candidate -> isolated sandbox -> verification -> PR`

The implementation intentionally separates **diagnosis**, **patch proposal**, and **repository mutation**.

## Current guarantees

- GitHub Actions job logs are bounded and secret-redacted before evidence is returned.
- Patch candidates require both reproduction and causality; diagnosis alone cannot authorize a patch.
- Patch strategies are allow-listed and limited to a small file set.
- Sandbox execution uses `shell:false`, an explicit working directory, and a hard timeout.
- A successful process is not by itself enough to declare a job `VERIFIED`; the surrounding state machine still requires critic, regression, and verification gates.
- No automatic merge is performed by this module.

## v0.1 scope

Start with JavaScript/TypeScript + Node + GitHub Actions. Do not widen the language matrix until the evidence/verification loop is reliable.

## Next implementation gate

The next production step is a disposable repository workspace that can checkout the failed commit, apply a bounded candidate, run the repository's declared test command, and return machine-readable evidence. Only that result should be allowed to set `reproduction` / `causality` and unlock a patch candidate.
