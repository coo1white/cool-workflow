#!/usr/bin/env node
"use strict";

// gemini-agent.js - Gemini CLI adapter for CW Agent Delegation Drive.
//
// This is a CONFIG wrapper, not a CW runtime dependency. CW spawns this script
// out-of-process; this script spawns `gemini` out-of-process. Vendor NDJSON
// parsing stays here in userland policy.
//
// Contract:
//   argv[2] = {{input}}   worker input.md
//   argv[3] = {{result}}  worker result.md to persist
//
// stdout: one JSON object { model, usage, result } for CW provenance.
// stderr: optional live trace when CW_AGENT_STREAM=1 and attached to a TTY.

const path = require("node:path");
const {
  buildFailureDetail,
  buildPrompt,
  createRenderer,
  emitReport,
  flushJsonLines,
  parseJsonLines,
  persistStderr,
  recordVendorPid,
  spawnVendor,
  writeResult
} = require("./agent-adapter-core");

const inputPath = process.argv[2];
const resultPath = process.argv[3];
if (!inputPath || !resultPath) {
  process.stderr.write("usage: gemini-agent.js <inputPath> <resultPath>  (CW substitutes {{input}} {{result}})\n");
  process.exit(2);
}

// The prompt goes to gemini on STDIN, never as an argument: Linux takes at
// most 131072 bytes in one argument (macOS about 1 MB for all of them), and a
// Verdict prompt, which carries every earlier result, passes that on real runs
// (spawn E2BIG). A piped stdin puts gemini in headless mode with no -p.
// gemini reads at most 8 MiB of stdin and cuts the rest with only a warning,
// so a longer prompt is refused here: never a silent half prompt.
const GEMINI_STDIN_MAX_BYTES = 8 * 1024 * 1024;
const prompt = buildPrompt(inputPath);
const promptBytes = Buffer.byteLength(prompt, "utf8");
if (promptBytes > GEMINI_STDIN_MAX_BYTES) {
  const message = `gemini prompt is ${promptBytes} bytes, more than the ${GEMINI_STDIN_MAX_BYTES} bytes gemini reads from stdin; not started, as gemini would cut the prompt`;
  persistStderr(resultPath, message);
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
const render = createRenderer({ env: process.env, stderr: process.stderr, label: "gemini" });
const transcriptPath = path.join(path.dirname(resultPath), "transcript.md");
const state = { provider: "gemini", buffer: "", model: undefined, usage: undefined, textFragments: [], finalResult: undefined, renderer: render };
let childStderr = "";
function recordJsonLine(line) {
  let ev;
  try {
    ev = JSON.parse(line);
  } catch {
    state.invalidJson = true;
    return;
  }
  // Prefer the final result event text; delta events are incremental fallback.
  if (ev.result && typeof ev.result === "string") {
    state.finalResult = ev.result;
  } else {
    const text = typeof ev.text === "string" ? ev.text : (ev.delta ? (typeof ev.delta === "string" ? ev.delta : ev.delta.text) : undefined);
    if (typeof text === "string" && text.trim()) state.textFragments.push(text);
  }
}

render.action("gemini: reading the repo (read-only)…");

const args = [
  "--output-format",
  "stream-json",
  "--approval-mode",
  "plan"
];

const child = spawnVendor("gemini", "gemini", args, {
  stdio: ["pipe", "pipe", "pipe"],
  shell: false
}, resultPath, () => render.finishLive());
// A gemini that exits before reading all of stdin gives EPIPE here; its exit
// code and stderr are what the close handler below reports.
child.stdin.on("error", () => {});
child.stdin.end(prompt);
// Record the vendor PID so cw can reap this gemini process if it SIGKILLs the
// wrapper on a timeout (see agent-adapter-core recordVendorPid).
recordVendorPid(child);

child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  parseJsonLines("gemini", chunk, state, recordJsonLine);
});

// Capture gemini's own stderr (do NOT inherit) so it can never corrupt the live region.
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
  if (childStderr.length < 1024 * 1024) childStderr += chunk;
});

child.on("error", (error) => {
  render.finishLive();
  persistStderr(resultPath, `gemini spawn failed: ${error.message}`);
  process.stderr.write(`gemini spawn failed: ${error.message}\n`);
  process.exit(1);
});

child.on("close", (code) => {
  flushJsonLines("gemini", state, recordJsonLine);
  render.finishLive();
  render.writeTranscript(transcriptPath);
  if (code !== 0) {
    // gemini's real failure reason is often only in the NDJSON text/result
    // fragments already parsed into `state`, not in raw OS-level stderr.
    const partial = state.finalResult || state.textFragments.join("\n\n");
    const detail = buildFailureDetail({ label: "gemini", code, childStderr: childStderr.trim(), partialText: partial });
    persistStderr(resultPath, detail);
    process.stderr.write(`${detail}\n`);
    process.exit(code === null ? 1 : code);
  }
  if (state.invalidJson) {
    const detail = "gemini --output-format stream-json produced a non-JSONL stdout line - refusing to trust the result";
    persistStderr(resultPath, childStderr.trim() || detail);
    process.stderr.write(`${detail}\n`);
    process.exit(1);
  }

  const resultText = state.finalResult || state.textFragments.join("\n\n");
  if (!resultText.trim()) {
    const detail = "gemini produced no result text - refusing to fabricate a result";
    persistStderr(resultPath, childStderr.trim() || detail);
    process.stderr.write(`${detail}\n`);
    process.exit(1);
  }

  try {
    writeResult(resultPath, resultText);
  } catch (error) {
    persistStderr(resultPath, `gemini produced no final result: ${error.message}`);
    process.stderr.write(`gemini produced no final result: ${error.message}\n`);
    process.exit(1);
  }

  emitReport(state.model, state.usage, resultText);
});
