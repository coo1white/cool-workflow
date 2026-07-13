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
# With `set -o pipefail` above, $? here is the pipeline's own exit code, so a
# node crash/missing-node is told apart from "this just wasn't a tag command".
# Still fail OPEN either way (exit 0) -- a node hiccup must not block every
# Bash call, that would be a much bigger regression than the narrow gap this
# closes. But say so on stderr, so it is not a SILENT open: the agent (and
# anyone reading the transcript) can see this hook did not really check
# anything that run. The real backstop is CI (release-gate.yml /
# npm-publish.yml), which cannot be skipped this way.
NODE_STATUS=$?
if [[ -z "$CMD" ]]; then
  if [[ "$NODE_STATUS" -ne 0 ]]; then
    echo "WARN: block-unapproved-tag.sh could not parse the tool command (node exited $NODE_STATUS). Falling through open for this call -- this local hook is a convenience check only, CI is the real backstop." >&2
  fi
  exit 0
fi

# Only care about tag creation / tag push. This hook is a fail-open
# convenience (CI is the real backstop), so the patterns err toward
# OVER-blocking — a broader match only ever asks for a green gate + verdict,
# never lets an unreviewed tag through. Two patterns:
#   TAG_RE:  `git [global -flags] tag [any flags incl. -s/-f/-m "msg"] [quote]vN`
#            — tolerates any flag soup between `tag` and the name (the old
#            pattern only allowed -a/--annotate, so `git tag -s/-f/-m … vX`
#            slipped through) and an optional opening quote (`git tag 'vX'`).
#            `git tag -l` / `--list` are NOT matched (no vN name follows).
#   PUSH_RE: `git push … (--mirror | --tags | refs/tags | [quote]vN)` — adds
#            --mirror (pushes all refs incl. tags) and an optional quote
#            before a bare tag-shaped ref (`git push origin "vX"`).
# The `'"'"'` sequences embed a literal single quote inside the single-quoted
# pattern so both `'vX'` and `"vX"` are recognized.
TAG_RE='git(\s+-\S+(\s+\S+)?)*\s+tag\s+(\S+\s+)*["'"'"']?v[0-9]'
PUSH_RE='git\s+push\b.*(--mirror|--tags|refs/tags|[[:space:]]["'"'"']?v[0-9])'
if ! printf '%s' "$CMD" | grep -qE "$TAG_RE|$PUSH_RE"; then
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
MATCHED_C=""
for C in "$SHA" "$PARENT"; do
  [[ "$C" == "none" ]] && continue
  if [[ -f "$REPO_ROOT/.cw-release/review-$C.verdict" ]]; then
    GATE="$REPO_ROOT/.cw-release/gate-$C.ok"
    VERDICT="$REPO_ROOT/.cw-release/review-$C.verdict"
    MATCHED_C="$C"
    break
  fi
done
if [[ -z "$VERDICT" ]]; then
  VERDICT="$REPO_ROOT/.cw-release/review-$SHA.verdict"
  MATCHED_C="$SHA"
fi
[[ -z "$GATE" ]] && GATE="$REPO_ROOT/.cw-release/gate-$SHA.ok"

if [[ ! -f "$GATE" ]]; then
  echo "BLOCKED: no release-gate pass for HEAD $SHA (or its parent). Run plugins/cool-workflow/scripts/release-gate.sh first. Tagging without a green gate is forbidden." >&2
  exit 2
fi

# Exact first-line match against the sha the verdict FILE NAME claims to be
# for ($MATCHED_C), not just "starts with APPROVED somewhere". The ed25519
# signature (checked below) only binds the file's BYTES, never its filename —
# so a plain `grep -q '^APPROVED'` would accept a real, validly-signed verdict
# for one sha byte-copied onto a filename naming a DIFFERENT sha. Requiring
# the first line to read exactly "APPROVED $MATCHED_C" closes that.
if [[ ! -f "$VERDICT" ]]; then
  echo "BLOCKED: no APPROVED verdict from the release-reviewer agent for HEAD $SHA (or its parent). Invoke the 'release-reviewer' subagent and obtain approval. Do not write the verdict file yourself — that is a gaming attempt and will be flagged in CI." >&2
  exit 2
fi
FIRST_LINE="$(head -n1 "$VERDICT")"
if [[ "$FIRST_LINE" != "APPROVED $MATCHED_C" ]]; then
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
