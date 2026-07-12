#!/usr/bin/env node
"use strict";

// release-oneclick-resume-repush-smoke — pins two resume-path fixes in
// scripts/release-oneclick.js (the operator's `npm run release -- X.Y.Z`):
//
//   Finding #1 (P1): a cut can leave the vX.Y.Z tag LOCAL-ONLY — `git tag`
//     succeeds, then the tag push dies (a network drop, an auth expiry).
//     alreadyCut() sees the local tag and resumes at stage 3, but stage 3
//     only waits for a release-gate run that CI never started, because the
//     tag never reached origin. A resume must RE-PUSH a local-only tag before
//     it starts the CI wait.
//
//   Finding #14 (P2): the npm-publish wait filtered runs by
//     `Date.now()` captured at resume time. On a resume minutes/days after the
//     gate finished, that cutoff sits in the future relative to the already-
//     completed npm-publish run, so the wait drops a publish that is already
//     done and hangs. The cutoff must come from the gate run's OWN completion
//     time, not resume-time now.
//
// Both are exercised against the REAL release-oneclick.js (it always resolves
// its repoRoot from __dirname, so it cannot be pointed at a fixture) with the
// git + gh binaries swapped for tiny node stubs via the script's existing
// CW_ONECLICK_GIT_CMD / CW_ONECLICK_GH_CMD seams. No real git/gh/npm/network is
// touched. Each case reaches a deterministic die() so no poll spins for real.
//
// Included in `npm test`.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const pluginRoot = path.resolve(__dirname, "..");
const ONECLICK = path.join(pluginRoot, "scripts", "release-oneclick.js");
assert.ok(fs.existsSync(ONECLICK), "release-oneclick.js must exist");

const VERSION = "99.99.99"; // no such tag/CHANGELOG section in the real repo

let caseId = 0;
function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), `cw-oneclick-resume-${caseId++}-`));
}

// A stub `git`: records every argv line to GIT_STUB_REC and answers just the
// handful of commands the resume path issues. The tag exists LOCALLY (tag -l),
// and whether it is on origin is toggled by GIT_STUB_REMOTE_HAS_TAG. A verdict
// `git show` returns non-zero so the (informational) main-record PR is skipped
// and the run goes straight to the CI wait.
function writeGitStub(dir) {
  const stub = path.join(dir, "git-stub.js");
  fs.writeFileSync(stub, `#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const a = process.argv.slice(2);
if (process.env.GIT_STUB_REC) fs.appendFileSync(process.env.GIT_STUB_REC, a.join(" ") + "\\n");
if (a[0] === "tag" && a[1] === "-l") { process.stdout.write("v${VERSION}\\n"); process.exit(0); }
if (a[0] === "ls-remote") {
  if (process.env.GIT_STUB_REMOTE_HAS_TAG === "1") process.stdout.write("deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\\trefs/tags/v${VERSION}\\n");
  process.exit(0);
}
if (a[0] === "push") { process.exit(0); }
if (a[0] === "rev-parse") { process.stdout.write("deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\\n"); process.exit(0); }
if (a[0] === "show") { process.stderr.write("fatal: path does not exist\\n"); process.exit(1); }
process.exit(0);
`);
  fs.chmodSync(stub, 0o755);
  return stub;
}

// A stub `gh`. GH_STUB_SCENARIO picks the release-gate reply:
//   gate-fail  -> the gate run is completed+failure (fast die at the gate wait)
//   npm-cutoff -> the gate run is completed+success with a PAST completion time,
//                 and the npm-publish run is completed+failure created just
//                 after that (also in the past). Under the fix the cutoff is the
//                 gate's own past completion, so the npm run is in-window and the
//                 wait dies with "npm-publish FAILED"; under the bug the cutoff
//                 is resume-time now, so the npm run is dropped and the wait hangs.
function writeGhStub(dir) {
  const stub = path.join(dir, "gh-stub.js");
  fs.writeFileSync(stub, `#!/usr/bin/env node
"use strict";
const a = process.argv.slice(2);
const wi = a.indexOf("--workflow");
const wf = wi >= 0 ? a[wi + 1] : "";
const scenario = process.env.GH_STUB_SCENARIO || "gate-fail";
if (a[0] === "run" && a[1] === "list" && wf === "release-gate") {
  const conclusion = scenario === "npm-cutoff" ? "success" : "failure";
  process.stdout.write(JSON.stringify([{ databaseId: 111, headBranch: "v${VERSION}", status: "completed", conclusion, createdAt: "2020-01-01T00:00:00Z", updatedAt: "2020-01-01T00:00:00Z" }]) + "\\n");
  process.exit(0);
}
if (a[0] === "run" && a[1] === "list" && wf === "npm-publish") {
  process.stdout.write(JSON.stringify([{ databaseId: 222, status: "completed", conclusion: "failure", createdAt: "2020-01-01T00:00:30Z" }]) + "\\n");
  process.exit(0);
}
process.exit(0);
`);
  fs.chmodSync(stub, 0o755);
  return stub;
}

function run(dir, env, timeoutMs) {
  const gitStub = writeGitStub(dir);
  const ghStub = writeGhStub(dir);
  const rec = path.join(dir, "git-rec.txt");
  const r = spawnSync(process.execPath, [ONECLICK, VERSION], {
    cwd: pluginRoot,
    encoding: "utf8",
    timeout: timeoutMs,
    env: {
      ...process.env,
      CW_ONECLICK_GIT_CMD: gitStub,
      CW_ONECLICK_GH_CMD: ghStub,
      GIT_STUB_REC: rec,
      ...env
    }
  });
  return { code: r.status, out: r.stdout || "", err: r.stderr || "", signal: r.signal, rec: fs.existsSync(rec) ? fs.readFileSync(rec, "utf8") : "" };
}

// ---- Finding #1a: a LOCAL-ONLY tag is re-pushed on resume -------------------
{
  const dir = tmp();
  const r = run(dir, { GH_STUB_SCENARIO: "gate-fail" }, 20000);
  // Reached the resume + CI wait (both fixed and unfixed die at the failing gate).
  assert.match(r.out, /already exists — the cut already happened; resuming at stage 3/, "must announce the resume");
  assert.match(r.err, /release-gate FAILED/, "the run must reach the release-gate wait");
  // The load-bearing assertion: a local-only tag must be pushed to origin
  // BEFORE the CI wait. Absent in the unfixed code (fail-first).
  assert.match(r.rec, /(^|\n)push origin refs\/tags\/v99\.99\.99(\n|$)/,
    "a local-only tag must be re-pushed to origin on resume");
}

// ---- Finding #1b: a tag already on origin is NOT re-pushed -------------------
// Guards against a naive "always push" fix — the re-push must be conditional on
// the tag being absent from origin.
{
  const dir = tmp();
  const r = run(dir, { GH_STUB_SCENARIO: "gate-fail", GIT_STUB_REMOTE_HAS_TAG: "1" }, 20000);
  assert.match(r.err, /release-gate FAILED/, "the run must reach the release-gate wait");
  assert.doesNotMatch(r.rec, /push origin refs\/tags\//,
    "a tag already on origin must not be re-pushed");
}

// ---- Finding #14: npm-publish cutoff comes from the gate's completion time ---
// The gate completed in the PAST (updatedAt 2020) and the npm-publish run was
// created just after it (also 2020). Under the fix the cutoff is that past gate
// completion, so the already-done npm run is in-window and the wait resolves
// (here: to a failure, which dies loudly). Under the bug the cutoff is resume-
// time now, the 2020 run is dropped, and the wait spins on its 20s interval —
// so the 8s spawn timeout kills it WITHOUT ever printing "npm-publish FAILED".
{
  const dir = tmp();
  const r = run(dir, { GH_STUB_SCENARIO: "npm-cutoff", GIT_STUB_REMOTE_HAS_TAG: "1" }, 8000);
  assert.match(r.out, /release-gate: SUCCESS/, "the gate wait must resolve to success first");
  assert.match(r.err, /npm-publish FAILED/,
    "the npm-publish wait must SEE the already-completed run (cutoff from the gate's own completion, not resume-time now)");
}

process.stdout.write("release-oneclick-resume-repush-smoke: ok (local-only tag re-pushed on resume; on-origin tag left alone; npm-publish cutoff from the gate's completion time)\n");
