#!/usr/bin/env bash
# block-unapproved-tag.sh — PreToolUse hook for the Bash tool.
# Reads hook input JSON on stdin. If the command creates or pushes a tag,
# require BOTH markers for the current HEAD sha:
#   .cw-release/gate-<sha>.ok        (written by release-gate.sh)
#   .cw-release/review-<sha>.verdict (written by the release-reviewer agent, must contain APPROVED)
# If .cw-release/verdict-signing.pub is committed (scripts/verdict-keygen.js),
# also requires a valid ed25519 signature on the verdict (its .sig sidecar) —
# opt-in, backward compatible with repos that haven't set up signing yet.
# Exit 2 blocks the tool call; stderr is fed back to the agent.
set -uo pipefail

INPUT="$(cat)"
# Parse the tool command with node, not jq: node is guaranteed present in this
# Node project (and matches the repo's node/npm/git-only portability rule),
# whereas jq is not installed in every Claude Code environment. A missing jq
# would make this security hook silently fail OPEN (empty command → exit 0),
# letting an unreviewed tag through. node keeps it portable and fail-closed.
CMD="$(printf '%s' "$INPUT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s)?.tool_input?.command||""))}catch{process.stdout.write("")}})' 2>/dev/null)"
[[ -z "$CMD" ]] && exit 0

# Only care about tag creation / tag push. Widened from the original pattern,
# which missed the single most natural bypass form: `git push origin v0.2.3`
# (a bare tag-shaped ref, no --tags flag and no refs/tags/ prefix) matched
# neither side of the old alternation. Also now tolerates a global flag before
# the tag subcommand (`git -C dir tag ...`) and the `--annotate` long form.
if ! printf '%s' "$CMD" | grep -qE 'git(\s+-[A-Za-z]+\s+\S+)*\s+tag\s+(-a\s+|--annotate\s+)?v[0-9]|git\s+push\b.*(--tags|refs/tags|[[:space:]]v[0-9])'; then
  exit 0
fi

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
SHA="$(git -C "$REPO_ROOT" rev-parse HEAD)"
# cut() commits the verdict ON TOP of the reviewed commit, so at tag time the
# verdict filename is keyed on HEAD~1's sha, not HEAD's — the same
# HEAD-or-HEAD~1 tolerance release-gate.yml uses. Without this, a manual
# retag of a cut-produced commit was always blocked (v0.2.3 recovery).
PARENT="$(git -C "$REPO_ROOT" rev-parse HEAD~1 2>/dev/null || echo none)"
GATE=""
VERDICT=""
for C in "$SHA" "$PARENT"; do
  [[ "$C" == "none" ]] && continue
  if [[ -f "$REPO_ROOT/.cw-release/review-$C.verdict" ]]; then
    GATE="$REPO_ROOT/.cw-release/gate-$C.ok"
    VERDICT="$REPO_ROOT/.cw-release/review-$C.verdict"
    break
  fi
done
[[ -z "$VERDICT" ]] && VERDICT="$REPO_ROOT/.cw-release/review-$SHA.verdict"
[[ -z "$GATE" ]] && GATE="$REPO_ROOT/.cw-release/gate-$SHA.ok"

if [[ ! -f "$GATE" ]]; then
  echo "BLOCKED: no release-gate pass for HEAD $SHA (or its parent). Run plugins/cool-workflow/scripts/release-gate.sh first. Tagging without a green gate is forbidden." >&2
  exit 2
fi

if [[ ! -f "$VERDICT" ]] || ! grep -q '^APPROVED' "$VERDICT"; then
  echo "BLOCKED: no APPROVED verdict from the release-reviewer agent for HEAD $SHA (or its parent). Invoke the 'release-reviewer' subagent and obtain approval. Do not write the verdict file yourself — that is a gaming attempt and will be flagged in CI." >&2
  exit 2
fi

# Once .cw-release/verdict-signing.pub is committed (see scripts/verdict-keygen.js),
# also require a valid ed25519 signature on the verdict — closing the gap this grep
# alone can't: a plain APPROVED text match can't tell a real reviewer verdict from
# one typed by hand. Absent that public key, this block is a no-op (unchanged,
# grep-only behavior).
PUBKEY="$REPO_ROOT/.cw-release/verdict-signing.pub"
if [[ -f "$PUBKEY" ]]; then
  SIG="$VERDICT.sig"
  if [[ ! -f "$SIG" ]] || ! node "$REPO_ROOT/plugins/cool-workflow/scripts/verify-verdict-signature.js" "$VERDICT" "$SIG" "$PUBKEY" >/dev/null 2>&1; then
    echo "BLOCKED: verdict for HEAD $SHA has no valid signature, but verdict-signing.pub is committed so one is required. Do not hand-write or hand-sign a verdict — obtain a real reviewer approval via release-flow.js with CW_RELEASE_VERDICT_PRIVKEY set." >&2
    exit 2
  fi
fi

exit 0
