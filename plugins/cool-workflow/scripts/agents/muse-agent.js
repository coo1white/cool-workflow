#!/usr/bin/env node
"use strict";

// muse-agent.js - Muse Code CLI adapter for CW Agent Delegation Drive.
//
// CONFIG wrapper, not a CW runtime dependency: CW spawns this out-of-
// process; this spawns `muse exec` out-of-process. argv[2]/argv[3] are the
// worker input.md / result.md ({{input}}/{{result}}). stdout: one JSON
// { model, usage, result }. stderr: live trace only under CW_AGENT_STREAM=1.
//
// muse --json emits JSONL keyed by `payload_type`, plus a non-JSON banner
// line ("muse: workspace root: ...") that must be skipped, not a parse
// error. Only the LAST `run.terminal.*` record counts (`.completed` or
// `.failed`): `payload.terminal === "completed"` carries the text in
// `payload.text`; any other terminal value (its `payload.reason` is
// surfaced verbatim), or none at all, is a FAILURE - never fabricate a
// result. `model` is self-reported: the id passed via --model, default
// "muse-spark-1.2" (CW_MUSE_MODEL overrides).

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const {
  buildFailureDetail,
  buildPrompt,
  createRenderer,
  emitReport,
  flushJsonLines,
  parseJsonLines,
  persistStderr,
  recordVendorPid,
  writeResult
} = require("./agent-adapter-core");

const inputPath = process.argv[2];
const resultPath = process.argv[3];
if (!inputPath || !resultPath) {
  process.stderr.write("usage: muse-agent.js <inputPath> <resultPath>  (CW substitutes {{input}} {{result}})\n");
  process.exit(2);
}

const modelId = (process.env.CW_MUSE_MODEL || "").trim() || "muse-spark-1.2";
// Reasoning effort: mirrors codex-agent.js's speed cap (muse's own default,
// "high", is too slow for a worker). CW_MUSE_REASONING_EFFORT always wins.
const reasoningEffort = process.env.CW_MUSE_REASONING_EFFORT || (process.env.CW_RELEASE_REVIEW === "1" ? "high" : "low");
const promptFile = path.join(path.dirname(resultPath), `.muse-prompt-${process.pid}.md`);
function removePromptFile() {
  try {
    fs.rmSync(promptFile, { force: true });
  } catch {
    /* best effort */
  }
}
fs.writeFileSync(promptFile, buildPrompt(inputPath), "utf8");

const render = createRenderer({ env: process.env, stderr: process.stderr, label: "muse" });
const transcriptPath = path.join(path.dirname(resultPath), "transcript.md");
const state = { buffer: "", usage: undefined, sawTerminal: false, terminal: undefined, terminalReason: undefined, finalText: undefined };
let childStderr = "";

// Best-effort usage: no shape is fixed for the meta provider, so accept
// any event (or its payload) carrying a plain `usage` object.
function usageIn(obj) {
  return obj && typeof obj === "object" && obj.usage && typeof obj.usage === "object" ? obj.usage : undefined;
}

function recordJsonLine(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return; // vendor banner line ("muse: workspace root: ..."), not a record
  let ev;
  try {
    ev = JSON.parse(trimmed);
  } catch {
    state.invalidJson = true;
    return;
  }
  if (!ev || typeof ev !== "object") return;
  const payload = ev.payload && typeof ev.payload === "object" ? ev.payload : undefined;
  const usage = usageIn(ev) || usageIn(payload);
  if (usage) state.usage = usage;

  if (ev.payload_type === "run.output.delta") {
    const text = payload && typeof payload.text === "string" ? payload.text : undefined;
    if (text) render.text(text);
    return;
  }
  // Match the whole run.terminal.* family: 1.0.1 uses a DISTINCT payload_type
  // per outcome (.completed / .failed), not one name with a varying field.
  if (typeof ev.payload_type === "string" && ev.payload_type.startsWith("run.terminal.")) {
    state.sawTerminal = true;
    state.terminal = payload && payload.terminal;
    state.terminalReason = payload && payload.reason;
    if (state.terminal === "completed" && payload && typeof payload.text === "string") state.finalText = payload.text;
  }
  // Every other payload_type (reconciliation/status/task.lifecycle.*/...) is
  // intentionally ignored: unknown record shapes must never choke the parser.
}

render.action(`muse: running ${modelId} (workspace)…`);

const args = ["exec", "--json", "--prompt-file", promptFile, "--model", modelId, "--reasoning-effort", reasoningEffort, "--workspace", process.cwd()];

const child = spawn("muse", args, { stdio: ["ignore", "pipe", "pipe"], shell: false });
recordVendorPid(child);

child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  parseJsonLines("muse", chunk, state, recordJsonLine);
});

child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
  if (childStderr.length < 1024 * 1024) childStderr += chunk;
});

child.on("error", (error) => {
  render.finishLive();
  removePromptFile();
  persistStderr(resultPath, `muse spawn failed: ${error.message}`);
  process.stderr.write(`muse spawn failed: ${error.message}\n`);
  process.exit(1);
});

child.on("close", (code) => {
  flushJsonLines("muse", state, recordJsonLine);
  render.finishLive();
  render.writeTranscript(transcriptPath);
  removePromptFile();

  if (code !== 0) {
    const detail = buildFailureDetail({ label: "muse", code, childStderr: childStderr.trim(), partialText: state.finalText });
    persistStderr(resultPath, detail);
    process.stderr.write(`${detail}\n`);
    process.exit(code === null ? 1 : code);
  }
  if (state.invalidJson) {
    const detail = "muse --json produced an unparseable JSON line - refusing to trust the result";
    persistStderr(resultPath, childStderr.trim() || detail);
    process.stderr.write(`${detail}\n`);
    process.exit(1);
  }
  if (!state.sawTerminal) {
    const detail = "muse run ended with no terminal event - refusing to fabricate a result";
    persistStderr(resultPath, childStderr.trim() || detail);
    process.stderr.write(`${detail}\n`);
    process.exit(1);
  }
  if (state.terminal !== "completed") {
    // payload.reason is the vendor's own words for what to do next (e.g. a
    // rejected API key) - print it verbatim as the error line, not buried
    // inside a longer sentence.
    const detail = state.terminalReason
      ? String(state.terminalReason)
      : `muse run terminal was "${state.terminal}", not "completed" - refusing to fabricate a result`;
    persistStderr(resultPath, childStderr.trim() || detail);
    process.stderr.write(`${detail}\n`);
    process.exit(1);
  }

  try {
    writeResult(resultPath, state.finalText || "");
  } catch (error) {
    persistStderr(resultPath, `muse produced no final result: ${error.message}`);
    process.stderr.write(`muse produced no final result: ${error.message}\n`);
    process.exit(1);
  }

  emitReport(modelId, state.usage, state.finalText);
});
