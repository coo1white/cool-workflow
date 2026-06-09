#!/usr/bin/env bash
# EXAMPLE operator agent config for CW v0.1.38 Agent Delegation Drive.
#
# This is a CONFIG, NOT a CW dependency — CW spawns it out-of-process and records
# its attested output; the model runs in claude's process, never in CW. Adapt the
# claude flags to your installed `claude` CLI version.
#
# It fulfills ONE worker: read the worker's input.md ({{input}}) and write the
# worker's result.md ({{result}}). CW substitutes {{input}}/{{result}} into these
# discrete argv elements (shell:false) and runs this with cwd = the target repo.
#
# Point CW at it (from plugins/cool-workflow/):
#   CW_AGENT_COMMAND="bash $(pwd)/scripts/agents/claude-p-agent.sh {{input}} {{result}}"
#
set -euo pipefail

input="$1"
result="$2"

prompt="$(cat "$input")

=== HOW TO RETURN YOUR ANSWER (overrides any 'write to result.md' instruction above) ===
You have NO file-write access. Do NOT attempt to write, create, or edit any file —
result.md is persisted FOR YOU from your final message, so writing it yourself is
neither needed nor possible. Use ONLY read-only tools (read files, grep, list).
Respond with ONLY your FINAL answer as Markdown, and it MUST END WITH a fenced
cw:result block that EXACTLY follows this schema:

\`\`\`cw:result
{
  \"summary\": \"one-paragraph direct answer\",
  \"findings\": [
    {
      \"id\": \"unique-kebab-id\",
      \"title\": \"short risk title\",
      \"severity\": \"P0\",
      \"classification\": \"real\",
      \"evidence\": [\"path/to/file.ts:42\"]
    }
  ],
  \"evidence\": [\"path/to/file.ts:42\", \"path/to/other.ts:10\"]
}
\`\`\`

HARD RULES (the result is REJECTED otherwise):
- Every object in \"findings\" MUST have a unique \"id\" (non-empty string).
- \"classification\", if present, MUST be one of: real, conditional, non-issue, unknown.
- Any finding with \"severity\" P0, P1, or P2 MUST include a NON-EMPTY \"evidence\" array.
- The top-level \"evidence\" array MUST be NON-EMPTY with REAL file:line locators from this repo.
- If you have no structured findings, use \"findings\": [] (empty) — never omit a finding's id."

# Read-only analysis: NO Write tool, so claude cannot touch the repo. CW (the
# transport) persists claude's final markdown to the worker's result.md.
# --output-format json so CW can read the agent-REPORTED model id from stdout
# (the attested model; CW never uses CW_AGENT_MODEL as the attested model).
out="$(claude -p "$prompt" \
  --output-format json \
  --allowedTools "Read,Grep,Glob,Bash")"

# Hand the agent's JSON (model + usage + result) back to CW on stdout.
printf '%s' "$out"

# Persist the AGENT's final markdown to the worker's result.md for CW's separate
# acceptance layer. CW is only the transport; the content is the agent's.
node -e 'const fs=require("fs");const o=JSON.parse(fs.readFileSync(0,"utf8"));fs.writeFileSync(process.argv[1],String(o.result||""));' "$result" <<<"$out"
