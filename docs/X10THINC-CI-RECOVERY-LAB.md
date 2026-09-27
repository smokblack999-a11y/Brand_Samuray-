# X10THINC CI Recovery Lab

A deterministic, non-production demonstration of the commercial recovery contract.

## What this closes

The lab is designed to remove the main buyer objections before a paid pilot:

| Objection | Evidence mechanism |
|---|---|
| "Show me something real." | Reproducible GitHub Actions workflow |
| "Can it refuse unsafe changes?" | `blocked` scenario with protected-path verdict |
| "What if the repair still fails?" | `failing` scenario ending in `ABSTAIN` |
| "Can I inspect the result?" | JSON Proof Receipt + uploaded artifact |
| "Will it deploy automatically?" | Workflow has read-only contents permission and no deploy/merge step |
| "Can you prove what happened?" | Source revision + rule + verification + SHA-256 evidence |
| "Do I have to hand over production access?" | Lab requires no customer secrets or production credentials |

## Run it

Open GitHub Actions → **X10THINC CI Recovery Lab** → **Run workflow**.

Run all three scenarios:

1. `safe` — bounded repair path reaches **VERIFIED**.
2. `blocked` — protected-path change is **BLOCKED** before verification.
3. `failing` — verification fails and the final state is **ABSTAIN**.

The `failing` run is intentionally non-green. That is expected and demonstrates that the system does not manufacture a successful proof when verification fails.

## Customer demo

The live narrative is:

```
CI FAILURE
   ↓
RCA
   ↓
KILL CRITIC
   ├── BLOCK → evidence + reason
   └── ALLOW → bounded repair
                    ↓
                 SANDBOX
                    ↓
                  TESTS
                    ↓
                PROOF RECEIPT
```

For a real customer repository, the same contract must additionally produce a human-reviewable Draft PR. This lab does not pretend to be a customer integration.

## Buyer-safe boundaries

- no automatic merge;
- no production deployment;
- no customer credentials;
- GitHub Actions permission is `contents: read`;
- deterministic fixture, not a claim of production-scale reliability;
- failed verification cannot become a VERIFIED receipt.

## Conversion event

Do not sell the entire X10THINC platform from this demo.

The conversion ask is:

> Give us one non-production repository and one failing workflow. We will measure time-to-proof and return a reviewable recovery package.

Primary metric:

**TIME_TO_PROOF** = elapsed time from a reproducible CI failure to a verified, reviewable repair package with evidence.

Secondary metrics:

- time-to-root-cause;
- repair verification rate;
- unsafe-change block count;
- false-positive/false-negative findings;
- Draft PR acceptance;
- pilot-to-recurring conversion.
