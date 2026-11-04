#!/usr/bin/env node

// grok-agent.js - xAI Grok Build CLI adapter for CW Agent Delegation Drive
// (beta; a real login, grok 1.0.70, passed `cw doctor --conformance` on
// 2026-11-04 with one warning: no model reported. The JSON record below answers it).
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
// default; `--output-format json` prints one JSON record at the end.
//
// The record, as grok 1.0.70 printed it on a real login (2026-11-04):
// { "text", "stopReason", "sessionId", "usage": { input_tokens,
// output_tokens, cache_read_input_tokens, ... }, "modelUsage": { "<model>":
// {...} }, ... }. The answer is `text`; the model is the key of
// `modelUsage` (the one that truly ran; more than one is joined with ","),
// else CW_GROK_MODEL; `usage` is passed on as it is (its snake_case names
// are the ones CW reads). Stdout that is not that record, or an empty
// `text`, fails closed (no result.md), like a non-zero exit. The prompt is an argument, so a prompt
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
const args = ["-p", buildPrompt(inputPath), "--output-format", "json", "--no-auto-update", ...(requestedModel ? ["-m", requestedModel] : [])];
let stdoutText = "";
let childStderr = "";

render.action("grok: running…");
const child = spawnVendor("grok", "grok", args, { stdio: ["ignore", "pipe", "pipe"], shell: false }, resultPath, () => render.finishLive());
recordVendorPid(child);

child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  stdoutText += chunk;
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
  if (code !== 0) {
    finishPlainTextRun({ label: "grok", code, stdoutText, childStderr, resultPath });
    return;
  }
  let record;
  try {
    record = JSON.parse(stdoutText.trim());
  } catch {
    record = undefined;
  }
  if (!record || typeof record !== "object" || typeof record.text !== "string") {
    const detail = "grok printed no JSON record with a text field - refusing to fabricate a result";
    persistStderr(resultPath, [detail, childStderr.trim(), stdoutText.trim().slice(0, 2000)].filter(Boolean).join("\n"));
    process.stderr.write(`${detail}\n`);
    process.exit(1);
  }
  const ran = record.modelUsage && typeof record.modelUsage === "object" ? Object.keys(record.modelUsage) : [];
  const model = ran.length ? ran.join(",") : requestedModel || undefined;
  const usage = record.usage && typeof record.usage === "object" ? record.usage : undefined;
  finishPlainTextRun({ label: "grok", code, stdoutText: record.text, childStderr, resultPath, model, usage });
});
