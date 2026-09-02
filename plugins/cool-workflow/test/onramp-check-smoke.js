#!/usr/bin/env node
"use strict";

// onramp-check-smoke — the change-contract gate must make the development path
// explicit: behavior changes need smoke coverage, surface changes need docs.
//
// This smoke require()s dist/shell/onramp.js (exports evaluateOnrampContract +
// recommendSmokeTests) and drives `cw doctor --onramp --json`. The onramp
// change-contract subsystem was restored in v2 (shell/onramp.ts's own header:
// "this restores it and shell/doctor.ts wires --onramp back to it") — this
// note used to say the module was missing and the smoke could only go green
// once v2 grew it back; that milestone shipped and the note was never
// updated. It is wired live: `buildDoctorOnramp` is imported and called from
// shell/doctor.ts, and `cw doctor --onramp --json` returns a real `onramp`
// key today.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const pluginRoot = path.resolve(__dirname, "..");
const cli = path.join(pluginRoot, "dist", "cli.js");
const {
  evaluateOnrampContract,
  recommendSmokeTests,
  isCommentOnlyPatch,
  isDeleteOnlyPatch,
  CURATED_SMOKE_MAP
} = require(path.join(pluginRoot, "dist", "shell", "onramp.js"));

function codes(report) {
  return report.issues.map((issue) => issue.code).sort();
}

function contract(files) {
  return evaluateOnrampContract(files, { cwd: pluginRoot });
}

// Runtime behavior without a smoke fails closed.
{
  const report = contract([
    "plugins/cool-workflow/src/doctor.ts"
  ]);
  assert.equal(report.ok, false);
  assert.ok(codes(report).includes("runtime-smoke-required"));
}

// Runtime behavior proven by a WP1.1-style unit test (test/*.test.js,
// no test/*-smoke.js touched) satisfies the same gate — the two test
// layers are equally valid proof of a cycle.
{
  const report = contract([
    "plugins/cool-workflow/src/core/util/collate.ts",
    "plugins/cool-workflow/test/collate-stablecompare.test.js"
  ]);
  assert.ok(!codes(report).includes("runtime-smoke-required"), codes(report).join(", "));
}

// Runtime behavior proven by a new/changed black-box conformance case
// (v2/conformance/cases/*.case.js, no test/*-smoke.js or test/*.test.js
// touched) also satisfies the same gate — a third equally valid proof
// layer.
{
  const report = contract([
    "plugins/cool-workflow/src/shell/drive.ts",
    "v2/conformance/cases/locale-independent-ordering.case.js"
  ]);
  assert.ok(!codes(report).includes("runtime-smoke-required"), codes(report).join(", "));
}

// Type-only source changes are invalid even if a smoke exists. Must use
// src/core/types/ -- src/types/ is no longer excluded by isRuntimeSource.
{
  const report = contract([
    "plugins/cool-workflow/src/core/types/boundary.ts",
    "plugins/cool-workflow/test/onramp-check-smoke.js"
  ]);
  assert.equal(report.ok, false);
  assert.ok(codes(report).includes("types-without-runtime"));
}

// Not every file named types.ts is the live tree: src/core/state/types.ts
// holds a real export (APP_CODE_EXECUTION_MODE), so it is not type-only.
{
  const report = contract([
    "plugins/cool-workflow/src/core/state/types.ts",
    "plugins/cool-workflow/test/onramp-check-smoke.js"
  ]);
  assert.equal(report.ok, true, codes(report).join(", "));
  assert.ok(!codes(report).includes("types-without-runtime"));
}

// Surface changes need public docs.
{
  const report = contract([
    "plugins/cool-workflow/src/wiring/capability-table/basics.ts",
    "plugins/cool-workflow/test/cli-mcp-parity-smoke.js"
  ]);
  assert.equal(report.ok, false);
  assert.ok(codes(report).includes("surface-docs-required"));
}

// Every real, current capability/MCP surface location must be recognized --
// not just the one exercised above. The pre-rebuild-era literals
// (capability-registry.ts, mcp-surface.ts, orchestrator.ts) no longer exist
// anywhere in the tree, so relying on them silently loses "surface-docs-
// required" coverage for exactly the files real capability/MCP changes
// touch today (self-audit-cool-workflow-v0.2.6.md P2).
{
  const report = contract([
    "plugins/cool-workflow/src/core/capability-table.ts",
    "plugins/cool-workflow/test/cli-mcp-parity-smoke.js"
  ]);
  assert.equal(report.ok, false, "core/capability-table.ts");
  assert.ok(codes(report).includes("surface-docs-required"), codes(report).join(", "));
}
{
  const report = contract([
    "plugins/cool-workflow/src/core/capability-data.ts",
    "plugins/cool-workflow/test/cli-mcp-parity-smoke.js"
  ]);
  assert.equal(report.ok, false, "core/capability-data.ts");
  assert.ok(codes(report).includes("surface-docs-required"), codes(report).join(", "));
}
{
  const report = contract([
    "plugins/cool-workflow/src/mcp/dispatch.ts",
    "plugins/cool-workflow/test/cli-mcp-parity-smoke.js"
  ]);
  assert.equal(report.ok, false, "mcp/dispatch.ts");
  assert.ok(codes(report).includes("surface-docs-required"), codes(report).join(", "));
}
{
  const report = contract([
    "plugins/cool-workflow/src/shell/orchestrator.ts",
    "plugins/cool-workflow/test/cli-mcp-parity-smoke.js"
  ]);
  assert.equal(report.ok, false, "shell/orchestrator.ts");
  assert.ok(codes(report).includes("surface-docs-required"), codes(report).join(", "));
}

// The intended onramp-risk batch shape passes: runtime + script + smoke + docs.
{
  const report = contract([
    "plugins/cool-workflow/src/doctor.ts",
    "plugins/cool-workflow/src/onramp.ts",
    "plugins/cool-workflow/src/shell/orchestrator.ts",
    "plugins/cool-workflow/scripts/onramp-check.js",
    "plugins/cool-workflow/test/doctor-smoke.js",
    "plugins/cool-workflow/test/onramp-check-smoke.js",
    "plugins/cool-workflow/docs/getting-started.md",
    "plugins/cool-workflow/README.md",
    "README.md"
  ]);
  assert.equal(report.ok, true, codes(report).join(", "));
}

// Recommendation map covers both local feature work and surface drift work.
{
  const smokes = recommendSmokeTests([
    "plugins/cool-workflow/src/doctor.ts",
    "plugins/cool-workflow/src/core/capability-table.ts"
  ], pluginRoot);
  assert.ok(smokes.includes("doctor-smoke.js"), "doctor smoke is recommended");
  assert.ok(smokes.includes("cli-mcp-parity-smoke.js"), "CLI/MCP parity smoke is recommended");
  const report = contract([
    "plugins/cool-workflow/src/core/capability-table.ts",
    "plugins/cool-workflow/test/cli-mcp-parity-smoke.js",
    "plugins/cool-workflow/docs/cli-mcp-parity.7.md"
  ]);
  assert.ok(report.recommendedCommands.some((command) => command.includes("npm run test:fast")));
  assert.ok(report.recommendedCommands.some((command) => command.includes("npm run parity:check")));
  assert.ok(report.recommendedCommands.some((command) => command.includes("npm run release:check")));
}

// Curated hits should not be widened by filename-token fallback matches.
{
  const smokes = recommendSmokeTests([
    "plugins/cool-workflow/src/shell/onramp.ts",
    "plugins/cool-workflow/src/shell/orchestrator.ts"
  ], pluginRoot);
  assert.ok(smokes.includes("doctor-smoke.js"), "onramp work keeps the doctor smoke");
  assert.ok(smokes.includes("onramp-check-smoke.js"), "onramp work keeps the contract smoke");
  assert.ok(smokes.includes("cli-mcp-parity-smoke.js"), "help/surface work keeps the parity smoke");
  assert.ok(!smokes.includes("parallel-onramp-smoke.js"), "DSL parallel smoke is not recommended for onramp gate work");
  assert.ok(!smokes.includes("cli-command-surface-smoke.js"), "CLI entrypoint architecture smoke is not recommended for help text");
  assert.ok(!smokes.includes("cli-jsonmode-parity-smoke.js"), "JSON-mode smoke is not recommended for help text");
}

// Every CURATED_SMOKE_MAP pattern must name a real file (or a real file's
// prefix), and every smoke it names must exist under test/ (#598, one layer up).
{
  const skip = new Set(["node_modules", "dist", ".git"]);
  const files = [];
  (function walk(dir) {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(item.name)) continue;
      const full = path.join(dir, item.name);
      if (item.isDirectory()) walk(full);
      else files.push(path.relative(pluginRoot, full).replace(/\\/g, "/"));
    }
  })(pluginRoot);
  for (const { patterns, smokes } of CURATED_SMOKE_MAP) {
    for (const p of patterns) assert.ok(files.some((f) => f === p || f.startsWith(p)), `dead onramp pattern: ${p}`);
    for (const s of smokes) assert.ok(fs.existsSync(path.join(pluginRoot, "test", s)), `missing onramp smoke: ${s}`);
  }
}

// The CLI exposes the changed-file recommendation structure under doctor --onramp.
{
  const stdout = execFileSync(process.execPath, [cli, "doctor", "--onramp", "--changed-from", "HEAD", "--json"], {
    cwd: pluginRoot,
    encoding: "utf8"
  });
  const report = JSON.parse(stdout);
  assert.equal(report.onramp.changedFiles.baseRef, "HEAD");
  assert.ok(Array.isArray(report.onramp.changedFiles.files));
  assert.ok(Array.isArray(report.onramp.recommendedChecks.commands));
  assert.ok(report.onramp.recommendedChecks.commands.some((command) => command.includes("npm run test:fast")));
  assert.equal(typeof report.onramp.contract.ok, "boolean");
}

// A git error mid-way through resolveChangedFiles must fail closed, not read
// as "zero changed files". `HEAD` resolves fine (git rev-parse does not touch
// the index), but `git diff --name-only HEAD --` needs the index, so pointing
// GIT_INDEX_FILE at a broken file makes ref resolution pass and the diff step
// fail on its own -- this is the exact path that used to turn a real git
// error into a false "ok:true" (2026-07-12 security audit finding). Before
// the fix, onramp-check.js printed changedFiles: [] and ok:true here and
// exited 0; after the fix it must exit non-zero with a clear message.
{
  const badIndex = path.join(os.tmpdir(), `onramp-check-smoke-bad-index-${process.pid}`);
  fs.writeFileSync(badIndex, "not a real git index\n");
  let threw = false;
  let combinedOutput = "";
  try {
    execFileSync(process.execPath, [
      path.join(pluginRoot, "scripts", "onramp-check.js"),
      "--changed-from",
      "HEAD",
      "--check"
    ], {
      cwd: pluginRoot,
      encoding: "utf8",
      env: { ...process.env, GIT_INDEX_FILE: badIndex },
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (error) {
    threw = true;
    combinedOutput = `${error.stdout || ""}${error.stderr || ""}`;
  } finally {
    fs.rmSync(badIndex, { force: true });
  }
  assert.ok(threw, "onramp-check must fail closed (non-zero exit) when a git command it needs cannot run, not report ok:true on an empty change set");
  assert.ok(
    /cannot resolve changed files/.test(combinedOutput),
    `error should explain the git command failed, got: ${combinedOutput}`
  );
}

// commentOnly: a src/shell/*.ts change with no test change fails
// runtime-smoke-required; the SAME file listed as commentOnly passes.
{
  const files = ["plugins/cool-workflow/src/shell/onramp.ts"];
  const withoutCommentOnly = contract(files);
  assert.ok(codes(withoutCommentOnly).includes("runtime-smoke-required"), "no commentOnly: must fail closed");
  const withCommentOnly = evaluateOnrampContract(files, { cwd: pluginRoot, commentOnly: files });
  assert.ok(!codes(withCommentOnly).includes("runtime-smoke-required"), codes(withCommentOnly).join(", "));
}

// commentOnly: a surface file with no doc change passes when it is
// listed as commentOnly (it never really changed the surface).
{
  const files = ["plugins/cool-workflow/src/cli.ts"];
  const report = evaluateOnrampContract(files, { cwd: pluginRoot, commentOnly: files });
  assert.equal(report.ok, true, codes(report).join(", "));
}

// isCommentOnlyPatch: the pure line test, fed patch text directly.
{
  assert.equal(isCommentOnlyPatch("+// a\n-// b\n"), true, "// lines only is comment-only");
  assert.equal(isCommentOnlyPatch("+const x = 1;\n"), false, "one code line is not comment-only");
  assert.equal(isCommentOnlyPatch('+  "http://x"\n'), false, "// inside a string is code, not a comment");
  assert.equal(isCommentOnlyPatch("+/* start\n+ * mid\n+ */\n"), true, "/* ... */ block edit is comment-only");
  assert.equal(isCommentOnlyPatch("-doSomething();\n"), false, "removing a code line is not comment-only");
}

// deleteOnly: a type source (a file under src/ named types.ts) alone fails
// runtime-smoke-required; the same file listed as deleteOnly passes -- a
// pure delete of a declared field nothing reads has no new behavior to
// prove.
{
  const files = ["plugins/cool-workflow/src/core/state/types.ts"];
  const withoutDeleteOnly = contract(files);
  assert.ok(codes(withoutDeleteOnly).includes("runtime-smoke-required"), "no deleteOnly: must fail closed");
  const withDeleteOnly = evaluateOnrampContract(files, { cwd: pluginRoot, deleteOnly: files });
  assert.equal(withDeleteOnly.ok, true, codes(withDeleteOnly).join(", "));
}

// deleteOnly: a src/types/ file alone in deleteOnly also passes (no
// types-without-runtime either).
{
  const files = ["plugins/cool-workflow/src/types/run.ts"];
  const report = evaluateOnrampContract(files, { cwd: pluginRoot, deleteOnly: files });
  assert.equal(report.ok, true, codes(report).join(", "));
}

// deleteOnly: a src/core/types/ file alone in deleteOnly also passes -- that
// is the real type directory in this repo, not src/types/.
{
  const files = ["plugins/cool-workflow/src/core/types/boundary.ts"];
  const report = evaluateOnrampContract(files, { cwd: pluginRoot, deleteOnly: files });
  assert.equal(report.ok, true, codes(report).join(", "));
}

// deleteOnly only excuses a type source, not any delete: a non-type-source
// file (src/shell/drive.ts) in deleteOnly, with no test, still fails
// runtime-smoke-required.
{
  const files = ["plugins/cool-workflow/src/shell/drive.ts"];
  const report = evaluateOnrampContract(files, { cwd: pluginRoot, deleteOnly: files });
  assert.ok(codes(report).includes("runtime-smoke-required"), codes(report).join(", "));
}

// isDeleteOnlyPatch: the pure line test, fed patch text directly.
{
  assert.equal(isDeleteOnlyPatch("-doSomething();\n"), true, "removing a code line only is delete-only");
  assert.equal(isDeleteOnlyPatch("-doSomething();\n+const x = 1;\n"), false, "one added code line is not delete-only");
  assert.equal(isDeleteOnlyPatch("-doSomething();\n+// note\n"), true, "an added comment line keeps it delete-only");
  assert.equal(isDeleteOnlyPatch("-// old note\n"), false, "removing a comment only is not delete-only");
  assert.equal(isDeleteOnlyPatch(""), false, "an empty patch is not delete-only");
}

process.stdout.write("onramp-check-smoke: ok\n");
