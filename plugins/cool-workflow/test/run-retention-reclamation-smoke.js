#!/usr/bin/env node
// run-retention-reclamation-smoke (v0.1.39) — Run Retention & Provable Reclamation.
//
// Proves the write-ahead, fail-closed reclamation transaction: dry-run frees
// zero, crash-safety leaves either the full run or a complete tombstone, the
// tombstone hash chain is tamper-evident (two distinct codes), the skeleton is
// schema-complete or reclamation refuses, reconstructable artifacts re-derive
// from RETAINED inputs, worker scratch is reclaimed with provable post-conditions,
// and ineligible runs fail closed with distinct codes. All byte measurement is
// in-process via dirBytes() — NEVER `du`.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createRunPaths, ensureRunDirs, saveCheckpoint } = require("../dist/state");
const { allocateWorkerScope, recordWorkerOutput } = require("../dist/worker-isolation");
const { snapshotNode, loadNodeSnapshot } = require("../dist/node-snapshot");
const { RunRegistry } = require("../dist/run-registry");
const {
  runReclamation,
  planReclamation,
  extractSkeleton,
  validateSkeleton,
  verifyReclamation,
  loadReclamationLog,
  reclaimedLogPath,
  dirBytes,
  dominantFailureCode,
  ReclamationAbort,
  ReclamationError,
  SKELETON_REQUIRED_KEYS
} = require("../dist/reclamation");

const RESULT_BODY = (summary, ev) =>
  ["# Result", "", summary, "", "```cw:result", JSON.stringify({ summary, findings: [], evidence: ev }), "```", ""].join("\n");

let SEQ = 0;
function makeRepo() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-retention-"));
  // Isolate the home registry so we never touch the real $CW_HOME.
  process.env.CW_HOME = path.join(tmp, "home");
  return tmp;
}

/** Build a run with one accepted worker output (result node + scratch +
 *  results/<task>.md + verifier node). When `pending` is set, a second task is
 *  left pending so the run stays non-terminal. */
function makeAcceptedRun(repo, runId, options = {}) {
  const paths = createRunPaths(path.join(repo, ".cw", "runs", runId));
  ensureRunDirs(paths);
  const taskPath = path.join(paths.tasksDir, "map.md");
  fs.writeFileSync(taskPath, "map\n", "utf8");
  const tasks = [
    {
      id: "map:system",
      kind: "agent",
      phase: "Map",
      status: "pending",
      requiresEvidence: false,
      prompt: "Map.",
      taskPath,
      resultPath: "",
      loopStage: "interpret",
      stateNodeId: `${runId}:task:map:system`
    }
  ];
  if (options.pending) {
    tasks.push({
      id: "map:other",
      kind: "agent",
      phase: "Map",
      status: "pending",
      requiresEvidence: false,
      prompt: "Map other.",
      taskPath,
      resultPath: "",
      loopStage: "interpret",
      stateNodeId: `${runId}:task:map:other`
    });
  }
  const run = {
    schemaVersion: 1,
    id: runId,
    createdAt: new Date(Date.now() - 1000 * (SEQ += 1)).toISOString(),
    updatedAt: new Date().toISOString(),
    cwd: repo,
    workflow: { id: "retention-smoke", title: "Retention Smoke", summary: "", limits: { maxAgents: 2, maxConcurrentAgents: 2 }, app: { id: "retention-smoke", version: "0.0.0" } },
    inputs: {},
    loopStage: "interpret",
    phases: [{ id: "map", name: "Map", status: "pending", taskIds: tasks.map((t) => t.id) }],
    tasks,
    dispatches: [],
    commits: [],
    paths,
    nodes: [],
    contracts: [],
    feedback: [],
    workers: []
  };
  saveCheckpoint(run);
  const scope = allocateWorkerScope(run, run.tasks[0], { workerId: `worker-${runId}`, persist: false });
  // Worker-local scratch (artifacts/logs) so the scratch dir has real bytes.
  fs.writeFileSync(path.join(scope.artifactsDir, "scratch-notes.md"), "throwaway scratch\n".repeat(40), "utf8");
  fs.writeFileSync(path.join(scope.logsDir, "run.log"), "log line\n".repeat(60), "utf8");
  fs.writeFileSync(scope.resultPath, RESULT_BODY("mapped", ["test/run-retention-reclamation-smoke.js:1"]), "utf8");
  recordWorkerOutput(run, scope.id, scope.resultPath, { persist: false });
  // A verifier-gated commit so the skeleton seals a real commit record.
  if (options.commit !== false) {
    run.commits.push({
      id: `${runId}:commit:1`,
      createdAt: new Date().toISOString(),
      reason: "accepted",
      loopStage: "adjust",
      statePath: paths.state,
      reportPath: paths.report,
      snapshotPath: path.join(paths.commitsDir, "1.json"),
      verifierGated: true,
      verifierNodeId: run.tasks[0].verifierNodeId,
      evidence: [{ id: "c:1", source: "summary", locator: "test/run-retention-reclamation-smoke.js:1", summary: "ok" }]
    });
  }
  saveCheckpoint(run);
  return { run, paths, scope, resultNodeId: run.tasks[0].resultNodeId };
}

function fileManifest(root) {
  const out = {};
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else out[path.relative(root, abs)] = require("node:crypto").createHash("sha256").update(fs.readFileSync(abs)).digest("hex");
    }
  };
  walk(root);
  return out;
}

// ===========================================================================
// Unit: dirBytes + skeleton schema contract.
// ===========================================================================
{
  const repo = makeRepo();
  const { run } = makeAcceptedRun(repo, "unit-skeleton");
  const skeleton = extractSkeleton(run);
  assert.deepEqual(validateSkeleton(skeleton), [], "complete skeleton has zero missing keys");
  for (const key of SKELETON_REQUIRED_KEYS) {
    const broken = { ...skeleton };
    delete broken[key];
    assert.ok(validateSkeleton(broken).includes(key), `deleting ${key} is reported missing`);
  }
  assert.ok(dirBytes(run.paths.runDir) > 0, "dirBytes measures a non-empty run dir in-process");
  assert.equal(dirBytes(path.join(run.paths.runDir, "does-not-exist")), 0, "dirBytes of an absent path is 0");
}

// ===========================================================================
// A — Dry-run frees zero; plan.bytesToFree equals summed per-path sizes.
// ===========================================================================
{
  const repo = makeRepo();
  const { run } = makeAcceptedRun(repo, "dry-run");
  const reg = new RunRegistry(repo);
  reg.archive("dry-run", { scope: "repo", reason: "test" });
  const before = dirBytes(run.paths.runDir);
  const plan = reg.gcPlan({ scope: "repo", runId: "dry-run" });
  const after = dirBytes(run.paths.runDir);
  assert.equal(before, after, "gc plan frees zero bytes");
  assert.ok(!fs.existsSync(reclaimedLogPath(run)), "gc plan writes no reclaimed.json");
  const entry = plan.entries.find((e) => e.runId === "dry-run");
  assert.ok(entry && entry.eligible, "archived terminal run is eligible");
  const summed = entry.freeable.reduce((s, f) => s + f.bytes, 0);
  assert.equal(plan.bytesToFree, summed, "plan.bytesToFree equals the summed per-path sizes it lists");
  assert.ok(summed > 0, "there are real bytes to free");
  // Every listed per-path size matches an on-disk measurement.
  for (const f of entry.freeable) {
    assert.equal(f.bytes, dirBytes(path.join(run.paths.runDir, f.path)), `freeable size matches disk for ${f.path}`);
  }
}

// ===========================================================================
// B — Write-ahead crash-safety by design (faultAfter).
// ===========================================================================
{
  const repo = makeRepo();
  const { run } = makeAcceptedRun(repo, "crash-skeleton");
  const pre = fileManifest(run.paths.runDir);
  assert.throws(
    () => runReclamation(run, { faultAfter: "skeleton", reclaimPolicy: {} }),
    (e) => e instanceof ReclamationAbort && e.step === "skeleton"
  );
  assert.deepEqual(fileManifest(run.paths.runDir), pre, "faultAfter:skeleton leaves the run byte-identical");
  assert.ok(!fs.existsSync(reclaimedLogPath(run)), "faultAfter:skeleton writes no reclaimed.json");
}
{
  const repo = makeRepo();
  const built = makeAcceptedRun(repo, "crash-commit");
  const run = built.run;
  // Persist a node snapshot so reconstruction is exercised by the post-fault verify.
  snapshotNode(run, built.resultNodeId, { persist: true });
  saveCheckpoint(run);
  const scratchDir = built.scope.workerDir;
  assert.throws(
    () => runReclamation(run, { faultAfter: "tombstone-commit", reclaimPolicy: { keepSnapshots: true } }),
    (e) => e instanceof ReclamationAbort && e.step === "tombstone-commit"
  );
  assert.ok(fs.existsSync(reclaimedLogPath(run)), "faultAfter:tombstone-commit leaves reclaimed.json present (fsynced)");
  assert.ok(fs.existsSync(scratchDir), "the bulk bytes are STILL present (free never ran)");
  const verify = verifyReclamation(run);
  assert.ok(verify.verified, "a recoverable, committed-but-unfreed tombstone still passes verify");
}

// ===========================================================================
// C — Tombstone tamper: two distinct codes; chain exercised across two nodes.
// ===========================================================================
{
  const repo = makeRepo();
  const built = makeAcceptedRun(repo, "tamper");
  const run = built.run;
  snapshotNode(run, built.resultNodeId, { persist: true });
  saveCheckpoint(run);
  // Pass 1 frees scratch (re-points the result node); pass 2 frees the snapshot.
  const t1 = runReclamation(run, { reclaimPolicy: { keepSnapshots: true } });
  saveCheckpoint(run);
  const t2 = runReclamation(run, { reclaimPolicy: { keepScratch: true } });
  saveCheckpoint(run);
  assert.equal(t2.tombstone.prevTombstoneHash, t1.tombstone.tombstoneHash, "second tombstone chains to the first");
  const fresh = verifyReclamation(run);
  assert.ok(fresh.verified, "a fresh two-link chain passes verify");
  assert.equal(fresh.tombstones.length, 2, "chain has two tombstones");

  const logPath = reclaimedLogPath(run);
  const original = fs.readFileSync(logPath, "utf8");

  // (i) flip a per-path sha256 in the freed-manifest -> tombstone-digest-mismatch.
  const flipped = JSON.parse(original);
  const hex = flipped.tombstones[0].freed[0].sha256;
  flipped.tombstones[0].freed[0].sha256 = hex.slice(0, -1) + (hex.endsWith("0") ? "1" : "0");
  fs.writeFileSync(logPath, JSON.stringify(flipped, null, 2));
  let v = verifyReclamation(run);
  assert.ok(!v.verified, "flipped manifest sha fails verify");
  assert.equal(dominantFailureCode(v.checks), "tombstone-digest-mismatch", "flipping a per-path sha is tombstone-digest-mismatch");
  fs.writeFileSync(logPath, original);

  // (ii) edit the first tombstoneHash -> the second's prev no longer links -> chain-broken.
  const edited = JSON.parse(original);
  edited.tombstones[0].tombstoneHash = "sha256:deadbeef";
  fs.writeFileSync(logPath, JSON.stringify(edited, null, 2));
  v = verifyReclamation(run);
  assert.ok(!v.verified, "edited tombstoneHash fails verify");
  assert.equal(dominantFailureCode(v.checks), "tombstone-chain-broken", "editing the hash chain is tombstone-chain-broken");
  fs.writeFileSync(logPath, original);

  assert.ok(verifyReclamation(run).verified, "restoring the log restores verification");
}

// ===========================================================================
// D — Skeleton fail-closed: an incomplete skeleton refuses and frees ZERO.
// ===========================================================================
{
  const repo = makeRepo();
  const { run } = makeAcceptedRun(repo, "skeleton-incomplete");
  // Delete the authoritative state.json AFTER loading the run in memory: the
  // skeleton can no longer seal stateDigest, so reclamation must refuse.
  fs.rmSync(run.paths.state, { force: true });
  const before = dirBytes(run.paths.runDir);
  assert.throws(
    () => runReclamation(run, { reclaimPolicy: {} }),
    (e) => e instanceof ReclamationError && e.code === "skeleton-incomplete"
  );
  assert.equal(dirBytes(run.paths.runDir), before, "skeleton-incomplete frees zero bytes");
  assert.ok(!fs.existsSync(reclaimedLogPath(run)), "skeleton-incomplete writes no reclaimed.json");
}

// ===========================================================================
// E — Reconstruction: snapshot re-derives from RETAINED inputs to expectDigest.
// ===========================================================================
{
  const repo = makeRepo();
  const built = makeAcceptedRun(repo, "reconstruct");
  const run = built.run;
  const snap = snapshotNode(run, built.resultNodeId, { persist: true });
  saveCheckpoint(run);
  const snapDir = path.join(run.paths.stateNodesDir, "snapshots");
  const reg = new RunRegistry(repo);
  reg.archive("reconstruct", { scope: "repo", reason: "test" });
  const result = reg.gcRun({ scope: "repo", runId: "reconstruct", policy: { keepScratch: true } });
  assert.equal(result.reclaimed.length, 1, "the run was reclaimed");
  assert.equal(result.reclaimed[0].capability, "re-runnable-by-reconstruction", "reconstructable snapshot downgrades to re-runnable-by-reconstruction");
  assert.equal(result.reclaimed[0].capabilityReason, "inputs-and-expectdigest-retained", "matching closed-enum reason");
  // The bulk snapshot artifact is gone from disk.
  const snapFile = path.join(snapDir, fs.readdirSync(snapDir)[0]);
  const stillThere = fs.existsSync(snapFile) ? fs.readdirSync(snapFile).length : 0;
  assert.equal(stillThere, 0, "the snapshot bulk artifact was deleted from disk");

  // run show reports the downgrade with the exact enum.
  const show = reg.showRun("reconstruct", { scope: "repo" });
  assert.equal(show.record.tier, "reclaimed");
  assert.equal(show.record.capability, "re-runnable-by-reconstruction");
  assert.equal(show.record.capabilityReason, "inputs-and-expectdigest-retained");

  // gc verify passes: reconstruction re-derives from the retained node body.
  let verify = reg.gcVerify("reconstruct", { scope: "repo" });
  assert.ok(verify.verified, "reconstructable reclaim verifies");
  assert.ok(verify.checks.some((c) => c.name.startsWith("reconstruct[")), "a reconstruction check ran");

  // Flip ONE retained input byte (mutate the source node body) -> mismatch.
  const fresh = require("../dist/state").loadRunFromCwd("reconstruct", repo);
  const node = fresh.nodes.find((n) => n.id === built.resultNodeId);
  node.status = node.status === "completed" ? "verified" : "completed";
  node.updatedAt = new Date().toISOString();
  saveCheckpoint(fresh);
  verify = reg.gcVerify("reconstruct", { scope: "repo" });
  assert.ok(!verify.verified, "tampering a retained input fails verify");
  assert.equal(dominantFailureCode(verify.checks.map((c) => ({ pass: c.pass, code: c.code }))), "reconstruction-digest-mismatch", "flipping a retained input is reconstruction-digest-mismatch");
  void snap;
}

// ===========================================================================
// F — Eager worker-scratch reclaim: enumerated post-conditions.
// ===========================================================================
{
  const repo = makeRepo();
  const built = makeAcceptedRun(repo, "scratch");
  const run = built.run;
  const sha = (p) => require("node:crypto").createHash("sha256").update(fs.readFileSync(p)).digest("hex");
  const resultsCopy = run.tasks[0].resultPath;
  const resultsShaBefore = sha(resultsCopy);
  const resultNode = run.nodes.find((n) => n.id === built.resultNodeId);
  const evidenceBefore = JSON.stringify(resultNode.evidence);
  const scratchDir = built.scope.workerDir;
  const scratchBytes = dirBytes(scratchDir);
  const workersBefore = dirBytes(run.paths.workersDir);
  assert.ok(scratchBytes > 0, "scratch dir has real bytes");

  const out = runReclamation(run, { reclaimPolicy: { keepSnapshots: true } });
  saveCheckpoint(run);

  // (a) results/<task>.md retained with the SAME sha.
  assert.ok(fs.existsSync(resultsCopy), "results/<task>.md is retained");
  assert.equal(sha(resultsCopy), resultsShaBefore, "results/<task>.md sha is unchanged");
  // (b) result node resolves, snapshot valid (not absent), evidence byte-identical.
  const reloaded = require("../dist/state").loadRunFromCwd("scratch", repo);
  const reNode = reloaded.nodes.find((n) => n.id === built.resultNodeId);
  assert.ok(reNode, "result node still resolves");
  const reSnap = snapshotNode(reloaded, built.resultNodeId, { persist: false });
  assert.equal(loadNodeSnapshot(reloaded, reSnap).freshness, "valid", "result-node snapshot stays valid (no dangling freed path)");
  assert.equal(JSON.stringify(reNode.evidence), evidenceBefore, "result-node evidence is byte-identical");
  // (c) scratch dir gone; the workers/ subtree drops by exactly the scratch size
  // (reclamation also ADDS the tombstone + audit attestation elsewhere — that is
  // append-only history, so we measure the freed subtree, not the whole run dir);
  // freed-manifest records a pre-deletion sha per path.
  assert.ok(!fs.existsSync(scratchDir), "the scratch workerDir no longer exists");
  assert.equal(out.bytesFreed, scratchBytes, "exactly the scratch bytes were freed");
  assert.equal(dirBytes(run.paths.workersDir), workersBefore - scratchBytes, "the workers/ subtree drops by exactly the scratch size");
  assert.ok(out.tombstone.freed.length > 0 && out.tombstone.freed.every((f) => f.sha256.startsWith("sha256:")), "freed-manifest records a pre-deletion sha per path");
  // (d) capability unchanged.
  assert.equal(out.tombstone.capability, "re-runnable", "scratch reclaim leaves capability re-runnable");
  assert.equal(out.tombstone.capabilityReason, "scratch-only-reclaimed", "matching reason");
}

// ===========================================================================
// G — Eligibility refusal with distinct codes; gc plan lists matching reasons.
// ===========================================================================
{
  const repo = makeRepo();
  makeAcceptedRun(repo, "elig-not-archived"); // terminal, NOT archived
  const archived = makeAcceptedRun(repo, "elig-within-retention"); // terminal, archived recently
  makeAcceptedRun(repo, "elig-non-terminal", { pending: true }); // non-terminal
  const reg = new RunRegistry(repo);
  reg.archive("elig-within-retention", { scope: "repo", reason: "test" });

  const cases = [
    ["elig-not-archived", "not-archived", {}],
    ["elig-within-retention", "within-retention", { reclaimAfterArchiveDays: 30 }],
    ["elig-non-terminal", "non-terminal", {}]
  ];
  for (const [runId, code, policy] of cases) {
    const runDir = path.join(repo, ".cw", "runs", runId);
    const before = dirBytes(runDir);
    const res = reg.gcRun({ scope: "repo", runId, policy });
    assert.equal(res.reclaimed.length, 0, `${runId}: nothing reclaimed`);
    assert.deepEqual(res.refused, [{ runId, code }], `${runId}: refused with ${code}`);
    assert.equal(dirBytes(runDir), before, `${runId}: frees zero bytes`);
    assert.ok(!fs.existsSync(path.join(runDir, "reclaimed.json")), `${runId}: no reclaimed.json`);
    const plan = reg.gcPlan({ scope: "repo", runId, policy });
    const entry = plan.entries.find((e) => e.runId === runId);
    assert.ok(entry && !entry.eligible && entry.reason === code, `${runId}: gc plan lists ineligible with ${code}`);
  }
  void archived;
}

process.stdout.write("run-retention-reclamation-smoke: ok\n");
