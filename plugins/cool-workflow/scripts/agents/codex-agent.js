#!/usr/bin/env node
"use strict";

// codex-agent.js - Codex CLI adapter for CW Agent Delegation Drive.
//
// This is a CONFIG wrapper, not a CW runtime dependency. CW spawns this script
// out-of-process; this script spawns `codex exec` out-of-process. Vendor JSONL
// parsing stays here in userland policy. CW core only captures stdout and, when
// opted in, forwards stderr.
//
// Contract:
//   argv[2] = {{input}}   worker input.md
//   argv[3] = {{result}}  worker result.md to persist
//
// stdout: one JSON object { model, usage, result } for CW provenance.
// stderr: optional live trace when CW_AGENT_STREAM=1 and attached to a TTY.

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const {
  buildPrompt,
  emitReport,
  flushJsonLines,
  parseJsonLines,
  trace,
  writeResult
} = require("./agent-adapter-core");

const inputPath = process.argv[2];
const resultPath = process.argv[3];
if (!inputPath || !resultPath) {
  process.stderr.write("usage: codex-agent.js <inputPath> <resultPath>  (CW substitutes {{input}} {{result}})\n");
  process.exit(2);
}

const finalPath = path.join(path.dirname(resultPath), `.codex-last-message-${process.pid}.md`);
try {
  fs.rmSync(finalPath, { force: true });
} catch {
  /* best effort */
}

const prompt = buildPrompt(inputPath);
const state = { provider: "codex", buffer: "", model: undefined, usage: undefined };
const capturedStdout = [];
let childStderr = "";
function recordJsonLine(line) {
  capturedStdout.push(line);
  try {
    JSON.parse(line);
  } catch {
    state.invalidJson = true;
  }
}

trace("* codex: reading the repo (read-only)...");

const args = [
  "exec",
  "--json",
  "--output-last-message",
  finalPath,
  "--sandbox",
  "read-only",
  "--ask-for-approval",
  "never",
  "--color",
  "never",
  "-"
];

const child = spawn("codex", args, {
  stdio: ["pipe", "pipe", "pipe"],
  shell: false
});

child.stdin.setDefaultEncoding("utf8");
child.stdin.end(prompt);

child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  parseJsonLines("codex", chunk, state, recordJsonLine);
});

child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
  childStderr += chunk;
  if (process.env.CW_AGENT_STREAM !== "0" && process.env.CW_NO_STREAM !== "1" && process.stderr.isTTY) {
    process.stderr.write(chunk);
  }
});

child.on("error", (error) => {
  process.stderr.write(`codex spawn failed: ${error.message}\n`);
  process.exit(1);
});

child.on("close", (code) => {
  flushJsonLines("codex", state, recordJsonLine);
  if (code !== 0) {
    const detail = childStderr.trim() || `codex exited ${code === null ? "(timeout/killed)" : code}`;
    process.stderr.write(`${detail}\n`);
    process.exit(code === null ? 1 : code);
  }
  if (state.invalidJson) {
    process.stderr.write("codex --json produced a non-JSONL stdout line - refusing to trust the result\n");
    process.exit(1);
  }

  let resultText = "";
  try {
    resultText = fs.readFileSync(finalPath, "utf8");
  } catch {
    process.stderr.write("codex produced no final output file - refusing to fabricate a result\n");
    process.exit(1);
  } finally {
    try {
      fs.rmSync(finalPath, { force: true });
    } catch {
      /* best effort */
    }
  }

  try {
    writeResult(resultPath, resultText);
  } catch (error) {
    process.stderr.write(`codex produced no final result: ${error.message}\n`);
    process.exit(1);
  }

  trace("* done - result captured");
  emitReport(state.model, state.usage, resultText);
});
