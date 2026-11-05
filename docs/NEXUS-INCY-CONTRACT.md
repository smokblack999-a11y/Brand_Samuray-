# NEXUS ↔ INCY integration contract

## Purpose

INCY is a downstream consumer for the VPN/subscription layer. NEXUS owns orchestration and evidence; Kill Critic owns the fail-closed gate.

## Pipeline

```
config change
  -> INCY validator
  -> Kill Critic
  -> NEXUS contract gate
  -> GitHub CI
  -> publish raw config
  -> INCY consumes it
```

No Premium API is required by this contract.

## Boundaries

- NEXUS does not store provider credentials in the repository.
- Kill Critic blocks obvious credential material before publication.
- Static GitHub-hosted files are treated as public.
- Real user/HWID/billing state belongs in a future private backend.
- VPN capacity and VPS costs are outside this $0 integration layer.

## Failure behavior

If validation or Kill Critic fails, the workflow fails and publication must not be treated as verified.

## Future extension

When a private subscription backend is introduced, keep this contract and replace only the publication stage. Add authentication, per-user subscriptions, HWID, billing and audit storage there rather than putting secrets into Git.
