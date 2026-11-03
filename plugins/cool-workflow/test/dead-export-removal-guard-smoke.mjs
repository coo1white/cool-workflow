#!/usr/bin/env node
// dead-export-removal-guard-smoke: the deep dogfood audit's dead-surface trace
// found 10 production exports defined but read by NO module (each verified at
// exactly its own definition, 0 external refs). They were removed. This guards
// re-growth: the dead exports must stay gone, and the LIVE exports beside them
// must stay present (so the removal was surgical, not a blanket cut).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const cases = [
  { mod: "../dist/shell/term", dead: ["cwLabel", "formatDuration"], live: ["bold", "dim", "tryHint"] },
  {
    mod: "../dist/core/state/validation",
    // tryValidateCandidateScore went with its one reader (evidence-reasoning.ts)
    // and the rest of the multi-agent family (slim-and-esm step 2).
    dead: ["tryValidateWorkerScope", "tryValidateNodeSnapshot", "tryValidateNodeReplayRun", "tryValidateCandidateRecord", "tryValidateCandidateScore"],
    live: ["validateWorkerScope", "validateNodeSnapshot"]
  },
  {
    mod: "../dist/shell/execution-backend/registry",
    dead: ["backendSelectionFrom", "clearProbeCache", "listExecutionBackends"],
    // resolveBackendSelection is KEPT — used by dispatch.ts + worker-isolation.ts.
    live: ["resolveBackendSelection", "runBackend", "attestSandbox"]
  },
  // Round 2 (found once PR 3/6/7 rewrote away the last outside mentions):
  // each of these is called only inside its own file now. (The
  // state-explosion report, multi-agent runtime and collaboration cases went
  // with those modules, slim-and-esm step 2.)
  { mod: "../dist/core/state/node-snapshot", dead: ["findRunNode"], live: ["snapshotNode"] },
  { mod: "../dist/shell/reclamation-io", dead: ["sha256OfFile"], live: ["planReclamation"] },
  { mod: "../dist/shell/sandbox-profile", dead: ["isBundledSandboxProfileId", "validateSandboxRead"], live: ["sandboxPolicyForWorker"] },
  { mod: "../dist/shell/workflow-app-loader", dead: ["listWorkflowAppRecords"], live: ["loadWorkflowApp"] }
];

for (const { mod, dead, live } of cases) {
  const m = await import(`${mod}.js`);
  for (const name of dead) {
    assert.equal(m[name], undefined, `${mod}: dead export ${name} must stay removed`);
  }
  for (const name of live) {
    assert.equal(typeof m[name], "function", `${mod}: live export ${name} must remain`);
  }
}

// Round 3 (refactor-whole-tree phase 1a, 2026-11-03): a scan of the whole
// tree, not a list. A runtime `export` under src/ that no other file names
// (src, scripts, apps, test, v2/conformance) is a door no one uses; drop
// the `export` (or the code, if nothing calls it). Kept on purpose:
// *_SCHEMA_VERSION constants, and compactCheckpoint (named in the rebuild
// SPEC, project/docs/rebuild/SPEC/state-core.md).
const pluginRoot = path.resolve(import.meta.dirname, "..");
// deferredPayloadProbeCapabilities sits in a capability-table file, where
// the onramp contract asks for a public doc change with any edit; it goes
// with the phase that next edits that table and its docs.
const KEEP = new Set(["compactCheckpoint", "deferredPayloadProbeCapabilities"]);
const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", "dist", "out", ".cache"].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(e.name)) out.push(p);
  }
  return out;
};
const files = [...walk(pluginRoot), ...walk(path.resolve(pluginRoot, "../../v2/conformance"))];
const text = new Map(files.map((f) => [f, fs.readFileSync(f, "utf8")]));
const unused = [];
for (const [file, body] of text) {
  if (!file.startsWith(path.join(pluginRoot, "src") + path.sep)) continue;
  for (const m of body.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/gm)) {
    const name = m[1];
    if (KEEP.has(name) || /_SCHEMA_VERSION$/.test(name)) continue;
    const word = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
    const named = [...text].some(([other, otherBody]) => other !== file && word.test(otherBody));
    if (!named) unused.push(`${path.relative(pluginRoot, file)}: ${name}`);
  }
}
assert.deepEqual(unused, [], `exports no other file names (drop the export):\n  ${unused.join("\n  ")}`);

process.stdout.write("dead-export-removal-guard-smoke: ok\n");
