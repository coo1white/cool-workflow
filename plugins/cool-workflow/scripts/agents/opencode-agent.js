#!/usr/bin/env node
"use strict";

// opencode-agent.js - OpenCode CLI adapter for CW Agent Delegation Drive.
//
// This is a CONFIG wrapper, not a CW runtime dependency. CW spawns this script
// out-of-process; this script spawns `opencode run` out-of-process. Vendor JSONL
// parsing stays here in userland policy.
//
// Contract:
//   argv[2] = {{input}}   worker input.md
//   argv[3] = {{result}}  worker result.md to persist
//
// stdout: one JSON object { model, usage, result } for CW provenance.
// stderr: optional live trace when CW_AGENT_STREAM=1 and attached to a TTY.
//
// NOTE: --dangerously-skip-permissions is used because OpenCode lacks a native
// --read-only or --allowed-tools flag. CW's sandbox layer enforces write safety
// via execution-backend boundary controls. If OpenCode adds a cleaner read-only
// flag, prefer that here.

const path = require("node:path");
const { spawn } = require("node:child_process");
const {
  buildPrompt,
  createRenderer,
  emitReport,
  flushJsonLines,
  parseJsonLines,
  writeResult
} = require("./agent-adapter-core");

const inputPath = process.argv[2];
const resultPath = process.argv[3];
if (!inputPath || !resultPath) {
  process.stderr.write("usage: opencode-agent.js <inputPath> <resultPath>  (CW substitutes {{input}} {{result}})\n");
  process.exit(2);
}

// Same runner serves both `opencode` (provider default model) and `deepseek`
// (DeepSeek via opencode). The variant sets CW_OPENCODE_LABEL + CW_OPENCODE_MODEL;
// see deepseek-agent.js. Unset = plain opencode, unchanged behavior.
const label = process.env.CW_OPENCODE_LABEL || "opencode";
const requestedModel = process.env.CW_OPENCODE_MODEL || "";

const prompt = buildPrompt(inputPath);
const render = createRenderer({ env: process.env, stderr: process.stderr, label });
const transcriptPath = path.join(path.dirname(resultPath), "transcript.md");
const state = {
  provider: label,
  buffer: "",
  // opencode --format json carries NO model field; record the model we asked for.
  model: requestedModel || undefined,
  usage: undefined,
  textFragments: [],
  finalResult: undefined,
  lastMessageId: undefined,
  lastMessageText: "",
  renderer: render
};
let childStderr = "";

// opencode (>=1.x) --format json emits JSONL events of shape { type, part }:
//   type:"text"        -> part.text         assistant text, grouped by part.messageID
//   type:"step_finish" -> part.tokens       { input, output, ... } per step
// The final answer is the LAST message's text (earlier "text" parts are mid-run
// narration). Older opencode shapes (ev.result / ev.text / ev.delta) are still
// accepted as a fallback so the wrapper is not pinned to one CLI version.
function recordJsonLine(line) {
  let ev;
  try {
    ev = JSON.parse(line);
  } catch {
    state.invalidJson = true;
    return;
  }
  const part = ev && typeof ev.part === "object" && ev.part ? ev.part : {};

  if (ev.type === "text" && typeof part.text === "string") {
    const mid = typeof part.messageID === "string" ? part.messageID : "";
    if (mid !== state.lastMessageId) {
      state.lastMessageId = mid;
      state.lastMessageText = "";
    }
    state.lastMessageText += (state.lastMessageText ? "\n" : "") + part.text;
    if (part.text.trim()) state.textFragments.push(part.text);
    return;
  }

  if (ev.type === "step_finish" && part.tokens && typeof part.tokens === "object") {
    state.usage = state.usage || { input_tokens: 0, output_tokens: 0 };
    state.usage.input_tokens += Number(part.tokens.input) || 0;
    state.usage.output_tokens += Number(part.tokens.output) || 0;
    return;
  }

  // Fallback: older opencode JSON shapes (single result object / delta stream).
  if (ev.result && typeof ev.result === "string") {
    state.finalResult = ev.result;
    return;
  }
  const legacy = typeof ev.text === "string" ? ev.text : (ev.delta ? (typeof ev.delta === "string" ? ev.delta : ev.delta.text) : undefined);
  if (typeof legacy === "string" && legacy.trim()) state.textFragments.push(legacy);
}

render.action(`${label}: reading the repo…`);

// `opencode run` takes the message as a POSITIONAL arg ("opencode run [message..]");
// there is no --prompt flag. Pass the prompt last, as the positional message.
// --model (provider/model, e.g. deepseek/deepseek-chat) is added only when a
// variant requests it; otherwise opencode uses its configured default model.
const args = [
  "run",
  "--format",
  "json",
  "--dangerously-skip-permissions",
  ...(requestedModel ? ["--model", requestedModel] : []),
  prompt
];

const child = spawn("opencode", args, {
  stdio: ["ignore", "pipe", "pipe"],
  shell: false
});

child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  parseJsonLines("opencode", chunk, state, recordJsonLine);
});

// Capture opencode's own stderr (do NOT inherit) so it can never corrupt the live region.
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
  if (childStderr.length < 1024 * 1024) childStderr += chunk;
});

child.on("error", (error) => {
  render.finishLive();
  process.stderr.write(`opencode spawn failed: ${error.message}\n`);
  process.exit(1);
});

child.on("close", (code) => {
  flushJsonLines("opencode", state, recordJsonLine);
  render.finishLive();
  render.writeTranscript(transcriptPath);
  if (code !== 0) {
    const detail = childStderr.trim() || `opencode exited ${code === null ? "(timeout/killed)" : code}`;
    process.stderr.write(`${detail}\n`);
    process.exit(code === null ? 1 : code);
  }
  if (state.invalidJson) {
    process.stderr.write("opencode --format json produced a non-JSONL stdout line - refusing to trust the result\n");
    process.exit(1);
  }

  const resultText = state.finalResult || state.lastMessageText || state.textFragments.join("\n\n");
  if (!resultText.trim()) {
    process.stderr.write("opencode produced no result text - refusing to fabricate a result\n");
    process.exit(1);
  }

  try {
    writeResult(resultPath, resultText);
  } catch (error) {
    process.stderr.write(`opencode produced no final result: ${error.message}\n`);
    process.exit(1);
  }

  emitReport(state.model, state.usage, resultText);
});
