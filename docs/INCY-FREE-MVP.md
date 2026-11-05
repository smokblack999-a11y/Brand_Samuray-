# INCY $0 integration

This repository uses INCY as an optional client-side consumer of standard subscription and routing data. The MVP does not depend on INCY Premium API.

## Architecture

GitHub -> validated config -> raw file -> INCY

The repository owns the source files. INCY consumes the published profile/subscription. No paid INCY backend is required for this path.

## Files

- `config/incy/profile.json` — minimal routing profile.
- `config/incy/subscription.txt` — static subscription template. Real credentials must never be committed.
- `scripts/validate-incy.js` — deterministic validation and secret guard.
- `.github/workflows/incy-free.yml` — CI gate.

## Deep links

When a real published URL exists, INCY can consume the documented forms:

```
incy://routing/onadd/https://raw.githubusercontent.com/OWNER/REPO/main/config/incy/profile.json
incy://autorouting/onadd/https://raw.githubusercontent.com/OWNER/REPO/main/config/incy/profile.json
```

The exact deep-link behavior is provided by INCY's client documentation; this repository does not require Premium API access.

## Security rules

1. Never commit real VLESS UUIDs, private keys, passwords, or provider tokens.
2. Keep provider credentials in a secret-managed system or private provider endpoint.
3. Treat the GitHub-hosted files as public if the repository is public.
4. Do not put user identity, HWID, billing state, or private subscription data in this static layer.

## Cost boundary

### $0 MVP

- GitHub repository
- static JSON profile
- static subscription template
- GitHub Actions validation
- INCY client consumption

### Paid only when needed

- VPS/provider infrastructure
- custom domain
- private subscription backend
- database/HWID/billing
- monitoring/support
- paid provider/VPN capacity

INCY Premium API is intentionally outside the MVP dependency graph.
