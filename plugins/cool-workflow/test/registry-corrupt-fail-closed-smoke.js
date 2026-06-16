#!/usr/bin/env node
"use strict";

// registry-corrupt-fail-closed-smoke (over-defensive audit): the home-registry
// and scheduler "plain file" stores are AUTHORITATIVE durable state (state.ts
// names them so in the durable-write comment). Their loaders used to wrap the
// parse in `try { ... } catch { return <empty/default> }`, which CONFLATED two
// very different situations:
//
//   - ABSENT  (file not there yet)      => empty/default is correct.
//   - CORRUPT (present but unparseable) => empty/default is a SILENT FALLBACK,
//     the exact "false-green" §4 forbids and that telemetry-ledger.ts documents
//     ("conflating the two was the bug that let a corrupt overlay verify green").
//
// Swallowing corruption silently un-archived every archived run, dropped every
// provenance link, emptied the run queue, and substituted a scheduling policy
// the operator never chose. This guard pins each store: ABSENT still loads its
// clean default, but CORRUPT now FAILS CLOSED with readJson's `Invalid JSON`.
//
// Included in `npm test`.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const { RunRegistry } = require(path.join(pluginRoot, "dist", "run-registry.js"));
const { schedPolicyShow } = require(path.join(pluginRoot, "dist", "capability-core.js"));

const CORRUPT = "{ this is not valid json ]";

// Each case gets a pristine home + repo so a corrupt store from one case can
// never leak into another. The repo always has an (empty) `.cw/runs` dir so the
// overlay loaders are actually reached during a scan.
function freshEnv() {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-corrupt-home-")));
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-corrupt-repo-")));
  fs.mkdirSync(path.join(repo, ".cw", "runs"), { recursive: true });
  fs.mkdirSync(path.join(repo, ".cw", "registry"), { recursive: true });
  fs.mkdirSync(path.join(home, "registry"), { recursive: true });
  const env = { ...process.env, CW_HOME: home };
  return { home, repo, env, reg: new RunRegistry(repo, undefined, env) };
}
const repoRegistry = (repo, name) => path.join(repo, ".cw", "registry", name);
const homeRegistry = (home, name) => path.join(home, "registry", name);

// ---- 0. ABSENT baseline: every store loads its clean default, no throw -------
(function absentLoadsCleanDefault() {
  const { reg } = freshEnv();
  const index = reg.buildIndex("repo");
  assert.deepEqual(index.records, [], "absent stores => no records");
  assert.deepEqual(index.queue, [], "absent queue => empty queue");
  assert.deepEqual(reg.search({ scope: "home" }).records, [], "absent repos.json => home scan is empty, not a throw");
  assert.equal(schedPolicyShow(reg).source, "default", "absent scheduling-policy.json => default policy");
})();

// ---- 1. CORRUPT archive overlay => fail closed -------------------------------
(function corruptArchiveFailsClosed() {
  const { repo, reg } = freshEnv();
  fs.writeFileSync(repoRegistry(repo, "archive.json"), CORRUPT);
  assert.throws(() => reg.buildIndex("repo"), /Invalid JSON/, "corrupt archive.json must surface, not silently un-archive runs");
})();

// ---- 2. CORRUPT provenance overlay => fail closed ----------------------------
(function corruptProvenanceFailsClosed() {
  const { repo, reg } = freshEnv();
  fs.writeFileSync(repoRegistry(repo, "provenance.json"), CORRUPT);
  assert.throws(() => reg.buildIndex("repo"), /Invalid JSON/, "corrupt provenance.json must surface, not silently drop links");
})();

// ---- 3. CORRUPT queue store => fail closed -----------------------------------
(function corruptQueueFailsClosed() {
  const { home, reg } = freshEnv();
  fs.writeFileSync(homeRegistry(home, "queue.json"), CORRUPT);
  assert.throws(() => reg.loadQueueEntries(), /Invalid JSON/, "corrupt queue.json must surface, not silently drain to empty");
  assert.throws(() => reg.buildIndex("repo"), /Invalid JSON/, "index build also refuses a corrupt queue store");
})();

// ---- 4. CORRUPT repos registry => fail closed --------------------------------
(function corruptReposFailsClosed() {
  const { home, reg } = freshEnv();
  fs.writeFileSync(homeRegistry(home, "repos.json"), CORRUPT);
  assert.throws(() => reg.search({ scope: "home" }), /Invalid JSON/, "corrupt repos.json must surface, not silently shrink the home index");
})();

// ---- 5. CORRUPT scheduling policy => fail closed -----------------------------
(function corruptSchedulingPolicyFailsClosed() {
  const { home, reg } = freshEnv();
  fs.writeFileSync(homeRegistry(home, "scheduling-policy.json"), CORRUPT);
  assert.throws(() => schedPolicyShow(reg), /Invalid JSON/, "corrupt scheduling-policy.json must surface, not silently fall back to defaults");
})();

process.stdout.write("registry-corrupt-fail-closed-smoke: ok (absent loads clean default; corrupt archive/provenance/queue/repos/scheduling-policy all fail closed)\n");
