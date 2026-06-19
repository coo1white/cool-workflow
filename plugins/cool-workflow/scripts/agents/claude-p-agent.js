#!/usr/bin/env node
"use strict";

// claude-p-agent.js — EXAMPLE operator agent config for CW Agent Delegation Drive.
//
// This is a CONFIG, NOT a CW dependency: CW spawns it out-of-process (argv-style,
// shell:false, cwd = the target repo) and records its attested output; the model
// runs in claude's process, never in CW.
//
// It fulfills ONE worker: read the worker's input.md ({{input}}), delegate the
// analysis to headless claude READ-ONLY, persist claude's final markdown to the
// worker's result.md ({{result}}), and forward claude's JSON on STDOUT so CW
// records the agent-reported provenance.
//
// LIVE OUTPUT (Unix discipline): default output is the legacy `--output-format
// json` contract, forwarded verbatim on stdout. Set CW_AGENT_STREAM=1 to opt in
// to claude `stream-json`; only then does this wrapper render a human-readable
// trace to stderr, and only when stderr is a TTY. Diagnostics stay off stdout,
// and vendor-specific stream parsing lives HERE in the wrapper (policy), not in
// CW's core (which only forwards, never parses).
//
// READ-ONLY by design: claude gets NO Write tool; the architecture-review app
// declares the `readonly` sandbox profile. This wrapper (the transport) writes
// the single result.md artifact itself, so the worker completes without granting
// the model file-write access.
//
// Point CW at it (from plugins/cool-workflow/), or use the `builtin:claude` alias:
//   CW_AGENT_COMMAND="node $(pwd)/scripts/agents/claude-p-agent.js {{input}} {{result}}"

const fs = require("node:fs");
const { spawn, spawnSync } = require("node:child_process");

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
- If you have no structured findings, use "findings": [] (empty) — never omit a finding's id.`;

const prompt = `${fs.readFileSync(inputPath, "utf8")}\n${CONTRACT}`;
const streamEnabled = process.env.CW_AGENT_STREAM !== "0" && process.env.CW_NO_STREAM !== "1";
const traceEnabled = streamEnabled && Boolean(process.stderr.isTTY);

if (!streamEnabled) {
  // Legacy default: --output-format json and verbatim stdout forwarding. This is
  // the public wrapper contract existing users already scripted against.
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
    process.stderr.write(`claude output was not JSON: ${error.message}\n`);
    process.exit(1);
  }

  fs.writeFileSync(resultPath, String(parsed.result || ""), "utf8");
  process.stdout.write(out);
  process.exit(0);
}

// Live trace → stderr only. Concise; one line per meaningful event.
function trace(line) {
  if (!traceEnabled) return;
  process.stderr.write(`${line}\n`);
}
function shortInput(tool, input) {
  if (!input || typeof input !== "object") return "";
  const v = input.file_path || input.path || input.pattern || input.command || input.query || input.url || "";
  const s = String(v).replace(/\s+/g, " ").trim();
  return s ? ` ${s.length > 80 ? s.slice(0, 77) + "…" : s}` : "";
}

// stream-json so claude emits incremental NDJSON events we can render live, while
// we reconstruct the single {model, usage, result} object CW consumes on stdout.
const child = spawn(
  "claude",
  ["-p", prompt, "--output-format", "stream-json", "--verbose", "--allowedTools", "Read,Grep,Glob,Bash"],
  { stdio: ["ignore", "pipe", "inherit"] } // claude's own stderr → straight through
);

let model;
let usage;
let resultText;
let buf = "";

trace("● claude: reading the repo (read-only)…");

child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      continue; // not a complete JSON line; ignore (defensive)
    }
    renderEvent(ev);
  }
});

function renderEvent(ev) {
  if (ev.type === "assistant" && ev.message) {
    if (!model && typeof ev.message.model === "string") model = ev.message.model;
    for (const part of ev.message.content || []) {
      if (part.type === "text" && part.text && part.text.trim()) {
        trace(`  ${part.text.trim().replace(/\n+/g, "\n  ")}`);
      } else if (part.type === "tool_use") {
        trace(`  → ${part.name}${shortInput(part.name, part.input)}`);
      }
    }
  } else if (ev.type === "system" && ev.subtype === "post_turn_summary" && ev.status_detail) {
    trace(`  · ${ev.status_detail}`);
  } else if (ev.type === "result") {
    if (typeof ev.result === "string") resultText = ev.result;
    if (ev.usage && typeof ev.usage === "object") usage = ev.usage;
    if (ev.is_error) trace("  ✗ claude reported an error result");
  }
}

child.on("error", (err) => {
  process.stderr.write(`claude spawn failed: ${err.message}\n`);
  process.exit(1);
});

child.on("close", (code) => {
  if (code !== 0) {
    process.stderr.write(`claude exited ${code === null ? "(timeout/killed)" : code}\n`);
    process.exit(code === null ? 1 : code);
  }
  if (typeof resultText !== "string") {
    // Fail closed: no result event ⇒ no result.md ⇒ CW records a failed hop.
    process.stderr.write("claude produced no result event — refusing to fabricate a result\n");
    process.exit(1);
  }
  // Persist the AGENT's final markdown to the worker's result.md (CW is transport).
  fs.writeFileSync(resultPath, resultText, "utf8");
  trace("● done — result captured");
  // The single JSON CW consumes on STDOUT (data channel): model + usage + result.
  process.stdout.write(JSON.stringify({ model, usage, result: resultText }));
});
