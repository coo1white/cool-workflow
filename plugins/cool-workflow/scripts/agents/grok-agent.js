#!/usr/bin/env node

// grok-agent.js - xAI Grok Build CLI adapter for CW Agent Delegation Drive
// (beta: no real login has passed `cw doctor --conformance` yet).
//
// CONFIG wrapper, not a CW runtime dependency: CW spawns this out-of-
// process; this spawns `grok` out-of-process. argv[2]/argv[3] are the
// worker input.md / result.md ({{input}}/{{result}}). stdout: one JSON
// { model, usage, result }. stderr: live trace only under CW_AGENT_STREAM=1.
//
// Flags, each from xAI's own page (docs.x.ai/build/cli/headless-scripting,
// read 2026-11-04): `-p <prompt>` runs one prompt and exits;
// `--no-auto-update` is the one it names for scripts (no update step in a
// worker run); `-m <model>` only when CW_GROK_MODEL is set, else grok's own
// default. Its `--output-format json` is left off: the page gives no record
// shape to hold a parser to, and plain text needs none.
//
// The answer is grok's whole plain stdout. A non-zero exit or an empty
// answer fails closed (no result.md). The prompt is an argument, so a prompt
// past the system's limit for one argument (Linux: 131072 bytes) fails at the
// spawn with E2BIG, written to logs/agent-stderr.log: a failed hop, never a
// cut prompt.

import path from "node:path";
import {
  buildPrompt,
  createRenderer,
  finishPlainTextRun,
  persistStderr,
  recordVendorPid,
  spawnVendor
} from "./agent-adapter-core.mjs";

const inputPath = process.argv[2];
const resultPath = process.argv[3];
if (!inputPath || !resultPath) {
  process.stderr.write("usage: grok-agent.js <inputPath> <resultPath>  (CW substitutes {{input}} {{result}})\n");
  process.exit(2);
}

const requestedModel = (process.env.CW_GROK_MODEL || "").trim();
const render = createRenderer({ env: process.env, stderr: process.stderr, label: "grok" });
const transcriptPath = path.join(path.dirname(resultPath), "transcript.md");
const args = ["-p", buildPrompt(inputPath), "--no-auto-update", ...(requestedModel ? ["-m", requestedModel] : [])];
let stdoutText = "";
let childStderr = "";

render.action("grok: running…");
const child = spawnVendor("grok", "grok", args, { stdio: ["ignore", "pipe", "pipe"], shell: false }, resultPath, () => render.finishLive());
recordVendorPid(child);

child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  stdoutText += chunk;
  render.text(chunk);
});

child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
  if (childStderr.length < 1024 * 1024) childStderr += chunk;
});

child.on("error", (error) => {
  render.finishLive();
  persistStderr(resultPath, `grok spawn failed: ${error.message}`);
  process.stderr.write(`grok spawn failed: ${error.message}\n`);
  process.exit(1);
});

child.on("close", (code) => {
  render.finishLive();
  render.writeTranscript(transcriptPath);
  finishPlainTextRun({ label: "grok", code, stdoutText, childStderr, resultPath, model: requestedModel || undefined });
});
