#!/usr/bin/env node
"use strict";

// claude-p-agent.js — EXAMPLE operator agent config for CW Agent Delegation Drive.
//
// This is a CONFIG, NOT a CW dependency: CW spawns it out-of-process (argv-style,
// shell:false, cwd = the target repo) and records its attested output; the model
// runs in claude's process, never in CW. Node port of claude-p-agent.sh (which now
// delegates here) so the documented onboarding path is portable (node-only repo
// convention, Windows included).
//
// It fulfills ONE worker: read the worker's input.md ({{input}}), delegate the
// analysis to headless claude READ-ONLY, persist claude's final markdown to the
// worker's result.md ({{result}}), and forward claude's JSON (model + usage) on
// stdout so CW records the agent-REPORTED model and token usage as provenance.
//
// READ-ONLY by design: claude gets NO Write tool. The architecture-review app
// declares the `readonly` sandbox profile — the agent must not touch the repo.
// This wrapper (the transport) writes the single result.md artifact itself, so
// the worker completes WITHOUT granting the model file-write access.
//
// Point CW at it (from plugins/cool-workflow/):
//   CW_AGENT_COMMAND="node $(pwd)/scripts/agents/claude-p-agent.js {{input}} {{result}}"
// or per-invocation:
//   --agent-command "node $(pwd)/scripts/agents/claude-p-agent.js {{input}} {{result}}"

const fs = require("node:fs");
const { spawnSync } = require("node:child_process");

const inputPath = process.argv[2];
const resultPath = process.argv[3];
if (!inputPath || !resultPath) {
  process.stderr.write("usage: claude-p-agent.js <inputPath> <resultPath>  (CW substitutes {{input}} {{result}})\n");
  process.exit(2);
}

const CONTRACT = `
=== HOW TO RETURN YOUR ANSWER (overrides any 'write to result.md' instruction above) ===
You have NO file-write access. Do NOT attempt to write, create, or edit any file —
result.md is persisted FOR YOU from your final message, so writing it yourself is
neither needed nor possible. Use ONLY read-only tools (read files, grep, list).
Respond with ONLY your FINAL answer as Markdown, and it MUST END WITH a fenced
cw:result block that EXACTLY follows this schema:

\`\`\`cw:result
{
  "summary": "one-paragraph direct answer",
  "findings": [
    {
      "id": "unique-kebab-id",
      "title": "short risk title",
      "severity": "P0",
      "classification": "real",
      "evidence": ["path/to/file.ts:42"]
    }
  ],
  "evidence": ["path/to/file.ts:42", "path/to/other.ts:10"]
}
\`\`\`

HARD RULES (the result is REJECTED otherwise):
- Every object in "findings" MUST have a unique "id" (non-empty string).
- "classification", if present, MUST be one of: real, conditional, non-issue, unknown.
- Any finding with "severity" P0, P1, or P2 MUST include a NON-EMPTY "evidence" array.
- The top-level "evidence" array MUST be NON-EMPTY with REAL file:line locators from this repo.
- If you have no structured findings, use "findings": [] (empty) — never omit a finding's id.
`;

const prompt = `${fs.readFileSync(inputPath, "utf8")}\n${CONTRACT}`;

// Read-only analysis: NO Write tool, so claude cannot touch the repo. This wrapper
// (the transport) persists claude's final markdown to the worker's result.md.
// --output-format json so CW can read the agent-REPORTED model + usage from stdout
// (the attested model; CW never uses CW_AGENT_MODEL as the attested model).
const child = spawnSync("claude", ["-p", prompt, "--output-format", "json", "--allowedTools", "Read,Grep,Glob,Bash"], {
  encoding: "utf8",
  maxBuffer: 32 * 1024 * 1024,
  shell: false
});
if (child.error) {
  process.stderr.write(`claude spawn failed: ${child.error.message}\n`);
  process.exit(1);
}
if (child.status !== 0) {
  process.stderr.write(String(child.stderr || `claude exited ${child.status}`));
  process.exit(child.status === null ? 1 : child.status);
}

const out = String(child.stdout || "");
let parsed;
try {
  parsed = JSON.parse(out);
} catch (error) {
  // Fail closed: no parsable agent JSON ⇒ no result.md ⇒ CW records a failed hop.
  process.stderr.write(`claude output was not JSON: ${error.message}\n`);
  process.exit(1);
}

// Persist the AGENT's final markdown to the worker's result.md for CW's separate
// acceptance layer. CW is only the transport; the content is the agent's.
fs.writeFileSync(resultPath, String(parsed.result || ""), "utf8");

// Hand the agent's JSON (model + usage + result) back to CW on stdout.
process.stdout.write(out);
