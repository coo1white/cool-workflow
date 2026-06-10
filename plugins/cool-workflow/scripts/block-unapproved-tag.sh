#!/usr/bin/env bash
# block-unapproved-tag.sh — PreToolUse hook for the Bash tool.
# Reads hook input JSON on stdin. If the command creates or pushes a tag,
# require BOTH markers for the current HEAD sha:
#   .cw-release/gate-<sha>.ok        (written by release-gate.sh)
#   .cw-release/review-<sha>.verdict (written by the release-reviewer agent, must contain APPROVED)
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

# Only care about tag creation / tag push
if ! printf '%s' "$CMD" | grep -qE 'git\s+tag\s+(-a\s+)?v|git\s+push\b.*(--tags|refs/tags)'; then
  exit 0
fi

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
SHA="$(git -C "$REPO_ROOT" rev-parse HEAD)"
GATE="$REPO_ROOT/.cw-release/gate-$SHA.ok"
VERDICT="$REPO_ROOT/.cw-release/review-$SHA.verdict"

if [[ ! -f "$GATE" ]]; then
  echo "BLOCKED: no release-gate pass for HEAD $SHA. Run plugins/cool-workflow/scripts/release-gate.sh first. Tagging without a green gate is forbidden." >&2
  exit 2
fi

if [[ ! -f "$VERDICT" ]] || ! grep -q '^APPROVED' "$VERDICT"; then
  echo "BLOCKED: no APPROVED verdict from the release-reviewer agent for HEAD $SHA. Invoke the 'release-reviewer' subagent and obtain approval. Do not write the verdict file yourself — that is a gaming attempt and will be flagged in CI." >&2
  exit 2
fi

exit 0
