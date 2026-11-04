#!/usr/bin/env node

// copilot-agent.js - GitHub Copilot CLI adapter for CW Agent Delegation Drive
// (beta: no real login has passed `cw doctor --conformance` yet).
//
// CONFIG wrapper, not a CW runtime dependency: CW spawns this out-of-
// process; this spawns `copilot` out-of-process. argv[2]/argv[3] are the
// worker input.md / result.md ({{input}}/{{result}}). stdout: one JSON
// { model, usage, result }. stderr: live trace only under CW_AGENT_STREAM=1.
//
// Flags, each from GitHub's own reference (docs.github.com/en/copilot/
// reference/copilot-cli-reference/cli-programmatic-reference, read
// 2026-11-04): `-p <prompt>` runs one prompt and exits; `--allow-all-tools`
// lets it use its tools with no approval prompt (stdin is closed, so a prompt
// would wait for ever); `--model <m>` only when CW_COPILOT_MODEL is set,
// else copilot's own default model.
//
// The answer is copilot's whole plain stdout. A non-zero exit or an empty
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
  process.stderr.write("usage: copilot-agent.js <inputPath> <resultPath>  (CW substitutes {{input}} {{result}})\n");
  process.exit(2);
}

const requestedModel = (process.env.CW_COPILOT_MODEL || "").trim();
const render = createRenderer({ env: process.env, stderr: process.stderr, label: "copilot" });
const transcriptPath = path.join(path.dirname(resultPath), "transcript.md");
const args = ["-p", buildPrompt(inputPath), "--allow-all-tools", ...(requestedModel ? ["--model", requestedModel] : [])];
let stdoutText = "";
let childStderr = "";

render.action("copilot: running…");
const child = spawnVendor("copilot", "copilot", args, { stdio: ["ignore", "pipe", "pipe"], shell: false }, resultPath, () => render.finishLive());
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
  persistStderr(resultPath, `copilot spawn failed: ${error.message}`);
  process.stderr.write(`copilot spawn failed: ${error.message}\n`);
  process.exit(1);
});

child.on("close", (code) => {
  render.finishLive();
  render.writeTranscript(transcriptPath);
  finishPlainTextRun({ label: "copilot", code, stdoutText, childStderr, resultPath, model: requestedModel || undefined });
});
