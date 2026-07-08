#!/usr/bin/env bash
# verify-bump-reproduction.sh — closes the HEAD~1 verdict-replay bypass.
#
# release-gate.yml / npm-publish.yml tolerate a verdict written for the tag
# commit's PARENT (release-flow.js's cut() reviews content, then adds a
# mechanical version-bump + the verdict as a NEW child commit that actually
# gets tagged). A validly-signed verdict at the parent proves someone once
# approved THAT commit — it does NOT prove the child (the thing actually being
# tagged) is the deterministic bump cut() would have produced, rather than an
# attacker's own commit smuggling in arbitrary changes on top of an old,
# genuinely-approved parent (a real signature on a REPLAYED verdict).
#
# This script independently reproduces the bump: checks out the approved
# parent into a scratch worktree, runs the SAME bump:version/sync:project-index
# steps cut() runs, stages the SAME way cut() stages (git add -u + the
# explicit verdict/.sig paths, never -A), and requires the resulting tree to
# match the ACTUAL tagged commit's tree byte-for-byte. Any difference —
# anywhere, including a single added file — fails closed.
#
# Usage: verify-bump-reproduction.sh <approved-parent-sha> <tagged-sha> <verdict-repo-relative-path> [sig-repo-relative-path]
#
# Exit 0: the tagged commit's tree matches the reproduced bump exactly.
# Exit 1: mismatch, or any step failed (install, bump, sync, worktree, etc).
set -uo pipefail

# Where THIS SCRIPT ITSELF lives — distinct from REPO_ROOT (the git repo being
# operated ON, resolved below from the invocation cwd). These coincide in
# ordinary production use (the script runs from within the same checkout it
# verifies), but conflating them is wrong: REPO_ROOT could be an ARBITRARY git
# context (e.g. a test harness's throwaway clone of old history, which never
# has this script's own sibling files, since they postdate whatever was
# cloned). Sibling files this script depends on must be found relative to
# where it is installed, never relative to the repo it happens to be pointed at.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

PARENT="${1:-}"
TAGGED="${2:-}"
VERDICT_REL="${3:-}"
SIG_REL="${4:-}"
if [[ -z "$PARENT" || -z "$TAGGED" || -z "$VERDICT_REL" ]]; then
  echo "usage: verify-bump-reproduction.sh <parent-sha> <tagged-sha> <verdict-rel-path> [sig-rel-path]" >&2
  exit 1
fi

REPO_ROOT="$(git rev-parse --show-toplevel)" || exit 1
SCRATCH_PARENT="$(mktemp -d)"
SCRATCH="$SCRATCH_PARENT/wt"
cleanup() {
  git -C "$REPO_ROOT" worktree remove --force "$SCRATCH" >/dev/null 2>&1
  rm -rf "$SCRATCH_PARENT"
}
trap cleanup EXIT

if ! git -C "$REPO_ROOT" worktree add --quiet --detach "$SCRATCH" "$PARENT" 2>/dev/null; then
  echo "verify-bump-reproduction: could not create a scratch worktree at $PARENT" >&2
  exit 1
fi

# The target version comes from the TAGGED commit (not the parent, which may
# still be pre-bump) — read via git plumbing, no separate checkout needed.
VERSION="$(git -C "$REPO_ROOT" show "$TAGGED:plugins/cool-workflow/package.json" 2>/dev/null | node -e '
  let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{ try { process.stdout.write(JSON.parse(s).version||""); } catch { process.stdout.write(""); } });
')"
if [[ -z "$VERSION" ]]; then
  echo "verify-bump-reproduction: could not read package.json version from tagged commit $TAGGED" >&2
  exit 1
fi

# sync-project-index.js embeds a wall-clock "Generated on <date>" line. Pin it
# to the TAGGED commit's own committer date (UTC) via a Node --require preload
# that overrides the global Date constructor (fake-date-for-reproduction.js),
# NOT an application-level env var: the scratch worktree runs the APPROVED
# PARENT's OWN checked-out copy of sync-project-index.js, which for every
# release cut before this mechanism existed has no idea any such env var is
# meant to be read — an app-level opt-in is a no-op against code that doesn't
# know to opt in, so it can only ever "work" for releases cut after the
# mechanism landed (confirmed empirically: re-running an already-shipped
# release's real approved-parent/tagged pair on a later calendar day produced
# a tree mismatch whose ONLY diff was that one date line). A global override
# of the Date constructor, injected before any application code runs, is
# transparent to the code being executed regardless of which version it is.
CUT_DATE="$(TZ=UTC git -C "$REPO_ROOT" show -s --format=%cd --date=format-local:%Y-%m-%d "$TAGGED" 2>/dev/null)"
if [[ -z "$CUT_DATE" ]]; then
  echo "verify-bump-reproduction: could not read the tagged commit's committer date" >&2
  exit 1
fi
FAKE_DATE_PRELOAD="$SCRIPT_DIR/fake-date-for-reproduction.js"

# Each step's exit code is checked EXPLICITLY and immediately (not via a
# `cmd1 && cmd2 && cmd3` chain) — a chain's overall success can silently
# survive an earlier step's failure if a future edit ever loosens it (e.g.
# `&&` accidentally becoming `;`), which would flip this fail-closed gate to
# fail-open without changing its outward shape. stdout/stderr from each step
# are captured (not discarded to /dev/null) so a real failure — a transient
# npm registry hiccup vs. an actual reproduction mismatch — is distinguishable
# in the workflow log instead of both collapsing into the same generic message.
run_step() {
  local label="$1"
  shift
  local out
  out="$("$@" 2>&1)"
  local code=$?
  if [[ $code -ne 0 ]]; then
    echo "verify-bump-reproduction: $label failed (exit $code):" >&2
    echo "$out" >&2
    return 1
  fi
  return 0
}

(
  cd "$SCRATCH/plugins/cool-workflow" || exit 1
  export NODE_OPTIONS="--require $FAKE_DATE_PRELOAD"
  export CW_FAKE_DATE="$CUT_DATE"
  run_step "npm install" npm install --no-package-lock --ignore-scripts || exit 1
  run_step "bump:version" npm run bump:version -- "$VERSION" || exit 1
  run_step "sync:project-index" npm run sync:project-index -- --repo-only || exit 1
)
BUMP_STATUS=$?
if [[ $BUMP_STATUS -ne 0 ]]; then
  echo "verify-bump-reproduction: reproducing the bump for $PARENT -> v$VERSION failed" >&2
  exit 1
fi

mkdir -p "$SCRATCH/.cw-release"
cp "$REPO_ROOT/$VERDICT_REL" "$SCRATCH/$VERDICT_REL" || exit 1
if [[ -n "$SIG_REL" && -f "$REPO_ROOT/$SIG_REL" ]]; then
  cp "$REPO_ROOT/$SIG_REL" "$SCRATCH/$SIG_REL" || exit 1
fi

# Mirror cut()'s OWN staging exactly (git-add -u + the explicit verdict/.sig
# paths) — never -A, so an untracked stray left by npm/tooling in the scratch
# worktree can never silently ride into what we compare.
git -C "$SCRATCH" add -u
git -C "$SCRATCH" add -- "$VERDICT_REL"
if [[ -n "$SIG_REL" && -f "$SCRATCH/$SIG_REL" ]]; then
  git -C "$SCRATCH" add -- "$SIG_REL"
fi

EXPECTED_TREE="$(git -C "$SCRATCH" write-tree)"
ACTUAL_TREE="$(git -C "$REPO_ROOT" rev-parse "$TAGGED^{tree}")"

if [[ "$EXPECTED_TREE" != "$ACTUAL_TREE" ]]; then
  echo "verify-bump-reproduction: $TAGGED's tree ($ACTUAL_TREE) does not match the deterministic bump reproduced from approved parent $PARENT ($EXPECTED_TREE) — refusing" >&2
  exit 1
fi

exit 0
