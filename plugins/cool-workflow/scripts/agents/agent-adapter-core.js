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
  return env.CW_AGENT_STREAM === "1" && env.CW_NO_STREAM !== "1";
}

function traceEnabled(env = process.env, stderr = process.stderr) {
  return streamEnabled(env) && Boolean(stderr.isTTY);
}

function trace(line, env = process.env, stderr = process.stderr) {
  if (!traceEnabled(env, stderr)) return;
  stderr.write(`${line}\n`);
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

  const type = String(ev.type || ev.event || ev.kind || "");
  const toolName = toolNameFromEvent(ev);
  if (toolName || /tool|command/i.test(type)) {
    const arg = shortText(toolArgFromEvent(ev), 80);
    trace(`  -> ${toolName || type}${arg ? ` ${arg}` : ""}`);
    return;
  }

  const text = textFromEvent(ev);
  if (text && /assistant|message|delta|text|response|output/i.test(type || "text")) {
    trace(`  ${shortText(text, 240)}`);
  } else if (/turn|step|summary|status/i.test(type)) {
    const status = firstString(ev.status, ev.status_detail, ev.summary, ev.message);
    if (status) trace(`  . ${provider}: ${shortText(status, 160)}`);
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
  parseJsonLines,
  flushJsonLines,
  writeResult,
  emitReport
};
