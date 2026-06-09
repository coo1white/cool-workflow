#!/usr/bin/env node
// validate-run-state-schema.js — fail-closed build gate for ABI consistency.
//
// BSD discipline (mechanism, not policy):
//  - Extracts REQUIRED_TOP_LEVEL_KEYS from the compiled run-state-schema module.
//  - Parses the TypeScript source of WorkflowRun to extract interface keys.
//  - Cross-checks: every required (non-optional) key in the type MUST appear
//    in the schema. Every optional key in the schema MUST match the type.
//  - FAIL CLOSED on any mismatch — this gates the release.
//
// From v0.1.53: prevents silent three-point drift between WorkflowRun,
// normalizeRunState, and validateMigratedRunState.

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const PLUGIN_ROOT = path.resolve(__dirname, "..");
const TYPES_FILE = path.join(PLUGIN_ROOT, "src", "types", "run.ts");
const SCHEMA_MODULE = path.join(PLUGIN_ROOT, "dist", "run-state-schema.js");

function main() {
  const errors = [];

  // ---- 1. Extract WorkflowRun keys from the TypeScript interface source ----
  const typeSource = fs.readFileSync(TYPES_FILE, "utf8");
  const runKeys = extractInterfaceKeys(typeSource, "WorkflowRun");
  if (runKeys.size === 0) {
    console.error("validate-run-state-schema: FATAL — could not extract WorkflowRun keys from types/run.ts");
    process.exit(1);
  }

  // ---- 2. Load the schema module (compiled dist) --------------------------
  let schema;
  try {
    schema = require(SCHEMA_MODULE);
  } catch (e) {
    console.error(`validate-run-state-schema: FATAL — cannot load ${SCHEMA_MODULE}. Run 'npm run build' first.`);
    process.exit(1);
  }

  const requiredKeys = new Set(schema.REQUIRED_TOP_LEVEL_KEYS || []);
  const optionalKeys = new Set(schema.OPTIONAL_TOP_LEVEL_KEYS || []);

  // ---- 3. Cross-check: every type key must be either required or optional ----
  for (const key of runKeys) {
    if (requiredKeys.has(key)) continue;
    if (optionalKeys.has(key)) continue;
    errors.push(
      `Drift: WorkflowRun key "${key}" is NOT in REQUIRED_TOP_LEVEL_KEYS or OPTIONAL_TOP_LEVEL_KEYS in run-state-schema.ts. ` +
      `Add it to the appropriate list.`
    );
  }

  // ---- 4. Reverse check: every declared key must exist in the type ---------
  for (const key of requiredKeys) {
    if (!runKeys.has(key)) {
      errors.push(`Drift: REQUIRED_TOP_LEVEL_KEYS contains "${key}" but it is not in WorkflowRun.`);
    }
  }
  for (const key of optionalKeys) {
    if (!runKeys.has(key)) {
      errors.push(`Drift: OPTIONAL_TOP_LEVEL_KEYS contains "${key}" but it is not in WorkflowRun.`);
    }
  }

  // ---- Report ------------------------------------------------------------
  if (errors.length) {
    console.error("validate-run-state-schema: FAIL CLOSED — schema drift detected.");
    for (const e of errors) console.error(`  ${e}`);
    console.error(
      `\nFix: update REQUIRED_TOP_LEVEL_KEYS and/or OPTIONAL_TOP_LEVEL_KEYS in ` +
      `src/run-state-schema.ts, then update normalizeRunState() and validateMigratedRunState() ` +
      `in src/state-migrations.ts to handle any new required fields.`
    );
    process.exit(1);
  }

  const total = requiredKeys.size + optionalKeys.size;
  console.error(
    `validate-run-state-schema: ok — ${runKeys.size} WorkflowRun keys accounted for ` +
    `(${requiredKeys.size} required + ${optionalKeys.size} optional = ${total})`
  );
}

/**
 * Extract top-level keys from a TypeScript interface definition.
 * Uses brace-depth tracking to skip keys inside nested object types.
 */
function extractInterfaceKeys(source, interfaceName) {
  const startIdx = source.indexOf(`export interface ${interfaceName} {`);
  if (startIdx < 0) return new Set();

  const braceStart = source.indexOf("{", startIdx);
  let depth = 0;
  let endIdx = -1;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}") depth--;
    if (depth === 0) { endIdx = i; break; }
  }
  if (endIdx < 0) return new Set();

  const body = source.slice(braceStart + 1, endIdx);
  const keys = new Set();
  let braceDepth = 0;

  for (const line of body.split("\n")) {
    const m = line.match(/^\s*(\w+)\??\s*:/);
    if (m) {
      // Key is top-level only when current brace depth is 0
      if (braceDepth === 0) keys.add(m[1]);
    }
    // Update brace depth from this line's braces
    for (const ch of line) {
      if (ch === "{") braceDepth++;
      if (ch === "}") braceDepth--;
    }
    if (braceDepth < 0) braceDepth = 0;
  }

  return keys;
}

main();
