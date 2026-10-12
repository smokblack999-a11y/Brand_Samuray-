# X10THINC Artifact Relay

This branch adds the X10THINC interpretation of the strongest design pattern found in squidfunk/mkdocs-material issue 2442.

## Core idea extracted from issue 2442

The valuable pattern was not the deprecated Docker image itself. It was the architecture:

upstream source → user-controlled build → user-controlled private registry → automated synchronization

The discussion proposed a forked/private copy, GitHub Actions for rebuilding, and optional automation to stay synchronized with upstream.

X10THINC turns that into a stronger release-control plane:

source ref → immutable source SHA → Kill Critic → deterministic tests → OCI build → content-addressed image tag → provenance/SBOM → release manifest

## What is stronger

### 1. Content-addressed deduplication

Every source commit gets an immutable sha-<commit> image tag. A scheduled run checks whether that tag already exists before rebuilding. Repeated polls therefore avoid unnecessary builds.

### 2. Fail-closed Kill Critic

The relay stops before publishing when it finds common credential formats, remote Docker ADD/COPY, pipe-to-shell installers, missing npm lockfiles, or a root-running SamuraiOS core image.

### 3. Deterministic application verification

For SamuraiOS Core, the relay requires package-lock.json, runs npm ci, and runs the existing test suite before publication.

### 4. Supply-chain evidence

Docker BuildKit is configured for maximum provenance and SBOM generation. GitHub artifact attestation is then added for the published OCI subject.

### 5. Registry ownership stays with the consumer

The target registry is configurable. GHCR can use the workflow's GITHUB_TOKEN; external registries use dedicated repository secrets. This retains the economic/control principle behind issue 2442 while using the current GitHub Packages model.

## Configuration

Optional repository variables:

- X10THINC_SOURCE_REPO — source repository; defaults to the current repository.
- X10THINC_REGISTRY — defaults to ghcr.io.
- X10THINC_IMAGE — defaults to <owner>/samurayos-core.
- X10THINC_BUILD_CONTEXT — defaults to core.
- X10THINC_DOCKERFILE — defaults to core/Dockerfile.
- X10THINC_ATTEST — defaults to true.

For a private upstream repository, add X10THINC_UPSTREAM_TOKEN.

For a non-GHCR registry, add:

- X10THINC_REGISTRY_USERNAME
- X10THINC_REGISTRY_PASSWORD

## Operational model

A scheduled run checks for the latest upstream release and falls back to the default branch. A manual run can pin an exact ref and can force a rebuild.

The result is always represented by an immutable source SHA and OCI digest. The generated release-manifest.json is uploaded as a workflow artifact so the build can be audited without relying on mutable tags.

## Important boundary

The original issue discussed a GitHub App for keeping a fork synchronized. X10THINC deliberately does not require a third-party synchronization App: the relay resolves the source ref directly and builds from the exact source SHA. A future GitHub App can be added as an event-driven front end without changing the artifact contract.

## Current GitHub note

The 2021 cost discussion in issue 2442 is historical context. Current GitHub documentation describes granular Container Registry permissions and GITHUB_TOKEN-based package publishing for packages associated with a workflow repository.
