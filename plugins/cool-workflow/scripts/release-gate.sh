#!/usr/bin/env bash
# release-gate.sh — deterministic release checks for cool-workflow.
# Pass = writes .cw-release/gate-<HEAD-sha>.ok
# This script encodes everything that does NOT need LLM judgment.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"
SHA="$(git rev-parse HEAD)"
FAIL=0
say() { printf '%s\n' "$*"; }
fail() { say "GATE FAIL: $*"; FAIL=1; }

# Resolve the PREVIOUS release tag by SEMVER ORDER, not ancestry. Since the
# tag-only-push release design, a release tag is a one-hop leaf off an old main
# tip and is NEVER an ancestor of main — so `git describe --tags` (which walks
# ancestry backward) silently SKIPS the true previous release tag and lands one
# or more releases too far back, making the substance/test-evidence/cadence
# checks below compare against the wrong baseline and pass permanently (verified
# live: `git describe --tags v0.2.4^` -> v0.2.2, skipping v0.2.3). release-flow.js
# hit the exact same bug and switched to a semver-ordered lookup
# (listReleaseTagsDesc, ITERATION_LOG cycles 35/36); this is the bash port.
# Pick the highest vX.Y.Z tag that does NOT already point at HEAD (so it works
# whether run before tagging or re-run on a freshly tagged commit). The awk
# zero-pads each component into a lexically-sortable key so plain `sort` yields
# semver order without relying on `sort -V` (absent on some platforms).
HEAD_TAGS="$(git tag --points-at HEAD 2>/dev/null || echo "")"
PREV_TAG=""
while IFS= read -r _tag; do
  [[ -z "$_tag" ]] && continue
  if printf '%s\n' "$HEAD_TAGS" | grep -qxF "$_tag"; then continue; fi
  PREV_TAG="$_tag"
  break
done < <(
  git tag -l 'v*' 2>/dev/null \
    | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' \
    | awk -F'[v.]' '{ printf "%010d.%010d.%010d %s\n", $2, $3, $4, $0 }' \
    | sort -r \
    | awk '{ print $2 }'
)
# An empty PREV_TAG is ambiguous: (a) the genuine first release, so skipping
# substance/evidence/cadence is right, or (b) tags DO exist but this clone can
# not see them — a shallow clone hides them in history, and a `git clone
# --no-tags` / `fetch-tags: false` clone of a long-tagged repo shows 0 local
# tags too. (a) and (b) look IDENTICAL from local state (both give an empty
# describe and 0 tags), so we can NOT auto-tell them apart. Fail CLOSED: skip
# the checks ONLY when the operator positively declares a first release with
# CW_FIRST_RELEASE=1 (explicit + logged, the same shape the cadence HOTFIX
# override uses). Otherwise REJECT — a mis-fetched clone must never look like a
# first release and silently pass. Found by a 2026-07-12 security check; the
# shallow signal alone closed only half the hole (the `--no-tags` full clone
# still slipped through).
if [[ -z "$PREV_TAG" ]]; then
  IS_SHALLOW="$(git rev-parse --is-shallow-repository 2>/dev/null || echo "false")"
  if [[ "$IS_SHALLOW" == "true" ]]; then
    fail "cannot resolve the previous release tag: this is a shallow git clone (git rev-parse --is-shallow-repository = true), so an older tag may be hidden and substance/test-evidence/cadence cannot be trusted. Fetch full history (actions/checkout with fetch-depth: 0) before running this gate."
  elif [[ "${CW_FIRST_RELEASE:-}" == "1" ]]; then
    say "no previous tag; genuine first release declared (CW_FIRST_RELEASE=1) — substance/evidence/cadence will be skipped"
  else
    fail "cannot resolve the previous release tag on a full (non-shallow) clone. Either tags were not fetched (git clone --no-tags, or actions/checkout fetch-tags: false — fetch tags and re-run), or this is the genuine first release (set CW_FIRST_RELEASE=1 to declare that explicitly). Refusing to silently skip substance/test-evidence/cadence."
  fi
fi
MARKER_DIR="$REPO_ROOT/.cw-release"
mkdir -p "$MARKER_DIR"

# --- 1. Build & tests (run, don't trust pasted output) -----------------
say "[1/6] build"
npm run --prefix plugins/cool-workflow build >/dev/null 2>&1 || fail "build failed"

say "[2/6] tests"
CW_TEST_CONCURRENCY=1 npm run test:gate --prefix plugins/cool-workflow >/dev/null 2>&1 || fail "tests failed"

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
# On a normal checkout `git rev-parse --abbrev-ref HEAD` is the branch name. On
# a DETACHED HEAD it prints the literal string "HEAD" — and the tag-push CI
# (release-gate.yml) ALWAYS checks out the tag, so HEAD is detached there. A
# literal "HEAD" can never match the version-branch regex below, so this check
# would silently pass exactly where it is meant to be the backstop. Handle the
# detached case explicitly: gather the real candidate ref name(s) — the
# CI-provided source branch (GITHUB_HEAD_REF for a PR, else GITHUB_REF_NAME),
# plus every local/remote branch whose tip contains this commit — and judge
# each one. A truly detached checkout with no resolvable branch (a bare
# `git checkout <sha>`) has no branch to name, so there is nothing to forbid;
# that is now an explicit, understood pass, not an accidental regex miss.
BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo HEAD)"
CANDIDATE_BRANCHES="$BRANCH"
if [[ "$BRANCH" == "HEAD" ]]; then
  CANDIDATE_BRANCHES=""
  # The CI source branch: a PR run exposes it as GITHUB_HEAD_REF; a plain push
  # exposes the pushed ref as GITHUB_REF_NAME (a tag on a tag push, which simply
  # will not match the feat/ regex — harmless to include).
  for ENVREF in "${GITHUB_HEAD_REF:-}" "${GITHUB_REF_NAME:-}"; do
    [[ -n "$ENVREF" ]] && CANDIDATE_BRANCHES+="${ENVREF}"$'\n'
  done
  # Every local branch whose tip contains this commit, plus every remote-tracking
  # branch (with its "<remote>/" prefix stripped so the regex still anchors on
  # "feat/"). --format avoids the "* " current-branch marker git branch prints.
  LOCAL_C="$(git branch --contains HEAD --format='%(refname:short)' 2>/dev/null || true)"
  REMOTE_C="$(git branch -r --contains HEAD --format='%(refname:short)' 2>/dev/null | sed -E 's#^[^/]+/##' || true)"
  [[ -n "$LOCAL_C" ]] && CANDIDATE_BRANCHES+="$LOCAL_C"$'\n'
  [[ -n "$REMOTE_C" ]] && CANDIDATE_BRANCHES+="$REMOTE_C"$'\n'
fi
while IFS= read -r B; do
  [[ -z "$B" || "$B" == "HEAD" ]] && continue
  if [[ "$B" =~ ^feat/(batch-)?v?[0-9]+ ]]; then
    fail "branch '$B' is version-number-driven; name the capability instead"
  fi
done <<< "$CANDIDATE_BRANCHES"

# --- Verdict ------------------------------------------------------------
if [[ "$FAIL" -ne 0 ]]; then
  rm -f "$MARKER_DIR/gate-$SHA.ok"
  say "RELEASE GATE: REJECTED ($SHA)"
  exit 1
fi

date -u +"%Y-%m-%dT%H:%M:%SZ" > "$MARKER_DIR/gate-$SHA.ok"
say "RELEASE GATE: PASSED ($SHA) — next step: release-reviewer agent must record APPROVED"
