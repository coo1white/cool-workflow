#!/usr/bin/env node
"use strict";

const fs = require("node:fs");

const RESULT_CONTRACT = `
=== HOW TO RETURN YOUR ANSWER (overrides any 'write to result.md' instruction above) ===
You have NO file-write access. Do NOT attempt to write, create, or edit any file -
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
- If you have no structured findings, use "findings": [] (empty) - never omit a finding's id.`;

function buildPrompt(inputPath) {
  return `${fs.readFileSync(inputPath, "utf8")}\n${RESULT_CONTRACT}`;
}

function streamEnabled(env = process.env) {
  return env.CW_AGENT_STREAM !== "0" && env.CW_NO_STREAM !== "1";
}

function traceEnabled(env = process.env, stderr = process.stderr) {
  return streamEnabled(env) && Boolean(stderr.isTTY);
}

function trace(line, env = process.env, stderr = process.stderr) {
  if (!traceEnabled(env, stderr)) return;
  stderr.write(`${line}\n`);
}

// ---- live renderer (zero-dep, hand-rolled — kept self-contained so this wrapper stays a
//      copyable "config", not a build-coupled dependency) -----------------------------------

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const ANSI = { reset: "\x1b[0m", dim: "\x1b[2m", green: "\x1b[32m", red: "\x1b[31m", cyan: "\x1b[36m", hideCursor: "\x1b[?25l", showCursor: "\x1b[?25h", clearLine: "\r\x1b[2K" };
const ANSI_RE = /\x1b\[[0-9;]*m/g;

function colorOn(env, stderr) {
  if ((env.NO_COLOR ?? "") !== "" || (env.CW_NO_COLOR ?? "") !== "") return false;
  if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== "" && env.FORCE_COLOR !== "0") return true;
  return Boolean(stderr.isTTY);
}
// Behaviorally IDENTICAL to src/term.ts truncate() — the two copies exist only because the wrapper
// is a self-contained plain-JS "config" (no import of the TS build). cli-render-smoke cross-checks
// them on shared cases so this invariant cannot silently drift: maxWidth<=0 → ""; a string that fits
// returns the ORIGINAL text (ANSI intact); otherwise stripped + sliced + "…".
function truncate(text, max) {
  if (max <= 0) return "";
  const chars = [...String(text).replace(ANSI_RE, "")];
  if (chars.length <= max) return String(text);
  return max <= 1 ? "…" : `${chars.slice(0, max - 1).join("")}…`;
}
function fmtElapsed(ms) {
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}m${String(Math.round(s % 60)).padStart(2, "0")}s`;
}

/** A single live status line (interactive) or append-only lines (non-TTY), plus an always-on
 *  transcript buffer. `action(label)` commits the PREVIOUS action as ✓/✗ then makes `label` the
 *  current spinning action — vendor-neutral folding without needing reliable start/end pairing. */
function createRenderer(opts = {}) {
  const env = opts.env || process.env;
  const stderr = opts.stderr || process.stderr;
  const interactive = streamEnabled(env) && Boolean(stderr.isTTY);
  // Non-TTY default stays SILENT (CW's Rule of Silence). Plain append-only logging in non-TTY
  // is an explicit opt-in for CI debuggability — `CW_AGENT_STREAM=1`, mirroring CW_DRIVE_PROGRESS=1.
  const plain = streamEnabled(env) && !stderr.isTTY && env.CW_AGENT_STREAM === "1";
  const verbose = env.CW_VERBOSE === "1" || env.CW_VERBOSE === "true" || env.CW_OUTPUT === "full";
  const color = colorOn(env, stderr);
  const width = Math.max(20, Math.min(120, Number(stderr.columns) || 80));
  const paint = (code, text) => (color ? `${code}${text}${ANSI.reset}` : text);

  const transcript = [];
  let live = "";        // current rendered live line (no trailing newline) when interactive
  let timer = null;
  let frame = 0;
  let cursorHidden = false;
  let current = null;   // { label, startedAt, failed }

  const restoreCursor = () => {
    if (cursorHidden) { try { stderr.write(ANSI.showCursor); } catch { /* noop */ } cursorHidden = false; }
  };
  // Cursor hygiene: ALWAYS restore on exit / Ctrl-C / kill, even on crash.
  const onSignal = (sig) => { stop(); process.exit(sig === "SIGINT" ? 130 : 143); };
  if (interactive) {
    process.once("exit", restoreCursor);
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
  }

  const renderLive = () => {
    if (!interactive || !current) return;
    if (!cursorHidden) { stderr.write(ANSI.hideCursor); cursorHidden = true; }
    const el = paint(ANSI.dim, fmtElapsed(Date.now() - current.startedAt));
    const sp = paint(ANSI.cyan, SPINNER[frame % SPINNER.length]);
    live = `${sp} ${truncate(current.label, width - 10)} ${el}`;
    stderr.write(`${ANSI.clearLine}${live}`);
  };
  const clearLive = () => { if (interactive && live) { stderr.write(ANSI.clearLine); live = ""; } };
  const ensureTimer = () => {
    if (interactive && !timer) timer = setInterval(() => { frame++; renderLive(); }, 90);
  };

  const commit = () => {
    if (!current) return;
    const ms = Date.now() - current.startedAt;
    const glyph = current.failed ? paint(ANSI.red, "✗") : paint(ANSI.green, "✓");
    const doneLine = `${glyph} ${paint(ANSI.dim, `${truncate(current.label, width - 12)} (${fmtElapsed(ms)})`)}`;
    transcript.push(`- ${current.failed ? "✗" : "✓"} ${current.label} (${fmtElapsed(ms)})`);
    if (interactive) { clearLive(); stderr.write(`${doneLine}\n`); }
    else if (plain) stderr.write(`${current.failed ? "✗" : "✓"} ${current.label} (${fmtElapsed(ms)})\n`);
    current = null;
  };

  return {
    /** Begin a new active action (commits + folds the previous one). */
    action(label) {
      commit();
      current = { label: String(label || "working…"), startedAt: Date.now(), failed: false };
      ensureTimer();
      if (interactive) renderLive();
      else if (plain) stderr.write(`→ ${current.label}\n`);
    },
    /** Mark the current action as failed (it commits as ✗). */
    fail() { if (current) current.failed = true; },
    /** Narration text from the model. Always to the transcript; inline only in --verbose. */
    text(chunk) {
      const t = String(chunk || "").trim();
      if (!t) return;
      transcript.push(t);
      if (!verbose) return;
      if (interactive) { clearLive(); stderr.write(`${paint(ANSI.dim, truncate(t, width))}\n`); renderLive(); }
      else if (plain) stderr.write(`${truncate(t, width)}\n`);
    },
    /** A short status note (e.g. provider summary). Transcript always; inline in --verbose. */
    note(text) { this.text(text); },
    /** Stop the spinner + restore the terminal. Idempotent. */
    finishLive() { stop(); },
    /** Persist the full transcript (narration + tool I/O) regardless of verbosity. */
    writeTranscript(filePath) {
      try { fs.writeFileSync(filePath, `# Agent transcript\n\n${transcript.join("\n")}\n`, "utf8"); } catch { /* advisory */ }
    },
    isVerbose: () => verbose
  };

  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
    commit();
    clearLive();
    restoreCursor();
  }
}

function shortText(value, max = 100) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function maybeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}

function firstString(...values) {
  for (const value of values) if (typeof value === "string" && value.trim()) return value.trim();
  return undefined;
}

function firstObject(...values) {
  for (const value of values) {
    const obj = maybeObject(value);
    if (obj) return obj;
  }
  return undefined;
}

function modelFromEvent(ev) {
  const msg = maybeObject(ev.message);
  return firstString(ev.model, ev.model_id, ev.modelId, msg && msg.model, ev.provider_model);
}

function usageFromEvent(ev) {
  const msg = maybeObject(ev.message);
  return firstObject(ev.usage, ev.token_usage, ev.tokenUsage, msg && msg.usage);
}

function toolNameFromEvent(ev) {
  const item = maybeObject(ev.item);
  const call = maybeObject(ev.tool_call || ev.toolCall);
  return firstString(ev.name, ev.tool, ev.tool_name, ev.toolName, item && item.name, call && call.name);
}

function toolArgFromEvent(ev) {
  const input = maybeObject(ev.input) || maybeObject(ev.arguments) || maybeObject(ev.args) || maybeObject(ev.item && ev.item.input);
  if (!input) return "";
  return firstString(input.file_path, input.path, input.pattern, input.command, input.query, input.url, input.cmd) || "";
}

function textFromEvent(ev) {
  const delta = maybeObject(ev.delta);
  const msg = maybeObject(ev.message);
  return firstString(ev.text, ev.delta, ev.content, ev.output, delta && delta.text, msg && msg.content);
}

function renderJsonEvent(provider, ev, state) {
  if (!ev || typeof ev !== "object") return;
  const model = modelFromEvent(ev);
  if (model && !state.model) state.model = model;
  const usage = usageFromEvent(ev);
  if (usage) state.usage = usage;

  const r = state.renderer;
  const type = String(ev.type || ev.event || ev.kind || "");
  if (ev.is_error === true && r) r.fail();

  const toolName = toolNameFromEvent(ev);
  if (toolName || /tool|command/i.test(type)) {
    const arg = shortText(toolArgFromEvent(ev), 80);
    const label = `${toolName || type}${arg ? ` ${arg}` : ""}`;
    if (r) r.action(label);
    else trace(`  -> ${label}`);
    return;
  }

  const text = textFromEvent(ev);
  if (text && /assistant|message|delta|text|response|output/i.test(type || "text")) {
    if (r) r.text(text);
    else trace(`  ${shortText(text, 240)}`);
  } else if (/turn|step|summary|status/i.test(type)) {
    const status = firstString(ev.status, ev.status_detail, ev.summary, ev.message);
    if (status) {
      if (r) r.note(`${provider}: ${status}`);
      else trace(`  . ${provider}: ${shortText(status, 160)}`);
    }
  }
}

function parseJsonLines(provider, chunk, state, onLine) {
  state.buffer = `${state.buffer || ""}${chunk}`;
  let nl;
  while ((nl = state.buffer.indexOf("\n")) >= 0) {
    const line = state.buffer.slice(0, nl).trim();
    state.buffer = state.buffer.slice(nl + 1);
    if (!line) continue;
    if (onLine) onLine(line);
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    renderJsonEvent(provider, ev, state);
  }
}

function flushJsonLines(provider, state, onLine) {
  const line = String(state.buffer || "").trim();
  state.buffer = "";
  if (!line) return;
  if (onLine) onLine(line);
  try {
    renderJsonEvent(provider, JSON.parse(line), state);
  } catch {
    /* ignore incomplete/non-JSON tail */
  }
}

function writeResult(resultPath, resultText) {
  if (typeof resultText !== "string" || !resultText.trim()) {
    throw new Error("agent produced no final result");
  }
  fs.writeFileSync(resultPath, resultText, "utf8");
}

function emitReport(model, usage, resultText) {
  process.stdout.write(JSON.stringify({ model, usage, result: resultText }));
}

module.exports = {
  RESULT_CONTRACT,
  buildPrompt,
  streamEnabled,
  traceEnabled,
  trace,
  createRenderer,
  truncate, // exported only so cli-render-smoke can assert it stays identical to term.ts truncate()
  parseJsonLines,
  flushJsonLines,
  writeResult,
  emitReport
};
