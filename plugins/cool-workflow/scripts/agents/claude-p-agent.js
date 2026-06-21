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
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
// Share the ONE canonical result contract with the codex/gemini/opencode
// wrappers instead of carrying a private copy. A drifted inline copy (ASCII
// hyphens silently became em-dashes here) meant claude was sent a different
// instruction text than the other providers for the same contract.
const { buildPrompt, createRenderer } = require("./agent-adapter-core");

const inputPath = process.argv[2];
const resultPath = process.argv[3];
if (!inputPath || !resultPath) {
  process.stderr.write("usage: claude-p-agent.js <inputPath> <resultPath>  (CW substitutes {{input}} {{result}})\n");
  process.exit(2);
}

const prompt = buildPrompt(inputPath);
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

function shortInput(tool, input) {
  if (!input || typeof input !== "object") return "";
  const v = input.file_path || input.path || input.pattern || input.command || input.query || input.url || "";
  const s = String(v).replace(/\s+/g, " ").trim();
  return s ? ` ${s.length > 80 ? s.slice(0, 77) + "…" : s}` : "";
}

// The live view (spinner + folding actions on a TTY, plain append-only when piped, silent when
// CW_AGENT_STREAM=0) + cursor hygiene + an always-on-disk transcript live in the shared core.
void traceEnabled; // superseded by the renderer (which does its own TTY/stream gating)
const render = createRenderer({ env: process.env, stderr: process.stderr, label: "claude" });
const transcriptPath = path.join(path.dirname(resultPath), "transcript.md");

// stream-json so claude emits incremental NDJSON events we render live. We CAPTURE claude's
// own stderr (do NOT inherit) so it can never corrupt the live region; it's surfaced only on a
// non-zero exit.
const child = spawn(
  "claude",
  ["-p", prompt, "--output-format", "stream-json", "--verbose", "--allowedTools", "Read,Grep,Glob,Bash"],
  { stdio: ["ignore", "pipe", "pipe"] }
);

let model;
let usage;
let resultText;
let buf = "";
let childStderr = "";
child.stderr.setEncoding("utf8");
child.stderr.on("data", (d) => { if (childStderr.length < 1024 * 1024) childStderr += d; });

render.action("claude: reading the repo (read-only)…");

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
        render.text(part.text.trim());
      } else if (part.type === "tool_use") {
        render.action(`${part.name}${shortInput(part.name, part.input)}`);
      }
    }
  } else if (ev.type === "system" && ev.subtype === "post_turn_summary" && ev.status_detail) {
    render.note(ev.status_detail);
  } else if (ev.type === "result") {
    if (typeof ev.result === "string") resultText = ev.result;
    if (ev.usage && typeof ev.usage === "object") usage = ev.usage;
    if (ev.is_error) render.fail();
  }
}

child.on("error", (err) => {
  render.finishLive(); // restore the terminal before exiting
  process.stderr.write(`claude spawn failed: ${err.message}\n`);
  process.exit(1);
});

child.on("close", (code) => {
  render.finishLive(); // stop the spinner + restore the cursor BEFORE any further output
  render.writeTranscript(transcriptPath); // full narration + tool I/O always saved
  if (code !== 0) {
    if (childStderr.trim()) process.stderr.write(`${childStderr.trim()}\n`);
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
  // The single JSON CW consumes on STDOUT (data channel): model + usage + result.
  process.stdout.write(JSON.stringify({ model, usage, result: resultText }));
});
