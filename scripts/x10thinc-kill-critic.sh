#!/usr/bin/env bash
set -euo pipefail

SOURCE_ROOT="\${1:-source}"
BUILD_CONTEXT="\${2:-core}"
DOCKERFILE="\${3:-core/Dockerfile}"

fail() {
  echo "::error::$1"
  exit 1
}

test -d "$SOURCE_ROOT" || fail "Source checkout not found: $SOURCE_ROOT"
test -d "$SOURCE_ROOT/$BUILD_CONTEXT" || fail "Build context not found: $SOURCE_ROOT/$BUILD_CONTEXT"
test -f "$SOURCE_ROOT/$DOCKERFILE" || fail "Dockerfile not found: $SOURCE_ROOT/$DOCKERFILE"

if [[ -f "$SOURCE_ROOT/$BUILD_CONTEXT/package.json" ]]; then
  test -f "$SOURCE_ROOT/$BUILD_CONTEXT/package-lock.json" || fail "package-lock.json required for deterministic npm install"
fi

# Kill-Critic: fail closed on common credential formats.
if git -C "$SOURCE_ROOT" grep -nE -- \
  ':!*.md' \
  -e 'sk-(proj|svcacct)-[A-Za-z0-9_-]{20,}' \
  -e 'ghp_[A-Za-z0-9]{30,}' \
  -e 'github_pat_[A-Za-z0-9_]{20,}' \
  -e 'AIza[0-9A-Za-z_-]{30,}' \
  -e 'AKIA[0-9A-Z]{16}' \
  -e 'BEGIN (RSA|EC|OPENSSH|DSA|PRIVATE) KEY'; then
  fail "Potential credential material detected in source tree"
fi

# Dockerfile guardrails.
if grep -nE '^[[:space:]]*(ADD|COPY)[[:space:]]+https?://' "$SOURCE_ROOT/$DOCKERFILE"; then
  fail "Remote Docker ADD/COPY is forbidden"
fi

if grep -nE '(curl|wget)[^\n|;]*\|[[:space:]]*(sh|bash|zsh)' "$SOURCE_ROOT/$DOCKERFILE"; then
  fail "Pipe-to-shell install pattern is forbidden"
fi

# SamuraiOS-specific hardening.
if [[ "$BUILD_CONTEXT" == "core" ]]; then
  grep -qE '^USER[[:space:]]+node[[:space:]]*$' "$SOURCE_ROOT/$DOCKERFILE" || fail "core/Dockerfile must run as non-root user 'node'"
  grep -qE 'npm ci --omit=dev' "$SOURCE_ROOT/$DOCKERFILE" || fail "core/Dockerfile must use npm ci --omit=dev"
fi

echo "X10THINC KILL CRITIC: PASS"
