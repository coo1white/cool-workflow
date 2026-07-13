#!/usr/bin/env node
"use strict";

// Generate every vendor plugin manifest from a single source of truth.
//
//   node scripts/gen-manifests.js            # write generated manifests
//   node scripts/gen-manifests.js --check    # fail (exit 1) if any drift
//
// Mechanism vs policy (BSD discipline): the shared assets (skills/, dist/,
// apps/, the MCP server) live once; each vendor manifest is a thin, generated
// adapter. Edit manifest/plugin.manifest.json, never the generated files.
//
// v0.1.47 — VENDOR ADAPTER REGISTRY: vendor outputs are now declarative
// templates in plugin.manifest.json's `vendors` section. Adding a new AI
// platform is just data — no gen-manifests.js changes needed.
//
// Supported template markers:
//   {{path.to.field}}          — resolve a dot-path in the source object
//   {{path.to.field|lowercase}}— apply transformer (only |lowercase)
//   {{pluginRootVar}}          — resolve to the vendor's pluginRootVar
//   Bare strings without {{ }} are literal values

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(pluginRoot, "..", "..");
const SOURCE = path.join(pluginRoot, "manifest", "plugin.manifest.json");

function loadSource() {
  assert.ok(fs.existsSync(SOURCE), `source of truth missing: ${rel(SOURCE)}`);
  return JSON.parse(fs.readFileSync(SOURCE, "utf8"));
}

// ---- Template engine (BSD: mechanism — one pure resolver, policy is data) --

/** Resolve a dot-path string in the source object. Returns undefined if not found. */
function _resolvePath(obj, pathStr) {
  const parts = pathStr.split(".");
  let current = obj;
  for (const part of parts) {
    if (current === null || typeof current !== "object") return undefined;
    if (!(part in current)) return undefined;
    current = current[part];
  }
  return current;
}

/** Interpolate {{path.to.field}} or {{path.to.field|transformer}} markers.
 *  Bare strings without markers are returned as-is. */
function _interpolate(template, src, pluginRootVar) {
  if (typeof template !== "string") return template;
  // Whole-string interpolation: if the entire value is a single marker, resolve
  // to the actual JS value (object, array, string) rather than a string.
  const wholeMatch = template.match(/^\{\{([^}]+)\}\}$/);
  if (wholeMatch) {
    const expr = wholeMatch[1];
    // Check for transformer: {{path|lowercase}}
    const pipeIdx = expr.lastIndexOf("|");
    const pathStr = pipeIdx >= 0 ? expr.slice(0, pipeIdx) : expr;
    const transformer = pipeIdx >= 0 ? expr.slice(pipeIdx + 1).trim() : null;
    let value;
    if (pathStr === "pluginRootVar") {
      value = pluginRootVar;
    } else {
      value = _resolvePath(src, pathStr);
    }
    if (transformer === "lowercase" && typeof value === "string") return value.toLowerCase();
    return value !== undefined ? value : `{{${expr}}}`;
  }
  // Partial interpolation: replace {{...}} in the string
  return template.replace(/\{\{([^}]+)\}\}/g, (_match, expr) => {
    const pipeIdx = expr.lastIndexOf("|");
    const pathStr = pipeIdx >= 0 ? expr.slice(0, pipeIdx) : expr;
    const transformer = pipeIdx >= 0 ? expr.slice(pipeIdx + 1).trim() : null;
    let value;
    if (pathStr === "pluginRootVar") {
      value = pluginRootVar;
    } else {
      value = _resolvePath(src, pathStr);
    }
    if (value === undefined) return `{{${expr}}}`;
    if (transformer === "lowercase" && typeof value === "string") return value.toLowerCase();
    return String(value);
  });
}

/** Recursively resolve a template (object/array/string) against the source.
 *  Object keys containing {{...}} are resolved; bare keys pass through.
 *  Values that are arrays/objects are recursed; strings are interpolated. */
function _resolveTemplate(template, src, pluginRootVar) {
  if (template === null || template === undefined) return template;
  if (typeof template === "string") return _interpolate(template, src, pluginRootVar);
  if (Array.isArray(template)) return template.map(item => _resolveTemplate(item, src, pluginRootVar));
  if (typeof template === "object") {
    const result = {};
    for (const [key, value] of Object.entries(template)) {
      // Resolve key: {{mcp.serverName}} -> "cool-workflow"
      const resolvedKey = _interpolate(key, src, pluginRootVar);
      const keyStr = typeof resolvedKey === "string" ? resolvedKey : key;
      result[keyStr] = _resolveTemplate(value, src, pluginRootVar);
    }
    return result;
  }
  return template;
}

// ---- Build from vendor adapter registry -----------------------------------

function build(src) {
  const { targets, vendors } = src;
  validateVendorRegistry(vendors);
  const outputs = [];
  for (const [vendorId, vendorDef] of Object.entries(vendors)) {
    const targetConfig = targets && targets[vendorId] ? targets[vendorId] : {};
    const pluginRootVar = targetConfig.pluginRootVar || "./";
    const vendorOutputs = vendorDef.outputs;
    for (const output of vendorOutputs) {
      const resolved = _resolveTemplate(output, src, pluginRootVar);
      if (!isPlainObject(resolved) || typeof resolved.path !== "string" || !resolved.path.trim()) {
        throw new Error(`vendor ${vendorId} has an output without a path`);
      }
      if (!isPlainObject(resolved.json)) {
        throw new Error(`vendor ${vendorId} output ${resolved.path} has no JSON object`);
      }
      outputs.push({
        path: resolved.path,
        json: resolved.json
      });
    }
  }
  return outputs;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** The vendor table is required. A broken source must stop before the write
 *  loop; an old hard-coded shape is not a safe second source of truth. */
function validateVendorRegistry(vendors) {
  if (!isPlainObject(vendors) || Object.keys(vendors).length === 0) {
    throw new Error("manifest source needs a non-empty vendors object");
  }
  for (const [vendorId, vendorDef] of Object.entries(vendors)) {
    if (!isPlainObject(vendorDef) || !Array.isArray(vendorDef.outputs) || vendorDef.outputs.length === 0) {
      throw new Error(`vendor ${vendorId} needs a non-empty outputs array`);
    }
    for (const output of vendorDef.outputs) {
      if (!isPlainObject(output)) throw new Error(`vendor ${vendorId} has an invalid output`);
    }
  }
}

function serialize(json) {
  return `${JSON.stringify(json, null, 2)}\n`;
}

function rel(absolute) {
  return path.relative(repoRoot, absolute);
}

function main() {
  const check = process.argv.includes("--check");
  const outputs = build(loadSource());
  const results = [];
  const drift = [];

  for (const output of outputs) {
    const absolute = path.join(repoRoot, output.path);
    const next = serialize(output.json);
    if (check) {
      const current = fs.existsSync(absolute) ? fs.readFileSync(absolute, "utf8") : null;
      const ok = current === next;
      if (!ok) drift.push(output.path);
      results.push({ path: output.path, ok, status: current === null ? "missing" : ok ? "in-sync" : "drift" });
    } else {
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      fs.writeFileSync(absolute, next);
      results.push({ path: output.path, status: "written" });
    }
  }

  process.stdout.write(`${JSON.stringify({ ok: drift.length === 0, mode: check ? "check" : "write", results }, null, 2)}\n`);

  if (check && drift.length > 0) {
    process.stderr.write(
      `\n${drift.length} generated manifest(s) drifted from manifest/plugin.manifest.json:\n` +
        drift.map((p) => `  - ${p}`).join("\n") +
        `\nRun \`npm run gen:manifests\` and commit the result.\n`
    );
    process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`gen-manifests: ${message}\n`);
  process.exitCode = 1;
}
