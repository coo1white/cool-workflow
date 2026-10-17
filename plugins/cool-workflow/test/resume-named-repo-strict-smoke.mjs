// resume-named-repo-strict-smoke: `cw run resume <id> --repo X` (or --cwd X)
// used to look in X first and then quietly fall back to every repo the home
// registry knows, so `--drive --repo X` could drive the run in another repo Y
// (issue #786). The operator approved a new default for 0.3.1 (2026-10-16,
// project/docs/intent/2026-10-16-release-gate-ci.md, "Operator decisions for
// 0.3.1"): when the caller names a folder and the run is not in it, resume is
// refused (exit 1, nothing written) and the error names where the run is and
// the fix. With no folder named, or with an explicit --scope home, resume
// still finds the run by id across the registry, as before.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import * as registryCliModule from "../dist/shell/registry-cli.js";

const pluginRoot = path.resolve(import.meta.dirname, "..");
const cli = path.join(pluginRoot, "dist", "cli.js");

for (const v of ["CW_AGENT_COMMAND", "CW_AGENT_ENDPOINT", "CW_AGENT_MODEL", "CW_BACKEND"]) delete process.env[v];
process.env.CW_NO_AUTO_AGENT = "1";

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-resume-strict-")));
const home = path.join(root, "home");
fs.mkdirSync(home);
const env = { ...process.env, HOME: home, USERPROFILE: home, CW_HOME: path.join(home, ".cw") };
process.env.CW_HOME = env.CW_HOME;

function mkRepo(name) {
  const repo = path.join(root, name);
  fs.mkdirSync(repo);
  fs.writeFileSync(path.join(repo, "README.md"), "# target\n", "utf8");
  return repo;
}
function cw(args, cwd) {
  return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8", env });
}

async function main() {
  const owner = mkRepo("owner");
  const other = mkRepo("other");
  const planned = cw(["run", "architecture-review", "--drive", "--once", "--repo", owner, "--question", "q", "--json"], owner);
  assert.ok(planned.stdout, `plan a run in the owner repo; stderr=${planned.stderr}`);
  const plannedJson = JSON.parse(planned.stdout);
  const runId = plannedJson.runId || plannedJson.id;
  assert.ok(runId, "planned run id");
  // The home registry learns both repos.
  for (const repo of [owner, other]) {
    const refreshed = cw(["registry", "refresh", "--cwd", repo, "--scope", "repo"], repo);
    assert.equal(refreshed.status, 0, `registry refresh; stderr=${refreshed.stderr}`);
  }
  const statePath = path.join(owner, ".cw", "runs", runId, "state.json");
  const before = fs.readFileSync(statePath, "utf8");

  // (1) --drive --repo <other>: refused, names where the run is and the fix; nothing driven.
  const r1 = cw(["run", "resume", runId, "--drive", "--repo", other, "--json"], other);
  assert.equal(r1.status, 1, `resume --drive --repo <wrong folder> must exit 1; stdout=${r1.stdout} stderr=${r1.stderr}`);
  assert.ok(r1.stderr.includes(`run ${runId} is not in ${other} (the folder named by --repo)`), r1.stderr);
  assert.ok(r1.stderr.includes(`the registry finds it in ${owner}`), "the error names the folder the run is in");
  assert.ok(r1.stderr.includes(`Run again with --repo ${owner}`), "the error names the fix");
  assert.equal(fs.readFileSync(statePath, "utf8"), before, "the run in the other repo is not driven");
  assert.ok(!fs.existsSync(path.join(other, ".cw", "runs", runId)), "nothing is written in the named folder");

  // (2) read-only resume with --cwd <other>: refused the same way, naming --cwd.
  const r2 = cw(["run", "resume", runId, "--cwd", other, "--json"], owner);
  assert.equal(r2.status, 1, `resume --cwd <wrong folder> must exit 1; stdout=${r2.stdout}`);
  assert.ok(r2.stderr.includes("(the folder named by --cwd)") && r2.stderr.includes(`Run again with --cwd ${owner}`), r2.stderr);

  // (3) the same rule on the shared shell fn the cw_run_resume MCP tool calls.
  const { runResumeCli } = registryCliModule;
  await assert.rejects(() => runResumeCli(runId, { cwd: other }), /is not in .* \(the folder named by --cwd\)/);

  // (4) no folder named: found by id across the registry, as before.
  const r4 = cw(["run", "resume", runId, "--json"], other);
  assert.equal(r4.status, 0, `bare run resume still finds the run across the registry; stderr=${r4.stderr}`);
  const p4 = JSON.parse(r4.stdout);
  assert.equal(p4.repo, owner);
  assert.equal(p4.resolvedFrom, "home");

  // (5) an explicit --scope home keeps the registry-wide lookup with a named folder.
  const r5 = cw(["run", "resume", runId, "--repo", other, "--scope", "home", "--json"], other);
  assert.equal(r5.status, 0, `--scope home looks across the registry; stderr=${r5.stderr}`);
  assert.equal(JSON.parse(r5.stdout).repo, owner);

  // (6) the right folder named: works as before.
  const r6 = cw(["run", "resume", runId, "--repo", owner, "--json"], other);
  assert.equal(r6.status, 0, `resume --repo <owner> works; stderr=${r6.stderr}`);
  assert.equal(JSON.parse(r6.stdout).resolvedFrom, "repo");

  // (7) a run no repo holds: the old not-found error, unchanged.
  const r7 = cw(["run", "resume", "run-does-not-exist", "--repo", other, "--json"], other);
  assert.equal(r7.status, 1);
  assert.match(r7.stderr, /Cannot resume: run run-does-not-exist not found in source state \(fail closed; try registry refresh\)\./);
  assert.equal(fs.readFileSync(statePath, "utf8"), before, "no case changed the owner's run state");
}

main()
  .then(() => console.log("resume-named-repo-strict-smoke: ok"))
  .catch((error) => {
    process.exitCode = 1;
    console.error(error);
  })
  .finally(() => fs.rmSync(root, { recursive: true, force: true }));
