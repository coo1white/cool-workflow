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
//
// SPEED: codex `exec` inherits the user's ~/.codex/config.toml, including a heavy
// `model_reasoning_effort` (e.g. "high"), which makes every read/grep turn slow.
// CW caps it for ITS runs only via `-c model_reasoning_effort=<effort>` — a
// per-run override that does NOT touch the user's interactive codex. Tune with
// CW_CODEX_REASONING_EFFORT (default "low"); set it to "medium"/"high" to opt back
// into more thinking.
//
// REVIEW MODE: the default low-effort / read-only sandbox is right for a fast
// delegated worker or a liveness probe — but WRONG for an independent RELEASE
// reviewer, which must actually RE-RUN the gate (build, tests, regenerate dist)
// to earn its verdict. A read-only sandbox can't execute that gate, so the model
// is structurally unable to verify and tends to fabricate a REJECTED. The release
// path therefore sets CW_RELEASE_REVIEW=1 (a vendor-agnostic signal from
// release-flow.js): on that signal this wrapper raises reasoning to "high" and
// opens the sandbox to "workspace-write" so codex can run the gate it is judging.
// Explicit CW_CODEX_REASONING_EFFORT / CW_CODEX_SANDBOX always win over the signal.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const {
  buildPrompt,
  createRenderer,
  emitReport,
  flushJsonLines,
  parseJsonLines,
  persistStderr,
  writeResult
} = require("./agent-adapter-core");

// codex exec --json (>=0.139) emits NO model field in its JSONL (only thread/turn
// events + usage). For provenance, fall back to the model codex is configured to
// use: $CODEX_HOME/config.toml (or ~/.codex/config.toml), key `model`. Best effort
// — a stream model field (older/newer codex) still wins.
function detectCodexModel() {
  try {
    const home = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
    const cfg = fs.readFileSync(path.join(home, "config.toml"), "utf8");
    const m = cfg.match(/^\s*model\s*=\s*["']([^"']+)["']/m);
    return m ? m[1] : undefined;
  } catch {
    return undefined;
  }
}

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
const render = createRenderer({ env: process.env, stderr: process.stderr, label: "codex" });
const transcriptPath = path.join(path.dirname(resultPath), "transcript.md");
const state = { provider: "codex", buffer: "", model: undefined, usage: undefined, renderer: render };
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

// A release review (CW_RELEASE_REVIEW=1) must execute the gate it judges, so it
// needs both stronger reasoning and a sandbox that can write inside the workspace.
// Explicit env overrides win; otherwise the review signal lifts the fast defaults.
const reviewMode = process.env.CW_RELEASE_REVIEW === "1";

// Cap codex's reasoning effort for CW runs (speed) — overrides config.toml for
// THIS invocation only. Default "low"; CW_CODEX_REASONING_EFFORT opts back up, and
// a release review defaults to "high".
const effort = process.env.CW_CODEX_REASONING_EFFORT || (reviewMode ? "high" : "low");

// Sandbox: read-only is the POLA default (a worker/probe only reads). A release
// review opens to workspace-write so codex can build/test/regenerate the gate.
// CW_CODEX_SANDBOX overrides both; an unknown value fails closed (never silently
// downgraded to read-only, which would re-create the can't-verify failure mode).
const SANDBOX_MODES = new Set(["read-only", "workspace-write", "danger-full-access"]);
const sandbox = process.env.CW_CODEX_SANDBOX || (reviewMode ? "workspace-write" : "read-only");
if (!SANDBOX_MODES.has(sandbox)) {
  process.stderr.write(
    `codex-agent: invalid CW_CODEX_SANDBOX="${sandbox}" — expected one of ${[...SANDBOX_MODES].join(", ")}\n`
  );
  process.exit(2);
}

render.action(`codex: reading the repo (${sandbox})…`);

const args = [
  "exec",
  "--json",
  "-c",
  `model_reasoning_effort=${effort}`,
  "--output-last-message",
  finalPath,
  "--sandbox",
  sandbox,
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

// Capture codex's own stderr (do NOT inherit) so it can never corrupt the live region; it's
// surfaced only on a non-zero exit.
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
  if (childStderr.length < 1024 * 1024) childStderr += chunk;
});

child.on("error", (error) => {
  render.finishLive();
  persistStderr(resultPath, `codex spawn failed: ${error.message}`);
  process.stderr.write(`codex spawn failed: ${error.message}\n`);
  process.exit(1);
});

child.on("close", (code) => {
  flushJsonLines("codex", state, recordJsonLine);
  render.finishLive();
  render.writeTranscript(transcriptPath);
  if (code !== 0) {
    const detail = childStderr.trim() || `codex exited ${code === null ? "(timeout/killed)" : code}`;
    persistStderr(resultPath, detail);
    process.stderr.write(`${detail}\n`);
    process.exit(code === null ? 1 : code);
  }
  if (state.invalidJson) {
    const detail = "codex --json produced a non-JSONL stdout line - refusing to trust the result";
    persistStderr(resultPath, childStderr.trim() || detail);
    process.stderr.write(`${detail}\n`);
    process.exit(1);
  }

  let resultText = "";
  try {
    resultText = fs.readFileSync(finalPath, "utf8");
  } catch {
    const detail = "codex produced no final output file - refusing to fabricate a result";
    persistStderr(resultPath, childStderr.trim() || detail);
    process.stderr.write(`${detail}\n`);
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
    persistStderr(resultPath, `codex produced no final result: ${error.message}`);
    process.stderr.write(`codex produced no final result: ${error.message}\n`);
    process.exit(1);
  }

  emitReport(state.model || detectCodexModel(), state.usage, resultText);
});
