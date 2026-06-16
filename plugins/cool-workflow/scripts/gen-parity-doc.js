#!/usr/bin/env node
"use strict";

// gen-parity-doc.js — generate the CLI<->MCP parity matrix, counts, and the
// surface-specific (cli-only / projected) enumerations in
// docs/cli-mcp-parity.7.md DIRECTLY from the capability registry (the single
// source of truth). The matrix declares itself "machine-complete by design", so
// it must BE machine-generated — a hand-maintained table drifts (it did: 132
// rows vs a 190-capability registry). Mechanism, not policy.
//
//   node scripts/gen-parity-doc.js            # rewrite the generated regions
//   node scripts/gen-parity-doc.js --check    # fail closed if the doc drifted
//
// Idempotent: re-running with no registry change is a no-op. Only the four
// marker-delimited regions are touched; all surrounding prose (incl. the Basic
// English narrative and version trailers) is preserved byte-for-byte.

const fs = require("node:fs");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const DOC = path.join(pluginRoot, "docs", "cli-mcp-parity.7.md");
const CHECK = process.argv.includes("--check");

const { CAPABILITY_REGISTRY } = require(path.join(pluginRoot, "dist", "capability-registry.js"));

const NUM_WORDS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve"];
const numWord = (n) => NUM_WORDS[n] || String(n);

function cliCommand(cap) {
  return cap.cli ? `cw ${cap.cli.path.join(" ")}` : "—";
}
function cliDisplay(cap) {
  // Human form used in the prose bullets (e.g. "schedule daemon", "demo tamper").
  return cap.cli ? cap.cli.path.join(" ") : cap.capability;
}
function mcpTool(cap) {
  return cap.mcp ? cap.mcp.tool : "—";
}
function payload(cap) {
  if (cap.surface !== "both") return cap.surface;
  return cap.payloadIdentical === false ? "projected" : "identical";
}

function buildCount() {
  const caps = CAPABILITY_REGISTRY.length;
  const tools = CAPABILITY_REGISTRY.filter((c) => c.mcp && c.mcp.tool).length;
  return `machine-complete by design: ${caps} capabilities, ${tools} MCP tools.`;
}

function buildTable() {
  const lines = [
    "| Capability | CLI command | MCP tool | Core entry | Surface | Payload |",
    "| --- | --- | --- | --- | --- | --- |"
  ];
  for (const cap of CAPABILITY_REGISTRY) {
    lines.push(`| \`${cap.capability}\` | \`${cliCommand(cap)}\` | \`${mcpTool(cap)}\` | \`${cap.entry}\` | ${payload(cap) === "cli-only" || cap.surface !== "both" ? cap.surface : "both"} | ${payload(cap)} |`);
  }
  return lines.join("\n");
}

function buildCliOnly() {
  const caps = CAPABILITY_REGISTRY.filter((c) => c.surface === "cli-only");
  const head = `${numWord(caps.length)} ${caps.length === 1 ? "capability is" : "capabilities are"} CLI-only:`;
  const bullets = caps.map((c) => `- \`${cliDisplay(c)}\` — ${c.reason || "(reason recorded in the registry)"}`);
  return [head, "", ...bullets].join("\n");
}

function buildProjected() {
  const caps = CAPABILITY_REGISTRY.filter((c) => c.surface === "both" && c.payloadIdentical === false);
  const head = `${numWord(caps.length)} ${caps.length === 1 ? "capability is" : "capabilities are"} payload-divergent on purpose (\`projected\`):`;
  const bullets = caps.map((c) => `- \`${c.capability}\` — ${c.reason || "(reason recorded in the registry)"}`);
  return [head, "", ...bullets].join("\n");
}

const REGIONS = {
  count: buildCount(),
  table: buildTable(),
  cliOnly: buildCliOnly(),
  projected: buildProjected()
};

function replaceRegion(text, name, body) {
  const begin = `<!-- gen:parity:${name} -->`;
  const end = `<!-- /gen:parity:${name} -->`;
  const re = new RegExp(`${begin}[\\s\\S]*?${end}`);
  if (!re.test(text)) {
    throw new Error(`marker ${begin} … ${end} not found in cli-mcp-parity.7.md — add the markers once, then re-run.`);
  }
  return text.replace(re, `${begin}\n${body}\n${end}`);
}

const original = fs.readFileSync(DOC, "utf8");
let next = original;
for (const [name, body] of Object.entries(REGIONS)) next = replaceRegion(next, name, body);

if (CHECK) {
  if (next !== original) {
    process.stderr.write("gen-parity-doc: docs/cli-mcp-parity.7.md is OUT OF SYNC with the capability registry. Run `node scripts/gen-parity-doc.js` and commit.\n");
    process.exit(1);
  }
  process.stdout.write("gen-parity-doc: cli-mcp-parity.7.md in sync with the registry.\n");
} else {
  if (next !== original) fs.writeFileSync(DOC, next);
  process.stdout.write(`gen-parity-doc: ${next !== original ? "updated" : "unchanged"} — ${CAPABILITY_REGISTRY.length} capabilities, ${CAPABILITY_REGISTRY.filter((c) => c.mcp).length} MCP tools.\n`);
}
