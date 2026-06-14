#!/usr/bin/env node
"use strict";

// cli-jsonmode-parity-smoke: pins cli.ts's hand-written --json behavior TO the
// capability registry's declared `cli.jsonMode`, without touching cli.ts.
//
// THE DOUBLE-SOURCE PROBLEM
//   capability-registry.ts declares, per command, a `cli.jsonMode`:
//     "default" — the command ALWAYS prints the canonical JSON payload (no flag
//                 needed; `--json` is a no-op).
//     "flag"    — human text by default; canonical JSON only under `--json`.
//     "human"   — human-only; no canonical JSON on this surface.
//   cli.ts is a hand-written switch on args.command that re-encodes that same
//   policy by hand per case. So the fact lives in TWO places and can silently
//   drift (e.g. a flag verb made always-JSON, or a default verb gated behind
//   --json). scripts/parity-check.js:153 is the ONLY current reader of jsonMode
//   (it appends --json only for "flag" verbs) and it only ever JSON.parse-es the
//   JSON rendering — it never asserts the HUMAN rendering, nor the no-flag JSON
//   of "default" verbs.
//
// WHAT THIS SMOKE PROVES (the registry is the single source; cli.ts obeys it)
//   For each probed read-only capability, drive the assertion from the registry's
//   declared cli.jsonMode and check cli.ts's ACTUAL output matches it:
//     jsonMode === "flag"    : `cw <cmd>` (no --json) and `cw <cmd> --json` MUST
//                              differ, AND the --json output MUST be valid JSON.
//     jsonMode === "default" : output MUST be valid JSON BOTH with and without
//                              --json (always-JSON; --json is a no-op).
//     jsonMode === "human"   : skipped (no canonical JSON on this surface).
//   If cli.ts ever drifts from the registry declaration for a probed verb, this
//   trips. It is the companion consumer to parity-check.js for the human-side and
//   default-verb gap that the payload probe never exercises.
//
// Read-only by construction: it plans one architecture-review run in a private
// tmpdir and probes only inspection verbs (no mutate). Discovered automatically
// by test/run-all.js (test/*-smoke.js) — no wiring to forget.

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const node = process.execPath;
const cli = path.join(pluginRoot, "dist", "cli.js");
const registry = require(path.join(pluginRoot, "dist", "capability-registry.js"));

// Read-only capabilities that are safe to invoke on a freshly planned run with
// just a runId (RUN_PROBES) or with no run context at all (GLOBAL_PROBES). This
// is the same safe inspection set scripts/parity-check.js probes, chosen so a
// single planned run exercises both jsonMode branches across both surfaces. We do
// NOT enumerate every registry verb: most are mutating (commit/dispatch/result/
// register/...) or need bespoke args, and running them here would not be
// behavior-preserving. The jsonMode for each is read FROM the registry, not
// hard-coded, so this test pins cli.ts to the registry data.
const GLOBAL_PROBES = [
  "list",
  "app.list",
  "topology.list",
  "sandbox.list",
  "backend.list",
  "backend.agent.config.show",
  "metrics.summary"
];
const RUN_PROBES = [
  "status",
  "operator.status",
  "operator.report",
  "graph",
  "report",
  "next",
  "state.check",
  "contract.show",
  "node.list",
  "node.graph",
  "worker.summary",
  "candidate.summary",
  "feedback.summary",
  "commit.summary",
  "audit.summary",
  "multi-agent.summary",
  "workbench.view",
  "metrics.show",
  "review.status",
  "comment.list",
  "gc.plan",
  "gc.verify"
];

function capById(id) {
  const cap = registry.CAPABILITY_REGISTRY.find((entry) => entry.capability === id);
  assert.ok(cap, `probe references unknown capability ${id}`);
  assert.ok(cap.cli, `probe capability ${id} must declare a cli binding`);
  return cap;
}

function isJson(text) {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

function run(argv, cwd) {
  return execFileSync(node, [cli, ...argv], { cwd, encoding: "utf8" });
}

// Assert cli.ts's observed --json behavior for one capability matches the
// jsonMode the registry declares for it.
function assertJsonModeContract(cap, baseArgv, cwd) {
  const mode = cap.cli.jsonMode;
  if (mode === "human") return; // no canonical JSON on this surface; skip.
  if (mode === "flag") {
    const human = run(baseArgv, cwd);
    const json = run([...baseArgv, "--json"], cwd);
    assert.notEqual(
      human,
      json,
      `${cap.capability}: jsonMode "flag" — \`cw ${baseArgv.join(" ")}\` (human) must differ from --json`
    );
    assert.ok(
      isJson(json),
      `${cap.capability}: jsonMode "flag" — \`cw ${baseArgv.join(" ")} --json\` must emit valid JSON`
    );
    return;
  }
  // "default": always-JSON; --json is a no-op, so BOTH renderings are valid JSON.
  const plain = run(baseArgv, cwd);
  const json = run([...baseArgv, "--json"], cwd);
  assert.ok(
    isJson(plain),
    `${cap.capability}: jsonMode "default" — \`cw ${baseArgv.join(" ")}\` must emit valid JSON without --json`
  );
  assert.ok(
    isJson(json),
    `${cap.capability}: jsonMode "default" — \`cw ${baseArgv.join(" ")} --json\` must emit valid JSON`
  );
}

(() => {
  // Every probe must be a both-surface, registry-declared capability with a known
  // jsonMode — fail closed if a probe drifts off the registry.
  const probed = [...GLOBAL_PROBES, ...RUN_PROBES];
  for (const id of probed) {
    const cap = capById(id);
    assert.ok(
      cap.cli.jsonMode === "default" || cap.cli.jsonMode === "flag" || cap.cli.jsonMode === "human",
      `${id}: registry declares an unknown cli.jsonMode ${cap.cli.jsonMode}`
    );
  }

  const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-jsonmode-smoke-")));
  const plan = JSON.parse(
    run(["plan", "architecture-review", "--repo", workspace, "--question", "cli jsonMode parity smoke"], workspace)
  );
  const runId = plan.runId;
  assert.ok(runId, "plan must return a runId to probe run-scoped verbs");

  let flagChecked = 0;
  let defaultChecked = 0;
  for (const id of GLOBAL_PROBES) {
    const cap = capById(id);
    assertJsonModeContract(cap, cap.cli.path, workspace);
    if (cap.cli.jsonMode === "flag") flagChecked++;
    else if (cap.cli.jsonMode === "default") defaultChecked++;
  }
  for (const id of RUN_PROBES) {
    const cap = capById(id);
    assertJsonModeContract(cap, [...cap.cli.path, runId], workspace);
    if (cap.cli.jsonMode === "flag") flagChecked++;
    else if (cap.cli.jsonMode === "default") defaultChecked++;
  }

  // Guard against the probe set silently collapsing to one branch (which would
  // make this gate vacuous for the other).
  assert.ok(flagChecked > 0, "expected at least one jsonMode \"flag\" verb in the probe set");
  assert.ok(defaultChecked > 0, "expected at least one jsonMode \"default\" verb in the probe set");

  process.stdout.write(
    `cli-jsonmode-parity-smoke: ok (${probed.length} verbs pinned to registry jsonMode — ${flagChecked} flag, ${defaultChecked} default)\n`
  );
})();
