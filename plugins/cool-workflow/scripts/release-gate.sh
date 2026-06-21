#!/usr/bin/env bash
# release-gate.sh — deterministic release checks for cool-workflow.
# Pass = writes .cw-release/gate-<HEAD-sha>.ok
# This script encodes everything that does NOT need LLM judgment.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"
SHA="$(git rev-parse HEAD)"
# Resolve the PREVIOUS release tag. When this script runs from CI on a tag push
# (.github/workflows/release-gate.yml), HEAD already carries the tag being
# released, so a plain `git describe` returns *that* tag and the diff range
# collapses to empty — making substance/evidence/cadence false-fail every real
# release. Exclude any tag that points at HEAD so we always compare against the
# prior release (the parent commit's nearest tag).
HEAD_TAGS="$(git tag --points-at HEAD 2>/dev/null || echo "")"
PREV_TAG="$(git describe --tags --abbrev=0 2>/dev/null || echo "")"
if [[ -n "$HEAD_TAGS" ]] && printf '%s\n' "$HEAD_TAGS" | grep -qxF "$PREV_TAG"; then
  PREV_TAG="$(git describe --tags --abbrev=0 HEAD^ 2>/dev/null || echo "")"
fi
MARKER_DIR="$REPO_ROOT/.cw-release"
mkdir -p "$MARKER_DIR"
FAIL=0

say() { printf '%s\n' "$*"; }
fail() { say "GATE FAIL: $*"; FAIL=1; }

# --- 1. Build & tests (run, don't trust pasted output) -----------------
say "[1/6] build"
npm run --prefix plugins/cool-workflow build >/dev/null 2>&1 || fail "build failed"

say "[2/6] tests"
CW_TEST_CONCURRENCY=1 npm test --prefix plugins/cool-workflow >/dev/null 2>&1 || fail "tests failed"

if [[ -n "$PREV_TAG" ]]; then
  RANGE="$PREV_TAG..HEAD"

  # --- 2. Substance: changes must exist outside src/types/ and dist/ ---
  # The spec (AGENTS.md / reviewer-agent.md Gate 1) is "at least one changed
  # file outside src/types/ and dist/" — ANY such file (src, scripts, docs,
  # workflows, tests). Count every changed path that is not under those two
  # generated/declaration-only trees; declared-but-unread spec accretion is the
  # reviewer agent's deeper judgment call, not this deterministic floor.
  say "[3/6] substance (diff outside src/types/ and dist/)"
  SUBSTANCE=$(git diff --name-only "$RANGE" \
    | grep -cvE '^plugins/cool-workflow/(src/types/|dist/)' || true)
  [[ "$SUBSTANCE" -gt 0 ]] || fail "only types/dist changed since $PREV_TAG (spec accretion)"

  # --- 3. Test evidence: test files must have changed ------------------
  say "[4/6] test evidence"
  TESTS_CHANGED=$(git diff --name-only "$RANGE" | grep -cE '\.(test|spec)\.|/tests?/' || true)
  [[ "$TESTS_CHANGED" -gt 0 ]] || fail "zero test changes since $PREV_TAG"

  # --- 4. Cadence: >=4 cycles logged OR >=24h since previous tag, or a recorded HOTFIX ---
  say "[5/6] cadence"
  CYCLES=0
  if [[ -f ITERATION_LOG.md && -n "$PREV_TAG" ]]; then
    CYCLES=$(git diff "$RANGE" -- ITERATION_LOG.md | grep -c '^+.*|' || true)
  fi
  PREV_TS=$(git log -1 --format=%ct "$PREV_TAG")
  NOW_TS=$(date +%s)
  HOURS=$(( (NOW_TS - PREV_TS) / 3600 ))
  # Hotfix path: an urgent fix may ship inside the cadence window, but ONLY via an
  # EXPLICIT, RECORDED declaration — a "HOTFIX:" line added to ITERATION_LOG.md in this
  # release range, carrying a reason. It is committed (auditable in the tag's history)
  # and echoed here, so the bypass is never silent and a reviewer sees the reason.
  HOTFIX="$(git diff "$RANGE" -- ITERATION_LOG.md | grep -E '^\+.*HOTFIX:' | head -1 | sed -E 's/^\+[[:space:]]*//' || true)"
  if [[ "$CYCLES" -lt 4 && "$HOURS" -lt 24 ]]; then
    if [[ -n "$HOTFIX" ]]; then
      say "  cadence bypassed by recorded HOTFIX (${HOURS}h, ${CYCLES} cycle-lines): ${HOTFIX}"
    else
      fail "cadence: only $CYCLES cycles logged and ${HOURS}h since $PREV_TAG (need >=4 cycles, >=24h, or a recorded 'HOTFIX:' line in ITERATION_LOG.md)"
    fi
  fi
else
  say "[3-5/6] no previous tag; substance/evidence/cadence checks skipped"
fi

# --- 5. Branch naming: forbid version-number branches -------------------
say "[6/6] branch naming"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$BRANCH" =~ ^feat/(batch-)?v?[0-9]+ ]]; then
  fail "branch '$BRANCH' is version-number-driven; name the capability instead"
fi

# --- Verdict ------------------------------------------------------------
if [[ "$FAIL" -ne 0 ]]; then
  rm -f "$MARKER_DIR/gate-$SHA.ok"
  say "RELEASE GATE: REJECTED ($SHA)"
  exit 1
fi

date -u +"%Y-%m-%dT%H:%M:%SZ" > "$MARKER_DIR/gate-$SHA.ok"
say "RELEASE GATE: PASSED ($SHA) — next step: release-reviewer agent must record APPROVED"
