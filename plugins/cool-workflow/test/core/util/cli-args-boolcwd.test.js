#!/usr/bin/env node
// cli-args-boolcwd — pins the one bool reader family (boolWord, flagOn,
// parseBoolFlag) and the one --cwd reader (cwdArg) to the local copies they
// took the place of (issue #787 item 4). Each old copy is kept here, as it
// was, as the oracle; every input must give the same answer (or the same
// error) through the shared helper with that caller's options.

const assert = require("node:assert/strict");
const path = require("node:path");
const { boolWord, flagOn, parseBoolFlag, cwdArg } = require("../../../dist/core/util/cli-args");

// ---- the old copies ----
const old = {
  // shell/pipeline-cli.ts truthyFlag
  truthyFlag(value) {
    if (value === true) return true;
    if (typeof value === "string") return /^(1|true|yes|on)$/i.test(value.trim());
    return false;
  },
  // shell/report-view-cli.ts mcpFlag
  mcpFlag: (value) => value === true || value === "true",
  // shell/scheduling-io.ts isTrue
  schedIsTrue: (value) => value === true || value === "true" || value === "1",
  // shell/reclamation-io.ts isTrue
  reclIsTrue: (value) => value === true || value === "true" || value === "1" || value === 1,
  // shell/agent-config.ts boolish
  boolish(value) {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const v = value.trim().toLowerCase();
      if (["1", "true", "yes", "on"].includes(v)) return true;
      if (["0", "false", "no", "off"].includes(v)) return false;
    }
    return undefined;
  },
  // core/util/cli-args.ts parseBoolFlag before it read through boolWord
  parseBoolFlag(value, label) {
    if (value === undefined || value === null) return undefined;
    if (typeof value === "boolean") return value;
    const text = String(value).trim().toLowerCase();
    if (text === "true" || text === "1" || text === "yes" || text === "on") return true;
    if (text === "false" || text === "0" || text === "no" || text === "off" || text === "") return false;
    throw new Error(`Invalid boolean value for ${label}: "${String(value)}" (use true or false)`);
  },
  // the invocationCwd / cwdFor copies (report-view, report, pipeline,
  // telemetry, commit-summary, feedback, audit, run-export, metrics, worker,
  // wiring reporting, workflow-app-loader packageWorkflowApp)
  invocationCwd: (args) => (typeof args.cwd === "string" && args.cwd.trim() ? path.resolve(args.cwd) : process.cwd()),
  // shell/pipeline-cli.ts existingRunCwd
  existingRunCwd(args) {
    if (typeof args.cwd === "string" && args.cwd.trim()) return path.resolve(args.cwd);
    if (typeof args.repo === "string" && args.repo.trim()) return path.resolve(args.repo);
    return process.cwd();
  },
  // exec-backend-cli / scheduling-io / state-cli resolveCwd (+ state-cli loadRun)
  resolveCwd: (options) => path.resolve(String(options.cwd || process.cwd())),
  // registry-cli resolveCwd
  registryResolveCwd: (options) => path.resolve(String(options.cwd || options.repo || process.cwd())),
};

function outcome(fn) {
  try {
    return { value: fn() };
  } catch (error) {
    return { error: error.message };
  }
}

// ---- bool readers ----
const boolInputs = [
  undefined, null, true, false, 0, 1, 2, NaN, "", " ", "1", "0", "true", "false", "TRUE", " True ", "False",
  "yes", "YES", "no", "on", "ON", "off", " 1 ", "2", "y", "n", "maybe", "true1", [], {}, ["true"],
];
for (const v of boolInputs) {
  const tag = JSON.stringify(v) ?? String(v);
  assert.equal(flagOn(v), old.truthyFlag(v), `flagOn() vs truthyFlag(${tag})`);
  assert.equal(flagOn(v, ["true"]), old.mcpFlag(v), `flagOn(["true"]) vs mcpFlag(${tag})`);
  assert.equal(flagOn(v, ["true", "1"]), old.schedIsTrue(v), `flagOn(["true","1"]) vs scheduling isTrue(${tag})`);
  assert.equal(flagOn(v, ["true", "1", 1]), old.reclIsTrue(v), `flagOn(["true","1",1]) vs reclamation isTrue(${tag})`);
  assert.equal(boolWord(v), old.boolish(v), `boolWord vs boolish(${tag})`);
  assert.deepEqual(outcome(() => parseBoolFlag(v, "--flag")), outcome(() => old.parseBoolFlag(v, "--flag")), `parseBoolFlag(${tag})`);
}
// The copies really did differ; the options keep each one's own set.
assert.equal(flagOn("yes"), true);
assert.equal(flagOn("yes", ["true", "1"]), false, "scheduling --failed never read yes as on");
assert.equal(flagOn("1", ["true"]), false, "report --answer never read 1 as on");
assert.equal(flagOn(1, ["true", "1"]), false);
assert.equal(flagOn(1, ["true", "1", 1]), true, "reclamation --all read the number 1 as on");
assert.equal(boolWord(""), undefined, "boolWord leaves \"\" unset");
assert.equal(parseBoolFlag("", "--x"), false, "parseBoolFlag reads \"\" as off");
assert.equal(boolWord(1), undefined);
assert.equal(parseBoolFlag(1, "--x"), true);
assert.throws(() => parseBoolFlag("maybe", "--allow-self-approval"), {
  message: 'Invalid boolean value for --allow-self-approval: "maybe" (use true or false)',
});

// ---- cwd reader ----
const cwdValues = [undefined, null, "", "   ", ".", "sub/dir", " spaced ", "/abs/path", "/abs/../x", true, false, 0, 7, ["a"]];
for (const c of cwdValues) {
  for (const r of cwdValues) {
    const args = { cwd: c, repo: r };
    const tag = `cwd=${JSON.stringify(c)} repo=${JSON.stringify(r)}`;
    assert.deepEqual(outcome(() => cwdArg(args)), outcome(() => old.invocationCwd(args)), `cwdArg vs invocationCwd ${tag}`);
    assert.deepEqual(outcome(() => cwdArg(args, ["cwd", "repo"])), outcome(() => old.existingRunCwd(args)), `cwdArg vs existingRunCwd ${tag}`);
    assert.deepEqual(outcome(() => cwdArg(args, ["cwd"], true)), outcome(() => old.resolveCwd(args)), `cwdArg vs resolveCwd ${tag}`);
    assert.deepEqual(outcome(() => cwdArg(args, ["cwd", "repo"], true)), outcome(() => old.registryResolveCwd(args)), `cwdArg vs registry resolveCwd ${tag}`);
  }
}
assert.equal(cwdArg({}), process.cwd(), "unset falls back to the process cwd");
assert.equal(cwdArg({ cwd: true }), process.cwd(), "a bare --cwd is unset for the string reader");
assert.equal(cwdArg({ cwd: true }, ["cwd"], true), path.resolve("true"), "and the folder \"true\" for the truthy reader");
assert.equal(cwdArg({ cwd: "  " }), process.cwd());
assert.equal(cwdArg({ cwd: "  " }, ["cwd"], true), path.resolve("  "));
assert.equal(cwdArg({ repo: "/r" }), process.cwd(), "--repo is read only when the caller names it");
assert.equal(cwdArg({ repo: "/r" }, ["cwd", "repo"]), "/r");
assert.equal(cwdArg({ cwd: "/c", repo: "/r" }, ["cwd", "repo"]), "/c", "--cwd wins over --repo");

process.stdout.write("cli-args-boolcwd: ok\n");
