#!/usr/bin/env node
// copied-run-refuse-smoke — a run folder copied by hand (cp -R) into
// another repo, while the original is still there, is refused on load
// (0.3.2, operator decision 2026-10-17), so the copy never reads from or
// writes into the folder it was copied from:
//   1. `cw report <id>`, `cw report` (newest run), `cw report <id> --open`,
//      `cw status <id>`, and `cw run export <id>` run from the copy exit
//      1 with the refusal, which names the copy, the original, and the
//      `cw run export` / `cw run import` fix; not one byte of the original
//      repo or of the copy changes; loadRunFromCwd and RunRegistry.loadRun
//      refuse the same way;
//   2. the fix the message gives works: export from the original, take the
//      copy away, import into the other repo, and `cw report` there exits 0;
//   3. normal use is not refused: the original from its own repo, from
//      another process cwd with --cwd, through a symlinked path;
//   4. a copy whose original is gone (the repo was moved) and a copy whose
//      state.json has no paths.runDir (an old state) still load.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const pluginRoot = path.resolve(import.meta.dirname, "..");
const cli = path.join(pluginRoot, "dist", "cli.js");
import { plan } from "../dist/shell/pipeline.js";
import { loadWorkflowApp } from "../dist/shell/workflow-app-loader.js";
import { loadRunFromCwd } from "../dist/shell/run-store.js";
import { RunRegistry } from "../dist/shell/run-registry-io.js";

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-copied-run-")));
const openerLog = path.join(root, "opener.log");
const opener = path.join(root, "opener.js");
fs.writeFileSync(opener, `#!/usr/bin/env node\nrequire("fs").writeFileSync(${JSON.stringify(openerLog)}, process.argv[2], "utf8");\n`, "utf8");
fs.chmodSync(opener, 0o755);
const env = { ...process.env, CW_HOME: path.join(root, "cw-home"), CW_AGENT_COMMAND: "", CW_AGENT_ENDPOINT: "", CW_NO_AUTO_AGENT: "1", CW_OPENER: opener };

function cw(args, cwd) {
  return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8", env });
}

function makeRepo(name) {
  const repo = path.join(root, name);
  fs.mkdirSync(repo, { recursive: true });
  fs.writeFileSync(path.join(repo, "README.md"), "# target\n", "utf8");
  return repo;
}

function planRun(repo) {
  return plan(loadWorkflowApp("end-to-end-golden-path"), { repo, question: "copied run" });
}

function copyRun(fromRepo, toRepo, runId) {
  const to = path.join(toRepo, ".cw", "runs", runId);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(path.join(fromRepo, ".cw", "runs", runId), to, { recursive: true });
  return to;
}

/** Every file under `dir`, relative path -> sha256 of its bytes. */
function snapshot(dir) {
  const out = {};
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) walk(file);
      else out[path.relative(dir, file)] = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    }
  };
  walk(dir);
  return out;
}

const failures = [];
function section(name, fn) {
  try {
    fn();
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
  }
}

try {
  // ===== 1. a hand copy is refused, and nothing is written =====
  section("1", () => {
    const origRepo = makeRepo("orig");
    const copyRepo = makeRepo("copy");
    const run = planRun(origRepo);
    const origRunDir = run.paths.runDir;
    const copyRunDir = copyRun(origRepo, copyRepo, run.id);
    const origBefore = snapshot(origRepo);
    const copyBefore = snapshot(copyRepo);

    for (const args of [["report", run.id], ["report"], ["report", run.id, "--open"], ["status", run.id], ["run", "export", run.id]]) {
      const res = cw(args, copyRepo);
      const label = `cw ${args.join(" ")}`;
      assert.equal(res.status, 1, `${label} from the copy exits 1\n${res.stdout}\n${res.stderr}`);
      assert.equal(res.stdout, "", `${label}: nothing on stdout`);
      assert.ok(res.stderr.includes(`Refusing to load run ${run.id}: the folder ${copyRunDir} is a copy of ${origRunDir},`), `${label}: names the copy and the original\n${res.stderr}`);
      assert.ok(res.stderr.includes(`cw run export ${run.id} --cwd ${origRepo} --output ${path.join(copyRepo, `${run.id}.cwrun.json`)}`), `${label}: gives the export step\n${res.stderr}`);
      assert.ok(res.stderr.includes(`cw run import ${path.join(copyRepo, `${run.id}.cwrun.json`)} --target ${copyRepo}`), `${label}: gives the import step\n${res.stderr}`);
    }
    assert.deepEqual(snapshot(origRepo), origBefore, "not one byte of the original repo changed");
    assert.deepEqual(snapshot(copyRepo), copyBefore, "nothing was written into the copy either");
    assert.equal(fs.existsSync(openerLog), false, "no report was opened");
    assert.throws(() => loadRunFromCwd(run.id, copyRepo), /is a copy of/, "loadRunFromCwd refuses");
    assert.throws(() => new RunRegistry(copyRepo, undefined, env).loadRun(copyRepo, run.id), /is a copy of/, "RunRegistry.loadRun refuses");
  });

  // ===== 2. the fix the message gives works =====
  section("2", () => {
    const origRepo = makeRepo("fix-orig");
    const copyRepo = makeRepo("fix-copy");
    const run = planRun(origRepo);
    const copyRunDir = copyRun(origRepo, copyRepo, run.id);
    const archive = path.join(copyRepo, `${run.id}.cwrun.json`);
    const origBefore = snapshot(origRepo);

    const exported = cw(["run", "export", run.id, "--cwd", origRepo, "--output", archive], root);
    assert.equal(exported.status, 0, `export from the original exits 0\n${exported.stderr}`);
    fs.rmSync(copyRunDir, { recursive: true, force: true });
    const imported = cw(["run", "import", archive, "--target", copyRepo], root);
    assert.equal(imported.status, 0, `import into the other repo exits 0\n${imported.stderr}`);
    const report = cw(["report", run.id], copyRepo);
    assert.equal(report.status, 0, `cw report on the imported run exits 0\n${report.stderr}`);
    assert.equal(report.stdout, `${path.join(copyRunDir, "report.md")}\n`, "report.md is written in the imported run folder");
    assert.deepEqual(snapshot(origRepo), origBefore, "the original repo is unchanged");
  });

  // ===== 3. normal use is not refused =====
  section("3", () => {
    const repo = makeRepo("normal");
    const run = planRun(repo);
    const here = cw(["report", run.id], repo);
    assert.equal(here.status, 0, `cw report in its own repo exits 0\n${here.stderr}`);
    const elsewhere = cw(["report", run.id, "--cwd", repo], root);
    assert.equal(elsewhere.status, 0, `cw report --cwd from another cwd exits 0\n${elsewhere.stderr}`);
    const link = path.join(root, "normal-link");
    fs.symlinkSync(repo, link, "dir");
    const viaLink = cw(["status", run.id, "--cwd", link, "--json"], root);
    assert.equal(viaLink.status, 0, `cw status through a symlink exits 0\n${viaLink.stderr}`);
    assert.equal(new RunRegistry(link, undefined, env).loadRun(link, run.id).id, run.id, "RunRegistry.loadRun through a symlink");
  });

  // ===== 4. a copy whose original is gone, and an old state, still load =====
  section("4", () => {
    const origRepo = makeRepo("gone-orig");
    const copyRepo = makeRepo("gone-copy");
    const run = planRun(origRepo);
    copyRun(origRepo, copyRepo, run.id);
    fs.rmSync(origRepo, { recursive: true, force: true });
    const res = cw(["report", run.id], copyRepo);
    assert.equal(res.status, 0, `a copy whose original is gone loads\n${res.stderr}`);
    assert.equal(fs.existsSync(origRepo), false, "nothing is made again at the old place");

    const oldOrig = makeRepo("old-orig");
    const oldCopy = makeRepo("old-copy");
    const oldRun = planRun(oldOrig);
    const oldCopyDir = copyRun(oldOrig, oldCopy, oldRun.id);
    const statePath = path.join(oldCopyDir, "state.json");
    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    delete state.paths.runDir;
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n", "utf8");
    const old = cw(["status", oldRun.id, "--json"], oldCopy);
    assert.equal(old.status, 0, `a state with no paths.runDir loads\n${old.stderr}`);
  });

  if (failures.length) {
    for (const failure of failures) console.error(`not ok ${failure}`);
    process.exitCode = 1;
  } else {
    console.log("copied-run-refuse-smoke: ok");
  }
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
