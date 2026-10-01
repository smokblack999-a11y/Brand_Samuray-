# SAMURAI® Command Launcher

Responsive command surface for the unified SamuraiOS / NEXUS / X10THINC stack.

## Design intent

The launcher is a product surface, not a decorative landing page. It exposes three explicit control domains:

- **SAMURAI®** — AI Workspace OS: workspace, leads, terminal and Telegram.
- **NEXUS** — infrastructure orchestration and recovery runtime.
- **X10THINC** — reasoning, evidence and autonomous control layer.

## Runtime contract

Each module emits a real browser event:

- `samurai:launch`
- `samurai:open`
- `nexus:open`
- `x10thinc:open`

The payload contains `module`, `route` and an ISO timestamp.

Routes are deliberately not faked. The host application can bind them through:

```js
window.SAMURAI_ROUTER = async (route, payload) => {
  // connect to the real application router here
};
```

Or call:

```js
window.SAMURAI_LAUNCH("NEXUS");
```

## Safety boundary

The launcher never invents backend availability, credentials, CI results or remote endpoints. It only dispatches explicit local UI events until the host supplies a real router.

The existing repository README already defines Kill Critic as a fail-closed baseline gate and keeps production changes behind controlled GitHub changes.

## Integration map

```
SAMURAI® Launcher
       |
       +--> SAMURAI® /workspace
       |
       +--> NEXUS /nexus
       |
       +--> X10THINC /x10think
                 |
                 +--> Kill Critic
                 +--> CI/CD
                 +--> Recovery
                 +--> Proof / evidence
```

## Responsive behavior

- Desktop: three-module command grid.
- Tablet: single-column module cards with compact telemetry.
- Mobile: touch-sized cards and two-column telemetry.
- Reduced-motion preference is respected.
- Keyboard activation is supported.

## Validation status

Checked against the current GitHub repository structure before implementation. The repository contains the existing Core, Android and GitHub Actions layers, including Core CI, Android build, X10THINK recovery and NEXUS recovery workflows.

External connector checks performed during this implementation:

- Remote Desktop Commander: no connected device is currently exposed, so no remote filesystem/build mutation was claimed.
- GitHub: authenticated account has admin/push access to `smokblack999-a11y/Brand_Samuray-`.
- Notion: an existing X10THINC / Kill Critic architecture page was found.
- HubSpot: connector is onboarded, but several write-capable CRM surfaces require reauthorization.
- Inductive Bio: available property models were verified.
- RxNorm: terminology lookup is available; it is not used by this launcher because medication data is outside its product scope.

## Branch

Implementation is isolated on:

`launcher-x10thinc-command-center`

First implementation commit:

`86b6383fbdf8c4f9da92bfd3ec3e01750f71cb9d`

No merge into `main` is performed automatically.
