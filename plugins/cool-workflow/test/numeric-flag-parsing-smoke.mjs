#!/usr/bin/env node
// numeric-flag-parsing-smoke — robustness cycle P2-5.
//
// Several shell/*.ts call sites each rolled their own ad-hoc numeric-flag
// parse for `--limit` (and friends). Every one shared one of two bugs:
//   - `value === undefined ? undefined : Number(value)`: a BARE flag with no
//     value (parseargv turns `--limit` alone into boolean true) silently
//     became `Number(true) === 1`, never an error.
//   - `value || fallback`: this ALSO silently replaced a genuinely-given `0`
//     (or a `NaN` from an unparseable string, since NaN is falsy too) with
//     the default, in either direction (sometimes meaning "no limit" when
//     the user meant "limit to 1", sometimes the reverse).
// core/util/numeric-flag.ts's requiredNumberFlag is the one shared fix: a
// bare flag or an unparseable value now throws loud instead of guessing;
// absent stays absent; a genuine 0 (or negative) is preserved.
//
// This proves the fix end-to-end through the real CLI, at every call site
// the audit named, not just the shared parser in isolation (see
// core/util/numeric-flag-requirednumberflag.test.mjs for that unit coverage).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpDir } from "./helpers/workspace.mjs";

const pluginRoot = path.resolve(import.meta.dirname, "..");
const cli = path.join(pluginRoot, "dist", "cli.js");
const node = process.execPath;

function runJson(args, opts) {
  return JSON.parse(execFileSync(node, [cli, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts }));
}
function runFail(args, opts) {
  const result = spawnSync(node, [cli, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });
  assert.notEqual(result.status, 0, `expected failure for: cw ${args.join(" ")}`);
  return result;
}

// ---------------------------------------------------------------------
// dispatch --limit: 0 must dispatch nothing, -1 must clamp to nothing, a
// bare flag must error (never silently keep the configured default).
// ---------------------------------------------------------------------
{
  const tmp = tmpDir("cw-numeric-flag-dispatch-");
  const opts = { cwd: tmp };
  const plan = runJson(["plan", "end-to-end-golden-path", "--repo", tmp, "--question", "Prove numeric flag parsing on dispatch."], opts);
  assert.ok(plan.pendingTasks > 0, "fixture plan must have at least one pending task");

  const zero = runJson(["dispatch", plan.runId, "--limit", "0"], opts);
  assert.deepEqual(zero.tasks, [], "--limit 0 must dispatch nothing, not fall back to the configured default");

  // parseArgv treats a bare "-1" after a flag as a new flag, not a value (a
  // pinned, pre-existing parser rule) -- use "--limit=-1" to pass a negative.
  const negative = runJson(["dispatch", plan.runId, "--limit=-1"], opts);
  assert.deepEqual(negative.tasks, [], "--limit=-1 must clamp to nothing, not be treated as an unbounded/negative slice");

  const bare = runFail(["dispatch", plan.runId, "--limit"], opts);
  assert.match(bare.stderr, /--limit requires a value/, "a bare --limit on dispatch must error, not silently become 1");

  const garbage = runFail(["dispatch", plan.runId, "--limit", "abc"], opts);
  assert.match(garbage.stderr, /Invalid --limit "abc": expected a number/, "an unparseable --limit on dispatch must error");

  fs.rmSync(tmp, { recursive: true, force: true });
}

// ---------------------------------------------------------------------
// run list: a bare --limit must error, not silently mean "limit to 1"
// (RunRegistry.search's OWN pagination floor separately clamps any
// genuinely-given limit to >= 1 -- that floor is unrelated pre-existing
// behavior, not part of this cycle; a genuinely-given --limit 3 must be
// honored exactly, distinguishing it from the old silent-1 bug). Its
// --offset (the same fix, on the sibling field the fix originally missed)
// must also error on a bare flag, not silently drop every result.
// ---------------------------------------------------------------------
{
  const home = tmpDir("cw-numeric-flag-runlist-");
  const env = { ...process.env, CW_HOME: home };
  const opts = { cwd: home, env };

  const bare = runFail(["run", "list", "--limit"], opts);
  assert.match(bare.stderr, /--limit requires a value/, "a bare --limit on run list must error, not silently mean 1");

  const three = runJson(["run", "list", "--limit", "3", "--json"], opts);
  assert.equal(three.query.limit, 3, "a genuinely-given --limit 3 on run list must be honored exactly, not silently become 1");

  const bareOffset = runFail(["run", "list", "--offset"], opts);
  assert.match(bareOffset.stderr, /--offset requires a value/, "a bare --offset on run list must error, not silently drop every result");

  fs.rmSync(home, { recursive: true, force: true });
}

// ---------------------------------------------------------------------
// A confirmed adversarial-review finding: the run.*/queue.*
// --limit call sites in registry-cli.ts (run search, run resume, history,
// queue drain) had NO dedicated regression coverage -- only run list did.
// All are correctly wired today; this closes the coverage gap so a future
// refactor of any of them can't silently regress without a test noticing. None of these need a
// real run/queue fixture: requiredNumberFlag throws while building the
// options object, before any registry lookup happens.
// ---------------------------------------------------------------------
{
  const home = tmpDir("cw-numeric-flag-registry-limit-");
  const env = { ...process.env, CW_HOME: home };
  const opts = { cwd: home, env };

  for (const args of [
    ["run", "search", "--limit"],
    ["run", "resume", "bogus-run-id", "--limit"],
    ["history", "--limit"],
    ["queue", "drain", "--limit"]
  ]) {
    const bare = runFail(args, opts);
    assert.match(bare.stderr, /--limit requires a value/, `a bare --limit on "cw ${args.join(" ")}" must error`);
  }

  const garbage = runFail(["run", "search", "--limit", "abc"], opts);
  assert.match(garbage.stderr, /Invalid --limit "abc": expected a number/, "an unparseable --limit on run search must error");

  const garbageHistory = runFail(["history", "--limit", "abc"], opts);
  assert.match(garbageHistory.stderr, /Invalid --limit "abc": expected a number/, "an unparseable --limit on history must error");

  fs.rmSync(home, { recursive: true, force: true });
}

// ---------------------------------------------------------------------
// A confirmed adversarial-review finding: registry-cli.ts's OTHER
// numeric flags (queue add's --priority, run archive's
// --older-than-days) shared the exact same
// bare-flag-becomes-1 bug as --limit, just never named by the original
// audit ("and friends" was scoped to pagination limit). All now route
// through the same shared parser.
// ---------------------------------------------------------------------
{
  const home = tmpDir("cw-numeric-flag-registry-friends-");
  const env = { ...process.env, CW_HOME: home };
  const opts = { cwd: home, env };

  const barePriority = runFail(["queue", "add", "--runId", "x", "--priority"], opts);
  assert.match(barePriority.stderr, /--priority requires a value/, "a bare --priority on queue add must error, not silently become 1");

  const bareOlderThanDays = runFail(["run", "archive", "--older-than-days"], opts);
  assert.match(bareOlderThanDays.stderr, /--older-than-days requires a value/, "a bare --older-than-days on run archive must error");
  // Absent entirely (neither a run id nor the retention flag) keeps its own,
  // DIFFERENT pre-existing message -- proves the fix didn't disturb that path.
  const neitherGiven = runFail(["run", "archive"], opts);
  assert.match(neitherGiven.stderr, /Missing run id \(or --older-than-days N/, "omitting both the run id and --older-than-days must keep its own pre-existing message");

  fs.rmSync(home, { recursive: true, force: true });
}

// ---------------------------------------------------------------------
// cw next / cw_next: a confirmed adversarial-review finding -- the ONE
// OTHER caller of nextDispatchTasks (dispatch's sibling) still used its
// own lenient local numberOption, silently ignoring a bare or garbage
// --limit instead of throwing.
// ---------------------------------------------------------------------
{
  const tmp = tmpDir("cw-numeric-flag-next-");
  const opts = { cwd: tmp };
  const plan = runJson(["plan", "end-to-end-golden-path", "--repo", tmp, "--question", "Prove numeric flag parsing on next."], opts);

  const bare = runFail(["next", plan.runId, "--limit"], opts);
  assert.match(bare.stderr, /--limit requires a value/, "a bare --limit on next must error, not silently return the unlimited list");

  const garbage = runFail(["next", plan.runId, "--limit", "abc"], opts);
  assert.match(garbage.stderr, /Invalid --limit "abc": expected a number/, "an unparseable --limit on next must error");

  const one = runJson(["next", plan.runId, "--limit", "1", "--json"], opts);
  assert.ok(Array.isArray(one), "a genuinely-given --limit 1 on next must still work normally");

  fs.rmSync(tmp, { recursive: true, force: true });
}

// ---------------------------------------------------------------------
// metrics summary: a bare or garbage --limit must error.
// ---------------------------------------------------------------------
{
  const home = tmpDir("cw-numeric-flag-metrics-");
  const env = { ...process.env, CW_HOME: home };
  const opts = { cwd: home, env };

  const bare = runFail(["metrics", "summary", "--limit"], opts);
  assert.match(bare.stderr, /--limit requires a value/, "a bare --limit on metrics summary must error");

  const garbage = runFail(["metrics", "summary", "--limit", "abc"], opts);
  assert.match(garbage.stderr, /Invalid --limit "abc": expected a number/, "an unparseable --limit on metrics summary must error");

  fs.rmSync(home, { recursive: true, force: true });
}

process.stdout.write(
  "numeric-flag-parsing-smoke: ok (dispatch 0/-1/bare/garbage, run list bare/exact/offset, " +
    "run search/resume/history/queue-drain coverage, registry --priority/--older-than-days, " +
    "metrics summary, cw next)\n"
);
