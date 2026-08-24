#!/usr/bin/env node
// reclamationio-tombstone-chain — pins the write-ahead reclamation
// transaction on a real (small) run dir: skeleton validation, the genesis
// hash chain, commitTombstone's durable append, verifyReclamation's
// independent re-check (with tamper detection), the never-delete-without-
// a-record order under fault injection, and freeBulk's containment guard.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  extractSkeleton,
  validateSkeleton,
  validateSkeletonAgainstRun,
  planReclamation,
  genesisPrevHash,
  computeTombstoneHash,
  buildTombstone,
  commitTombstone,
  freeBulk,
  runReclamation,
  verifyReclamation,
  reclaimedLogPath,
  ReclamationError,
  ReclamationAbort,
  SKELETON_REQUIRED_KEYS,
} = require("../dist/shell/reclamation-io");
const { writeJson, readJson } = require("../dist/shell/fs-atomic");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-tombstone-"));

// Same minimal run shape as reclamationio-log-failclosed.test.js: one
// completed task, a kept result, a worker scratch dir with bytes to free.
function makeRun(name) {
  const runDir = path.join(tmp, name);
  const workerDir = path.join(runDir, "workers", "w1");
  const resultPath = path.join(runDir, "results", "t1.md");
  fs.mkdirSync(workerDir, { recursive: true });
  fs.mkdirSync(path.dirname(resultPath), { recursive: true });
  fs.writeFileSync(path.join(workerDir, "scratch.txt"), "scratch bytes to free\n");
  fs.writeFileSync(resultPath, "the kept result\n");
  const run = {
    schemaVersion: 1,
    id: name,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    loopStage: "act",
    workflow: { id: "wf-demo", title: "demo" },
    inputs: {},
    paths: { runDir, state: path.join(runDir, "state.json") },
    tasks: [{ id: "t1", phase: "p1", status: "completed", resultPath, resultNodeId: "n1" }],
    phases: [],
    nodes: [{ id: "n1", artifacts: [{ id: "result", path: resultPath }], evidence: [] }],
    commits: [],
    dispatches: [],
    workers: [{ workerDir, taskId: "t1", resultNodeId: "n1" }],
    feedback: [],
  };
  writeJson(run.paths.state, run, { durable: true });
  return run;
}

const scratchFile = (run) => path.join(run.paths.runDir, "workers", "w1", "scratch.txt");

// --- validateSkeleton: undefined is missing everything; each shape check
// catches its own bad field.
{
  assert.deepEqual(validateSkeleton(undefined), [...SKELETON_REQUIRED_KEYS]);
  const run = makeRun("skeleton-shape");
  const good = extractSkeleton(run);
  assert.deepEqual(validateSkeleton(good), [], "a real skeleton is complete");
  assert.deepEqual(validateSkeleton({ ...good, runId: "  " }), ["runId"], "a blank runId is missing");
  assert.deepEqual(validateSkeleton({ ...good, stateDigest: "" }), ["stateDigest"]);
  assert.deepEqual(validateSkeleton({ ...good, finalVerdict: {} }), ["finalVerdict"], "a verdict with no lifecycle");
  assert.deepEqual(validateSkeleton({ ...good, auditLog: { path: "x" } }), ["auditLog"], "an audit log with no digest");
  assert.deepEqual(validateSkeleton({ ...good, attestationChain: {} }), ["attestationChain"]);
  assert.deepEqual(validateSkeleton({ ...good, commits: "no" }), ["commits"]);
  assert.deepEqual(validateSkeleton({ ...good, evidenceDigests: {} }), ["evidenceDigests"]);

  // The skeleton keeps the run's terminal verdict.
  assert.equal(good.finalVerdict.lifecycle, "completed");
  assert.equal(good.finalVerdict.terminal, true);
  assert.equal(good.runId, "skeleton-shape");
}

// --- validateSkeletonAgainstRun: refuse a skeleton that dropped what the
// run really has.
{
  const run = makeRun("skeleton-vs-run");
  run.commits = [{ id: "c1", verifierGated: true, evidence: [] }];
  const skeleton = extractSkeleton(run);
  assert.deepEqual(validateSkeletonAgainstRun(run, skeleton), [], "a faithful skeleton passes");
  assert.deepEqual(
    validateSkeletonAgainstRun(run, { ...skeleton, commits: [] }),
    ["commits-dropped(run=1,sealed=0)"],
    "a dropped commit is named with counts"
  );
  run.nodes[0].evidence = [{ id: "e1", summary: "seen" }];
  const withEvidence = extractSkeleton(run);
  assert.ok(withEvidence.evidenceDigests.length > 0, "run evidence lands in the skeleton");
  assert.deepEqual(validateSkeletonAgainstRun(run, { ...withEvidence, evidenceDigests: [] }), ["evidence-dropped"]);
  assert.deepEqual(validateSkeletonAgainstRun(run, { ...withEvidence, finalVerdict: undefined }), ["verdict-missing"]);
}

// --- The hash chain: genesis prev comes from the sealed skeleton; each
// later tombstone chains on the one before; ids are tomb-001, tomb-002.
{
  const run = makeRun("chain");
  const skeleton = extractSkeleton(run);
  const plan = planReclamation(run);
  assert.equal(plan.capability, "re-runnable", "scratch-only: still re-runnable");
  assert.equal(plan.capabilityReason, "scratch-only-reclaimed");
  assert.deepEqual(plan.freeable.map((f) => f.kind), ["scratch"]);
  assert.ok(plan.bytesToFree > 0);

  const first = buildTombstone(run, skeleton, plan, { now: "2026-02-01T00:00:00.000Z", actor: "test" });
  assert.equal(first.tombstoneId, "tomb-001");
  assert.equal(first.prevTombstoneHash, genesisPrevHash(skeleton), "genesis prev = hash of the sealed skeleton");
  const { tombstoneHash, ...rest } = first;
  assert.equal(computeTombstoneHash(rest), tombstoneHash, "the stored hash is exactly the recomputed one");
  assert.ok(first.freed[0].sha256.startsWith("sha256:"), "each freed path is content-hashed BEFORE deletion");

  commitTombstone(run, first);
  const onDisk = readJson(reclaimedLogPath(run));
  assert.equal(onDisk.tombstones.length, 1);
  assert.equal(onDisk.tombstones[0].tombstoneHash, first.tombstoneHash);

  const second = buildTombstone(run, skeleton, plan, { now: "2026-02-02T00:00:00.000Z" });
  assert.equal(second.tombstoneId, "tomb-002");
  assert.equal(second.prevTombstoneHash, first.tombstoneHash, "the chain links to the last tombstone");
  commitTombstone(run, second);

  const verify = verifyReclamation(run);
  assert.equal(verify.reclaimed, true);
  assert.equal(verify.verified, true, "the honest chain verifies");
  assert.equal(verify.tombstones.length, 2);

  // Tamper 1: change a stored tombstoneHash -> digest mismatch AND the next
  // link breaks (its prev no longer matches).
  const tampered = readJson(reclaimedLogPath(run));
  tampered.tombstones[0].tombstoneHash = "sha256:0000";
  fs.writeFileSync(reclaimedLogPath(run), JSON.stringify(tampered), "utf8");
  const afterTamper = verifyReclamation(run);
  assert.equal(afterTamper.verified, false);
  const codes = afterTamper.checks.filter((c) => !c.pass).map((c) => c.code);
  assert.ok(codes.includes("tombstone-digest-mismatch"), "the changed hash is caught");
  assert.ok(codes.includes("tombstone-chain-broken"), "the following link is caught too");

  // Tamper 2: change a freed path's bytes count -> the recomputed hash no
  // longer matches the stored one.
  writeJson(reclaimedLogPath(run), onDisk, { durable: true });
  const tampered2 = readJson(reclaimedLogPath(run));
  tampered2.tombstones[0].freed[0].bytes += 1;
  fs.writeFileSync(reclaimedLogPath(run), JSON.stringify(tampered2), "utf8");
  const afterTamper2 = verifyReclamation(run);
  assert.equal(afterTamper2.verified, false);
  assert.ok(
    afterTamper2.checks.some((c) => !c.pass && c.code === "tombstone-digest-mismatch"),
    "a changed freed entry is caught by the recomputed hash"
  );
}

// --- Fault injection: a crash BEFORE the tombstone commit frees nothing
// and writes nothing; a crash AFTER it keeps the record but still frees
// nothing (write-ahead order). A later clean pass picks up from there.
{
  const run = makeRun("faults");
  const log = reclaimedLogPath(run);

  for (const step of ["skeleton", "tombstone-write"]) {
    assert.throws(
      () => runReclamation(run, { faultAfter: step }),
      (error) => error instanceof ReclamationAbort && error.step === step
    );
    assert.ok(!fs.existsSync(log), `${step}: no tombstone was written`);
    assert.ok(fs.existsSync(scratchFile(run)), `${step}: no byte was freed`);
  }

  assert.throws(
    () => runReclamation(run, { faultAfter: "tombstone-commit" }),
    (error) => error instanceof ReclamationAbort && error.step === "tombstone-commit"
  );
  assert.ok(fs.existsSync(log), "tombstone-commit: the record IS on disk");
  assert.equal(readJson(log).tombstones.length, 1);
  assert.ok(fs.existsSync(scratchFile(run)), "tombstone-commit: still no byte freed — record first, delete after");

  // A clean pass after the crash chains a second tombstone and frees the bytes.
  const done = runReclamation(run, { now: "2026-03-01T00:00:00.000Z" });
  assert.equal(done.tombstone.tombstoneId, "tomb-002");
  assert.equal(readJson(log).tombstones[1].prevTombstoneHash, readJson(log).tombstones[0].tombstoneHash);
  assert.ok(done.bytesFreed > 0);
  assert.ok(!fs.existsSync(path.join(run.paths.runDir, "workers", "w1")), "the scratch dir is gone");
  assert.ok(fs.existsSync(path.join(run.paths.runDir, "results", "t1.md")), "the kept result is NOT touched");
  const verify = verifyReclamation(run);
  assert.equal(verify.verified, true, "the after-crash chain still verifies");
}

// --- freeBulk containment guard: a freed path that gets out of the run
// dir is refused BEFORE any delete — a tampered state.json can never turn
// reclamation into an out-of-tree rm.
{
  const run = makeRun("containment");
  const victim = path.join(tmp, "victim.txt");
  fs.writeFileSync(victim, "must survive\n");
  const evil = {
    freed: [{ path: path.join("..", "victim.txt"), kind: "scratch", bytes: 1, sha256: "sha256:x" }],
  };
  let thrown;
  try {
    freeBulk(run, evil);
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown instanceof ReclamationError);
  assert.equal(thrown.code, "unsafe-free-path");
  assert.ok(fs.existsSync(victim), "the outside file is untouched");
  assert.ok(fs.existsSync(scratchFile(run)), "nothing inside was freed either (the guard stops the pass)");
}

process.stdout.write("reclamationio-tombstone-chain: ok\n");
