# X29 Architect Core

X29 turns the Level 3-5 concept into a bounded execution architecture.

## Responsibilities

- plan work through an injected planner;
- run a deterministic Kill Critic decision;
- execute only when the critic returns `ALLOW`;
- verify execution through an injected verifier;
- accept `PROVEN` only when `verified === true`;
- queue bounded retries when verification fails;
- escalate after the retry limit;
- persist every state transition.

## Deliberately excluded

- autonomous merge/deploy;
- hidden network access;
- stealth/bypass behavior;
- market manipulation;
- arbitrary self-modifying code;
- direct shell/GitHub/Telegram access.

Those capabilities must be explicit adapters controlled by the NEXUS runtime and policy layer.

## Architecture

```
Mission
  -> Planner
  -> Kill Critic
  -> Executor
  -> Verifier
  -> Proof
  -> PROVEN / RETRY / ESCALATED
```

This is the implementation layer for the Architect/Sensei ideas, not a separate autonomous product.
