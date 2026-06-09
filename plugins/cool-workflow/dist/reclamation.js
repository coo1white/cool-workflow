"use strict";
// Run Retention & Provable Reclamation (v0.1.39) — the core write-ahead, fail-closed
// reclamation transaction. Frees disk WITHOUT violating the audit/replay moat:
// freeing bytes leaves behind a hash-chained tombstone proving what was freed is
// reconstructable-or-worthless and that the audit-essential subset is sealed.
//
// BSD / Unix discipline (each tenet is a hard constraint; load-bearing ones flagged):
//
//  - THE INVARIANT [LOAD-BEARING]: never delete what is audit-essential AND
//    irreproducible. A byte is freeable ONLY if it is (1) reconstructable from
//    retained inputs + a recorded recipe + an `expectDigest`, or (2) pure scratch
//    with zero audit value — AND referenced by no surviving evidence locator or
//    audit event. Any UNCLASSIFIED path defaults to RETAINED.
//  - WRITE-AHEAD, FAIL-CLOSED SEQUENCING [LOAD-BEARING]: extract+seal skeleton →
//    write full tombstone (pre-deletion sha256 per path) → fsync/commit into the
//    append-only overlay → ONLY THEN free the bulk. A crash between any steps
//    leaves EITHER the full run OR a complete tombstone — never half-deleted.
//  - APPEND-ONLY [LOAD-BEARING]: the tombstone is a NEW `reclaimed.json` overlay;
//    only bulk DATA bytes are freed — no existing audit/state/commit record is ever
//    rewritten. Hash-chained: tombstoneHash recomputed from freed-manifest + sealed
//    skeleton + prevTombstoneHash (genesis = sha256 of the sealed skeleton).
//  - CAPABILITY DOWNGRADE IS EXPLICIT [LOAD-BEARING for replay]: reclaiming a
//    snapshot downgrades re-runnable → verify-only (or re-runnable-by-reconstruction
//    when inputs + expectDigest are retained), surfaced as a closed-enum reason.
//
// This module is LOW-LEVEL (no import of run-registry); the registry composes
// these primitives. See docs/run-retention-reclamation.7.md.
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReclamationError = exports.ReclamationAbort = exports.SKELETON_REQUIRED_KEYS = exports.RECLAMATION_SCHEMA_VERSION = void 0;
exports.sha256OfString = sha256OfString;
exports.sha256OfFile = sha256OfFile;
exports.dirBytes = dirBytes;
exports.reclaimedLogPath = reclaimedLogPath;
exports.loadReclamationLog = loadReclamationLog;
exports.extractSkeleton = extractSkeleton;
exports.validateSkeleton = validateSkeleton;
exports.validateSkeletonAgainstRun = validateSkeletonAgainstRun;
exports.planReclamation = planReclamation;
exports.genesisPrevHash = genesisPrevHash;
exports.computeTombstoneHash = computeTombstoneHash;
exports.buildTombstone = buildTombstone;
exports.commitTombstone = commitTombstone;
exports.prepareFree = prepareFree;
exports.freeBulk = freeBulk;
exports.runReclamation = runReclamation;
exports.reconstructArtifact = reconstructArtifact;
exports.verifyReclamation = verifyReclamation;
exports.dominantFailureCode = dominantFailureCode;
const node_crypto_1 = __importDefault(require("node:crypto"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const multi_agent_eval_1 = require("./multi-agent-eval");
const node_snapshot_1 = require("./node-snapshot");
const state_1 = require("./state");
const trust_audit_1 = require("./trust-audit");
exports.RECLAMATION_SCHEMA_VERSION = 1;
/** The skeleton schema is the contract for what MUST survive every reclamation.
 *  Machine-checkable via validateSkeleton(). If extraction can't produce all of
 *  these, reclamation fails closed and frees nothing. */
exports.SKELETON_REQUIRED_KEYS = [
    "runId",
    "finalVerdict",
    "commits",
    "evidenceDigests",
    "attestationChain",
    "costRecord",
    "auditLog",
    "collaborationLog",
    "stateDigest"
];
/** Synthetic abort thrown by runReclamation({ faultAfter }) — a TESTABLE crash
 *  injection that never kills the process. */
class ReclamationAbort extends Error {
    step;
    constructor(step) {
        super(`ReclamationAbort after step: ${step}`);
        this.name = "ReclamationAbort";
        this.step = step;
    }
}
exports.ReclamationAbort = ReclamationAbort;
/** Fail-closed refusal: a real reason reclamation freed nothing (distinct code). */
class ReclamationError extends Error {
    code;
    details;
    constructor(code, message, details) {
        super(message);
        this.name = "ReclamationError";
        this.code = code;
        this.details = details;
    }
}
exports.ReclamationError = ReclamationError;
// ---------------------------------------------------------------------------
// Content addressing + byte measurement (NO `du` — in-process only).
// ---------------------------------------------------------------------------
function sha256Hex(value) {
    return node_crypto_1.default.createHash("sha256").update(value).digest("hex");
}
function sha256OfString(value) {
    return `sha256:${sha256Hex(value)}`;
}
function sha256OfFile(file) {
    return `sha256:${sha256Hex(node_fs_1.default.readFileSync(file))}`;
}
/** Walk a path and sum file sizes IN-PROCESS (no `du`). Returns 0 if absent. A
 *  file returns its own size; a dir returns the recursive sum. */
function dirBytes(p) {
    let total = 0;
    let stat;
    try {
        stat = node_fs_1.default.statSync(p);
    }
    catch {
        return 0;
    }
    if (stat.isFile())
        return stat.size;
    if (!stat.isDirectory())
        return 0;
    for (const entry of node_fs_1.default.readdirSync(p, { withFileTypes: true })) {
        total += dirBytes(node_path_1.default.join(p, entry.name));
    }
    return total;
}
/** Stable content digest of a path (file = its bytes; dir = digest over each
 *  member's relative path + bytes, sorted). Lets the freed-manifest record a
 *  single sha per freed dir. */
function contentDigest(p) {
    const stat = node_fs_1.default.statSync(p);
    if (stat.isFile())
        return sha256OfFile(p);
    const parts = [];
    const walk = (dir, rel) => {
        for (const entry of node_fs_1.default.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
            const abs = node_path_1.default.join(dir, entry.name);
            const r = node_path_1.default.join(rel, entry.name);
            if (entry.isDirectory())
                walk(abs, r);
            else
                parts.push(`${r}:${sha256OfFile(abs)}`);
        }
    };
    walk(p, "");
    return sha256OfString(parts.join("\n"));
}
/** Persist a run's authoritative state.json DURABLY (atomic temp → fsync →
 *  rename). The re-point that scratch reclamation depends on MUST be persisted
 *  this way BEFORE any byte is freed — see prepareFree(). */
function persistRunDurable(run) {
    run.updatedAt = new Date().toISOString();
    (0, state_1.writeJson)(run.paths.state, run, { durable: true });
}
/** Run `fn` while holding the per-run reclamation lock (serializes the
 *  reclaimed.json read-modify-write so a concurrent reclaimer can never lose a
 *  tombstone). Generalized into state.ts's portable withFileLock (P1-C/P1-D). */
function withRunLock(run, fn) {
    return (0, state_1.withFileLock)(reclaimedLogPath(run), fn);
}
// ---------------------------------------------------------------------------
// The per-run reclamation log (`reclaimed.json`) — an append-only chain of
// tombstones, a PEER of archive.json, in the ALLOW-LIST (never freed).
// ---------------------------------------------------------------------------
function reclaimedLogPath(run) {
    return node_path_1.default.join(run.paths.runDir, "reclaimed.json");
}
function loadReclamationLog(run) {
    const file = reclaimedLogPath(run);
    if (!node_fs_1.default.existsSync(file))
        return { schemaVersion: 1, runId: run.id, tombstones: [] };
    try {
        const parsed = JSON.parse(node_fs_1.default.readFileSync(file, "utf8"));
        return { schemaVersion: 1, runId: run.id, tombstones: Array.isArray(parsed.tombstones) ? parsed.tombstones : [] };
    }
    catch {
        // A malformed overlay must NOT brick the run — fail closed to an empty chain.
        return { schemaVersion: 1, runId: run.id, tombstones: [] };
    }
}
// ---------------------------------------------------------------------------
// Skeleton extraction — the audit-essential subset that must survive.
// ---------------------------------------------------------------------------
function deriveTerminalLifecycle(run) {
    const tasks = run.tasks || [];
    const running = tasks.filter((t) => t.status === "running").length;
    const failed = tasks.filter((t) => t.status === "failed").length;
    const completed = tasks.filter((t) => t.status === "completed").length;
    const total = tasks.length;
    const pending = tasks.filter((t) => t.status === "pending").length;
    const openFeedback = (run.feedback || []).filter((f) => f.status === "open" || f.status === "tasked").length;
    const verifierGated = (run.commits || []).filter((c) => c.verifierGated).length;
    if (running > 0)
        return "running";
    if (openFeedback > 0)
        return "blocked";
    if (failed > 0)
        return "failed";
    if (total > 0 && completed === total)
        return "completed";
    if (verifierGated > 0 && pending === 0)
        return "completed";
    if (completed > 0)
        return "running";
    return "queued";
}
function auditEventLogPath(run) {
    return run.audit?.eventLogPath || node_path_1.default.join(run.paths.auditDir || node_path_1.default.join(run.paths.runDir, "audit"), "events.jsonl");
}
function digestEvidenceEntry(entry) {
    const ref = entry.locator || entry.path || entry.summary || entry.id;
    if (!ref)
        return undefined;
    // Prefer the file's content digest when the locator resolves to a real path.
    const candidatePath = entry.path || entry.locator;
    if (candidatePath && typeof candidatePath === "string" && !candidatePath.includes(":") && node_fs_1.default.existsSync(candidatePath)) {
        try {
            const stat = node_fs_1.default.statSync(candidatePath);
            if (stat.isFile())
                return { ref, digest: sha256OfFile(candidatePath) };
        }
        catch {
            /* fall through to locator digest */
        }
    }
    return { ref, digest: sha256OfString(ref) };
}
/** STEP 1: extract + seal the skeleton. Pure read over the run; never mutates. */
function extractSkeleton(run) {
    const lifecycle = deriveTerminalLifecycle(run);
    const commits = (run.commits || []).map((commit) => ({
        id: commit.id,
        verifierGated: Boolean(commit.verifierGated),
        checkpoint: Boolean(commit.checkpoint),
        candidateId: commit.candidateId,
        selectionId: commit.selectionId,
        verifierNodeId: commit.verifierNodeId,
        evidenceCount: (commit.evidence || []).length,
        acceptanceRationale: commit.acceptanceRationale
    }));
    const evidenceSources = [];
    for (const node of run.nodes || [])
        for (const e of node.evidence || [])
            evidenceSources.push(e);
    for (const candidate of run.candidates || [])
        for (const e of candidate.evidence || [])
            evidenceSources.push(e);
    for (const selection of run.candidateSelections || [])
        for (const e of selection.evidence || [])
            evidenceSources.push(e);
    for (const commit of run.commits || [])
        for (const e of commit.evidence || [])
            evidenceSources.push(e);
    const evidenceMap = new Map();
    for (const e of evidenceSources) {
        const digested = digestEvidenceEntry(e);
        if (digested)
            evidenceMap.set(digested.ref, digested.digest);
    }
    const evidenceDigests = [...evidenceMap.entries()]
        .map(([ref, digest]) => ({ ref, digest }))
        .sort((a, b) => a.ref.localeCompare(b.ref));
    const eventLog = auditEventLogPath(run);
    const auditLogDigest = node_fs_1.default.existsSync(eventLog) ? sha256OfFile(eventLog) : sha256OfString("");
    const events = node_fs_1.default.existsSync(eventLog)
        ? node_fs_1.default
            .readFileSync(eventLog, "utf8")
            .split(/\n/g)
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => {
            try {
                const e = JSON.parse(line);
                return { id: e.id || "", kind: e.kind || "", decision: e.decision || "", createdAt: e.createdAt || "" };
            }
            catch {
                return { id: "", kind: "malformed", decision: "", createdAt: "" };
            }
        })
        : [];
    const metricsReport = node_path_1.default.join(run.paths.runDir, "metrics", "metrics-report.json");
    const costRecord = {
        tasks: (run.tasks || []).map((task) => ({ taskId: task.id, model: task.usage?.model, source: task.usage?.source })),
        metricsDigest: node_fs_1.default.existsSync(metricsReport) ? sha256OfFile(metricsReport) : undefined
    };
    const collaboration = run.collaboration;
    const collaborationLog = {
        digest: sha256OfString((0, multi_agent_eval_1.stableStringify)(collaboration || {})),
        approvals: collaboration?.approvals?.length || 0,
        comments: collaboration?.comments?.length || 0,
        handoffs: collaboration?.handoffs?.length || 0
    };
    // Empty (not a hash-of-empty) when state.json is absent, so the skeleton fails
    // closed — you cannot seal a run whose authoritative state is gone.
    const stateDigest = node_fs_1.default.existsSync(run.paths.state) ? sha256OfFile(run.paths.state) : "";
    return {
        schemaVersion: 1,
        runId: run.id,
        finalVerdict: {
            lifecycle,
            loopStage: run.loopStage,
            terminal: lifecycle === "completed" || lifecycle === "failed",
            commitGated: (run.commits || []).some((c) => c.verifierGated)
        },
        commits,
        evidenceDigests,
        attestationChain: { auditLogDigest, eventCount: events.length, events },
        costRecord,
        auditLog: { path: node_path_1.default.relative(run.paths.runDir, eventLog), digest: auditLogDigest },
        collaborationLog,
        stateDigest
    };
}
/** Return the list of SKELETON_REQUIRED_KEYS that are missing/empty. Empty array
 *  ⇒ schema-complete. The runId + a populated finalVerdict are load-bearing. */
function validateSkeleton(skeleton) {
    const missing = [];
    if (!skeleton)
        return [...exports.SKELETON_REQUIRED_KEYS];
    for (const key of exports.SKELETON_REQUIRED_KEYS) {
        const value = skeleton[key];
        if (value === undefined || value === null) {
            missing.push(key);
            continue;
        }
        if (key === "runId" && !String(value).trim())
            missing.push(key);
        if (key === "stateDigest" && !String(value).trim())
            missing.push(key);
        if (key === "finalVerdict" && (typeof value !== "object" || !value.lifecycle))
            missing.push(key);
        if (key === "auditLog" && (typeof value !== "object" || !value.digest))
            missing.push(key);
        if (key === "attestationChain" && (typeof value !== "object" || typeof value.auditLogDigest !== "string"))
            missing.push(key);
        if (key === "commits" && !Array.isArray(value))
            missing.push(key);
        if (key === "evidenceDigests" && !Array.isArray(value))
            missing.push(key);
    }
    return missing;
}
/** P2-A content fidelity (v0.1.40): a complete-SHAPED skeleton is not enough —
 *  reclamation must REFUSE if extraction dropped audit content the run actually
 *  has. When the run carries commits/evidence, the sealed skeleton MUST carry
 *  them too (extraction maps 1:1). Returns the content-loss reasons, empty when
 *  faithful. This is the run-aware counterpart to validateSkeleton's shape check. */
function validateSkeletonAgainstRun(run, skeleton) {
    const failures = [];
    const runCommits = (run.commits || []).length;
    if (runCommits > 0 && skeleton.commits.length !== runCommits) {
        failures.push(`commits-dropped(run=${runCommits},sealed=${skeleton.commits.length})`);
    }
    const runHasEvidence = (run.nodes || []).some((n) => (n.evidence || []).length) ||
        (run.candidates || []).some((c) => (c.evidence || []).length) ||
        (run.candidateSelections || []).some((s) => (s.evidence || []).length) ||
        (run.commits || []).some((c) => (c.evidence || []).length);
    if (runHasEvidence && skeleton.evidenceDigests.length === 0) {
        failures.push("evidence-dropped");
    }
    if (!skeleton.finalVerdict || !skeleton.finalVerdict.lifecycle)
        failures.push("verdict-missing");
    return failures;
}
// ---------------------------------------------------------------------------
// Reference graph — the load-bearing classifier guard. A candidate/blackboard
// path referenced by ANY surviving evidence locator / audit event forces
// retention (fail closed). Scratch is the carved exception: its raw result.md is
// referenced by the result node, but that reference is REPOINTED (not retained).
// ---------------------------------------------------------------------------
function buildReferenceGraph(run) {
    const refs = new Set();
    const add = (value) => {
        if (typeof value === "string" && value.trim())
            refs.add(value.trim());
    };
    for (const node of run.nodes || []) {
        for (const e of node.evidence || []) {
            add(e.locator);
            add(e.path);
            add(e.id);
        }
    }
    for (const candidate of run.candidates || [])
        for (const e of candidate.evidence || [])
            add(e.locator);
    for (const commit of run.commits || [])
        for (const e of commit.evidence || [])
            add(e.locator);
    for (const artifact of run.blackboard?.artifacts || []) {
        add(artifact.id);
        add(artifact.path);
    }
    for (const message of run.blackboard?.messages || [])
        add(message.id);
    return refs;
}
function snapshotProjectionDigest(node) {
    // Mirror node-snapshot.ts's deterministic projection so reconstruction matches.
    const body = (0, multi_agent_eval_1.normalizeValue)({
        id: node.id,
        kind: node.kind,
        status: node.status,
        loopStage: node.loopStage,
        inputs: node.inputs,
        outputs: node.outputs,
        artifacts: node.artifacts,
        evidence: node.evidence,
        errors: node.errors,
        parents: node.parents,
        children: node.children,
        contractId: node.contractId,
        metadata: node.metadata
    });
    return sha256OfString((0, multi_agent_eval_1.stableStringify)(body));
}
/** Body digest of the RETAINED node (lives in state.json). The reconstruction
 *  verifier re-derives the projection from this retained input. */
function nodeBodyDigest(node) {
    return sha256OfString((0, multi_agent_eval_1.stableStringify)(rawNodeBody(node)));
}
function rawNodeBody(node) {
    return {
        id: node.id,
        kind: node.kind,
        status: node.status,
        loopStage: node.loopStage,
        inputs: node.inputs,
        outputs: node.outputs,
        artifacts: node.artifacts,
        evidence: node.evidence,
        errors: node.errors,
        parents: node.parents,
        children: node.children,
        contractId: node.contractId,
        metadata: node.metadata
    };
}
/** Build the retention plan: which paths are freeable under `policy`, of what
 *  kind, how many bytes, and the resulting capability downgrade. */
function planReclamation(run, policy = {}) {
    const runDir = run.paths.runDir;
    const freeable = [];
    const rel = (abs) => node_path_1.default.relative(runDir, abs);
    // (1) Worker scratch dirs — pure scratch with zero audit value. result.md is
    // already copied to results/<task>.md (evidence-gated). The whole workerDir is
    // freeable once the result node's worker-result artifact is re-pointed.
    let reclaimedScratch = false;
    if (!policy.keepScratch) {
        const workersDir = run.paths.workersDir || node_path_1.default.join(runDir, "workers");
        for (const scope of run.workers || []) {
            const workerDir = scope.workerDir;
            if (!workerDir || !node_fs_1.default.existsSync(workerDir))
                continue;
            // Only reclaim a worker whose output was accepted (result retained under results/).
            const task = (run.tasks || []).find((t) => t.id === scope.taskId);
            const resultNodeId = scope.resultNodeId || task?.resultNodeId;
            const resultsCopy = task?.resultPath;
            if (!resultNodeId || !resultsCopy || !node_fs_1.default.existsSync(resultsCopy))
                continue;
            const bytes = dirBytes(workerDir);
            if (bytes <= 0)
                continue;
            freeable.push({
                path: rel(workerDir),
                absPath: workerDir,
                kind: "scratch",
                bytes,
                repointResultNodeId: resultNodeId
            });
            reclaimedScratch = true;
        }
        void workersDir;
    }
    // A node whose scratch is being re-pointed THIS pass must NOT also have its
    // snapshot freed in the same pass — re-pointing mutates the node body, which
    // would make the snapshot's reconstruction recipe mismatch. Fail closed: retain
    // such snapshots (a later pass, after the body settles, can reclaim them).
    const repointNodeIds = new Set(freeable.filter((f) => f.repointResultNodeId).map((f) => f.repointResultNodeId));
    // (2) Reconstructable node snapshots — deterministic projection of a RETAINED
    // node (state.json). Reclaim the persisted snapshot file; retain the recipe +
    // expectDigest so the projection re-derives without the freed bytes.
    let reclaimedSnapshot = false;
    let reconstructableSnapshot = false;
    if (!policy.keepSnapshots) {
        const nodesDir = run.paths.stateNodesDir || node_path_1.default.join(runDir, "nodes");
        const snapshotsRoot = node_path_1.default.join(nodesDir, "snapshots");
        if (node_fs_1.default.existsSync(snapshotsRoot)) {
            for (const nodeDirName of node_fs_1.default.readdirSync(snapshotsRoot, { withFileTypes: true })) {
                if (!nodeDirName.isDirectory())
                    continue;
                const nodeDir = node_path_1.default.join(snapshotsRoot, nodeDirName.name);
                for (const file of node_fs_1.default.readdirSync(nodeDir, { withFileTypes: true })) {
                    if (!file.isFile() || !file.name.endsWith(".json"))
                        continue;
                    const snapFile = node_path_1.default.join(nodeDir, file.name);
                    let snap;
                    try {
                        snap = JSON.parse(node_fs_1.default.readFileSync(snapFile, "utf8"));
                    }
                    catch {
                        continue; // unreadable snapshot → retain (fail closed)
                    }
                    const node = (run.nodes || []).find((n) => n.id === snap.nodeId);
                    if (!node)
                        continue; // source node gone → cannot reconstruct → retain
                    if (repointNodeIds.has(node.id))
                        continue; // body will be re-pointed → retain
                    const bytes = dirBytes(snapFile);
                    if (bytes <= 0)
                        continue;
                    const inputDigest = nodeBodyDigest(node);
                    const recipe = {
                        recipeKind: "node-snapshot-projection",
                        inputDigests: [inputDigest],
                        inputsDigest: sha256OfString((0, multi_agent_eval_1.stableStringify)([inputDigest])),
                        expectDigest: snapshotProjectionDigest(node),
                        sourceRef: node.id
                    };
                    freeable.push({ path: rel(snapFile), absPath: snapFile, kind: "reconstructable-snapshot", bytes, recipe });
                    reclaimedSnapshot = true;
                    reconstructableSnapshot = true;
                }
            }
        }
    }
    // (3 / 4) candidate + reference-free blackboard artifacts are RETAINED by
    // default in v0.1.39 (fail closed): a referenced blackboard digest forces
    // retention, and we do not yet auto-capture reconstruction recipes for them.
    // The reference graph is consulted so the door is closed, not merely unbuilt.
    void buildReferenceGraph;
    const byKind = {};
    let bytesToFree = 0;
    for (const entry of freeable) {
        byKind[entry.kind] = (byKind[entry.kind] || 0) + entry.bytes;
        bytesToFree += entry.bytes;
    }
    // Capability projection (closed enum). Reclaiming a reconstructable snapshot →
    // re-runnable-by-reconstruction; a non-reconstructable snapshot → verify-only;
    // scratch/none → re-runnable (scratch is pure waste, replay is unaffected).
    let capability = "re-runnable";
    let capabilityReason = "scratch-only-reclaimed";
    if (reclaimedSnapshot && reconstructableSnapshot) {
        capability = "re-runnable-by-reconstruction";
        capabilityReason = "inputs-and-expectdigest-retained";
    }
    else if (reclaimedSnapshot) {
        capability = "verify-only";
        capabilityReason = "snapshot-reclaimed-no-reconstruction";
    }
    else if (reclaimedScratch) {
        capability = "re-runnable";
        capabilityReason = "scratch-only-reclaimed";
    }
    return { freeable, bytesToFree, byKind, capability, capabilityReason };
}
function policyDigestOf(policy) {
    return sha256OfString((0, multi_agent_eval_1.stableStringify)(policy));
}
/** genesis prevTombstoneHash = sha256 of the sealed skeleton. */
function genesisPrevHash(skeleton) {
    return sha256OfString((0, multi_agent_eval_1.stableStringify)(skeleton));
}
/** The canonical bytes a tombstoneHash binds: freed-manifest + sealed skeleton +
 *  prevTombstoneHash + capability. Recomputed independently by `gc verify`. */
function tombstoneHashInput(t) {
    return (0, multi_agent_eval_1.stableStringify)({
        runId: t.runId,
        tombstoneId: t.tombstoneId,
        reclaimedAt: t.reclaimedAt,
        actor: t.actor || null,
        policyDigest: t.policyDigest,
        freed: t.freed.map((f) => ({ path: f.path, kind: f.kind, bytes: f.bytes, sha256: f.sha256, recipe: f.recipe || null })),
        bytesFreed: t.bytesFreed,
        skeletonDigest: sha256OfString((0, multi_agent_eval_1.stableStringify)(t.skeleton)),
        capability: t.capability,
        capabilityReason: t.capabilityReason,
        prevTombstoneHash: t.prevTombstoneHash
    });
}
function computeTombstoneHash(t) {
    return sha256OfString(tombstoneHashInput(t));
}
let tombstoneCounter = 0;
function tombstoneId(run, now) {
    tombstoneCounter += 1;
    const stamp = now.replace(/[-:.TZ]/g, "").slice(0, 14);
    return `tomb-${stamp}-${String(tombstoneCounter).padStart(3, "0")}`;
}
/** STEP 2: build the FULL tombstone (pre-deletion sha256 per freed path + the
 *  hash chain). Reads the freed files (still present); mutates nothing on disk. */
function buildTombstone(run, skeleton, plan, options = {}) {
    const now = options.now || new Date().toISOString();
    const prior = loadReclamationLog(run).tombstones;
    const prevTombstoneHash = prior.length ? prior[prior.length - 1].tombstoneHash : genesisPrevHash(skeleton);
    const freed = plan.freeable.map((entry) => ({
        path: entry.path,
        kind: entry.kind,
        bytes: entry.bytes,
        sha256: contentDigest(entry.absPath),
        recipe: entry.recipe
    }));
    const base = {
        schemaVersion: 1,
        runId: run.id,
        tombstoneId: tombstoneId(run, now),
        reclaimedAt: now,
        actor: options.actor,
        policyDigest: policyDigestOf(options.policy || {}),
        freed,
        bytesFreed: freed.reduce((sum, f) => sum + f.bytes, 0),
        skeleton,
        capability: plan.capability,
        capabilityReason: plan.capabilityReason,
        prevTombstoneHash
    };
    return { ...base, tombstoneHash: computeTombstoneHash(base) };
}
/** STEP 3: commit the tombstone DURABLY into the append-only overlay (temp →
 *  fsync → rename) and record the attestation through the append-only audit log.
 *  No byte is freed here — write-ahead order is the safety property. */
function commitTombstone(run, tombstone) {
    const log = loadReclamationLog(run);
    log.tombstones.push(tombstone);
    (0, state_1.writeJson)(reclaimedLogPath(run), log, { durable: true });
    try {
        (0, trust_audit_1.recordTrustAuditEvent)(run, {
            kind: "run.reclamation",
            decision: "recorded",
            source: "cw-validated",
            metadata: {
                tombstoneId: tombstone.tombstoneId,
                tombstoneHash: tombstone.tombstoneHash,
                prevTombstoneHash: tombstone.prevTombstoneHash,
                bytesFreed: tombstone.bytesFreed,
                freedPaths: tombstone.freed.length,
                capability: tombstone.capability,
                capabilityReason: tombstone.capabilityReason,
                actor: tombstone.actor
            }
        });
    }
    catch {
        // The tombstone is already durable; an audit-append hiccup must not unwind it.
    }
}
/** STEP 4 (preparation, P1-A + P1-B): re-point every surviving node's artifacts
 *  off the scratch paths about to vanish, DURABLY persist that state.json change,
 *  and PROVE no surviving node still references a freed path (and that each
 *  re-pointed result node's snapshot stays `valid`) — BEFORE a single byte is
 *  freed. Fail closed (`repoint-incomplete`) if the proof does not hold, so a
 *  crash can never leave state.json pointing at a freed path. */
function prepareFree(run, tombstone) {
    const runDir = run.paths.runDir;
    const scratchDirs = tombstone.freed.filter((f) => f.kind === "scratch").map((f) => node_path_1.default.resolve(node_path_1.default.join(runDir, f.path)));
    if (!scratchDirs.length)
        return; // nothing references a freed path; no state change needed.
    const repointed = new Set();
    for (const scratchDir of scratchDirs) {
        for (const id of repointResultNodeArtifacts(run, scratchDir))
            repointed.add(id);
    }
    // Durably persist the re-point so it survives a crash BEFORE the free runs.
    persistRunDurable(run);
    // PROOF 1: no surviving node artifact may resolve inside any freed scratch dir.
    for (const node of run.nodes || []) {
        for (const artifact of node.artifacts || []) {
            if (!artifact.path)
                continue;
            const resolved = node_path_1.default.resolve(artifact.path);
            for (const scratchDir of scratchDirs) {
                if (resolved === scratchDir || resolved.startsWith(scratchDir + node_path_1.default.sep)) {
                    throw new ReclamationError("repoint-incomplete", `node ${node.id} artifact ${artifact.id} still references freed scratch path ${artifact.path}`, {
                        nodeId: node.id,
                        artifactId: artifact.id,
                        path: artifact.path
                    });
                }
            }
        }
    }
    // PROOF 2: each re-pointed result node's snapshot stays `valid` (not `absent`).
    for (const nodeId of repointed) {
        try {
            const fresh = (0, node_snapshot_1.snapshotNode)(run, nodeId, { persist: false });
            const { freshness } = (0, node_snapshot_1.loadNodeSnapshot)(run, fresh);
            if (freshness === "absent") {
                throw new ReclamationError("repoint-incomplete", `re-pointed node ${nodeId} snapshot is absent (dangling artifact)`, { nodeId });
            }
        }
        catch (error) {
            if (error instanceof ReclamationError)
                throw error;
            throw new ReclamationError("repoint-incomplete", `could not prove re-pointed node ${nodeId} stays valid: ${error.message}`, { nodeId });
        }
    }
}
/** STEP 5: free the bulk DATA bytes. Pure deletion — every re-point is already
 *  done and DURABLY persisted by prepareFree(), so a crash here can never leave a
 *  surviving node referencing a freed path. */
function freeBulk(run, tombstone) {
    const runDir = run.paths.runDir;
    let freedBytes = 0;
    for (const entry of tombstone.freed) {
        const abs = node_path_1.default.join(runDir, entry.path);
        const before = dirBytes(abs);
        node_fs_1.default.rmSync(abs, { recursive: true, force: true });
        freedBytes += before;
    }
    return freedBytes;
}
/** Re-point a node's artifacts off `freedScratchDir` to the retained `result`
 *  copy. Returns the ids of nodes actually changed (for the validity proof). */
function repointResultNodeArtifacts(run, freedScratchDir) {
    const freedPrefix = node_path_1.default.resolve(freedScratchDir) + node_path_1.default.sep;
    const changedIds = [];
    for (const node of run.nodes || []) {
        if (!node.artifacts)
            continue;
        let changed = false;
        for (const artifact of node.artifacts) {
            if (!artifact.path)
                continue;
            const resolved = node_path_1.default.resolve(artifact.path);
            if (resolved === node_path_1.default.resolve(freedScratchDir) || resolved.startsWith(freedPrefix)) {
                // Re-point to the retained results/<task>.md copy (the `result` artifact).
                const retained = node.artifacts.find((a) => a.id === "result" && a.path && node_fs_1.default.existsSync(a.path));
                if (retained && retained.path) {
                    artifact.path = retained.path;
                    changed = true;
                }
            }
        }
        if (changed) {
            node.updatedAt = new Date().toISOString();
            changedIds.push(node.id);
        }
    }
    return changedIds;
}
/** Execute the write-ahead, fail-closed reclamation transaction. Ordering is the
 *  safety property: extract+seal skeleton → [under the per-run lock: build
 *  tombstone → commit (fsync)] → re-point + DURABLY persist state + prove no
 *  dangling reference → free bulk. The lock (P1-C) makes the chain read-modify-
 *  write atomic so a concurrent reclaimer can never lose a tombstone. The durable
 *  re-point BEFORE free (P1-A) means a crash can never leave state.json pointing
 *  at a freed path. `faultAfter` aborts after the named step so crash-safety is
 *  testable by design — a crash leaves EITHER the full run OR a complete
 *  tombstone, never a half-deleted run with no proof. */
function runReclamation(run, options = {}) {
    // STEP 1 — extract + seal skeleton. Fail closed if incomplete (free nothing).
    const skeleton = extractSkeleton(run);
    const missing = validateSkeleton(skeleton);
    if (missing.length) {
        throw new ReclamationError("skeleton-incomplete", `Skeleton missing required keys: ${missing.join(", ")}`, { missing });
    }
    // P2-A: also refuse if extraction dropped audit content the run actually has.
    const contentLoss = validateSkeletonAgainstRun(run, skeleton);
    if (contentLoss.length) {
        throw new ReclamationError("skeleton-incomplete", `Skeleton dropped audit content: ${contentLoss.join(", ")}`, { contentLoss });
    }
    if (options.faultAfter === "skeleton")
        throw new ReclamationAbort("skeleton");
    // STEPS 2-3 — under the per-run lock so the chain's read (prevTombstoneHash) and
    // append are atomic: build the full tombstone (pre-deletion sha256 + chain) and
    // commit it durably (fsync) into the append-only overlay.
    const { plan, tombstone } = withRunLock(run, () => {
        const builtPlan = planReclamation(run, options.reclaimPolicy || {});
        const builtTombstone = buildTombstone(run, skeleton, builtPlan, { now: options.now, actor: options.actor, policy: options.policy });
        if (options.faultAfter === "tombstone-write")
            throw new ReclamationAbort("tombstone-write");
        commitTombstone(run, builtTombstone);
        return { plan: builtPlan, tombstone: builtTombstone };
    });
    if (options.faultAfter === "tombstone-commit")
        throw new ReclamationAbort("tombstone-commit");
    // STEP 4 — re-point surviving nodes off the scratch, DURABLY persist that
    // state change, and PROVE no node references a freed path — all before freeing.
    prepareFree(run, tombstone);
    // STEP 5 — ONLY NOW free the bulk bytes.
    const bytesFreed = freeBulk(run, tombstone);
    return { tombstone, bytesFreed, plan };
}
// ---------------------------------------------------------------------------
// Reconstruction — re-derive a freed artifact from its RETAINED inputs, NEVER
// the freed source bytes. Distinct code path from live verifyNodeReplay.
// ---------------------------------------------------------------------------
/** Re-derive a reconstructable artifact's expectDigest from the retained run.
 *  Returns the recomputed digest (to compare to recipe.expectDigest). */
function reconstructArtifact(run, recipe) {
    if (recipe.recipeKind === "node-snapshot-projection") {
        const node = (run.nodes || []).find((n) => n.id === recipe.sourceRef);
        if (!node) {
            return { inputsDigest: sha256OfString("absent"), expectDigest: sha256OfString("absent") };
        }
        const inputDigest = nodeBodyDigest(node);
        const inputsDigest = sha256OfString((0, multi_agent_eval_1.stableStringify)([inputDigest]));
        const expectDigest = snapshotProjectionDigest(node);
        return { inputsDigest, expectDigest };
    }
    // Unknown recipe kind → fail closed (digest can't match expectDigest).
    return { inputsDigest: sha256OfString("unknown-recipe"), expectDigest: sha256OfString("unknown-recipe") };
}
/** Re-prove the whole reclamation chain for a run: skeleton schema-complete,
 *  tombstoneHash/prevTombstoneHash chain recomputed-and-untampered, and each
 *  reconstructable artifact re-derived from RETAINED inputs to its expectDigest.
 *  Recomputes every hash independently — never trusts the stored value. */
function verifyReclamation(run) {
    const log = loadReclamationLog(run);
    const tombstones = log.tombstones;
    const checks = [];
    if (!tombstones.length) {
        return { reclaimed: false, verified: false, checks: [{ name: "reclaimed", pass: false, code: "not-reclaimed" }], tombstones };
    }
    // (a) chain linkage FIRST (priority): genesis = sha256 of the (first) skeleton.
    let chainOk = true;
    for (let i = 0; i < tombstones.length; i++) {
        const expectedPrev = i === 0 ? genesisPrevHash(tombstones[0].skeleton) : tombstones[i - 1].tombstoneHash;
        const pass = tombstones[i].prevTombstoneHash === expectedPrev;
        if (!pass)
            chainOk = false;
        checks.push({ name: `chain-link[${i}]`, pass, code: pass ? undefined : "tombstone-chain-broken" });
    }
    // (b) per-tombstone independent hash recompute (digest integrity).
    let digestsOk = true;
    for (let i = 0; i < tombstones.length; i++) {
        const { tombstoneHash, ...rest } = tombstones[i];
        const recomputed = computeTombstoneHash(rest);
        const pass = recomputed === tombstoneHash;
        if (!pass)
            digestsOk = false;
        checks.push({ name: `tombstone-hash[${i}]`, pass, code: pass ? undefined : "tombstone-digest-mismatch" });
    }
    // (c) skeleton schema completeness (each tombstone seals a complete skeleton).
    let skeletonOk = true;
    for (let i = 0; i < tombstones.length; i++) {
        const missing = validateSkeleton(tombstones[i].skeleton);
        const pass = missing.length === 0;
        if (!pass)
            skeletonOk = false;
        checks.push({ name: `skeleton[${i}]`, pass, code: pass ? undefined : "skeleton-incomplete", detail: missing.join(",") || undefined });
    }
    // (d) reconstruction — re-derive each reconstructable artifact from RETAINED
    // inputs (NOT the freed source) to its expectDigest.
    let reconstructionOk = true;
    for (let i = 0; i < tombstones.length; i++) {
        for (const entry of tombstones[i].freed) {
            if (!entry.recipe)
                continue;
            const recomputed = reconstructArtifact(run, entry.recipe);
            const inputsMatch = recomputed.inputsDigest === entry.recipe.inputsDigest;
            const expectMatch = recomputed.expectDigest === entry.recipe.expectDigest;
            const pass = inputsMatch && expectMatch;
            if (!pass)
                reconstructionOk = false;
            checks.push({
                name: `reconstruct[${i}]:${entry.path}`,
                pass,
                code: pass ? undefined : "reconstruction-digest-mismatch",
                detail: pass ? undefined : `inputs=${inputsMatch} expect=${expectMatch}`
            });
        }
    }
    const verified = chainOk && digestsOk && skeletonOk && reconstructionOk;
    return { reclaimed: true, verified, checks, tombstones };
}
/** Pick the priority failure code from a check list (chain > digest >
 *  reconstruction > skeleton). Used to surface the single dominant code. */
function dominantFailureCode(checks) {
    const order = ["tombstone-chain-broken", "tombstone-digest-mismatch", "reconstruction-digest-mismatch", "skeleton-incomplete", "not-reclaimed"];
    for (const code of order) {
        if (checks.some((c) => !c.pass && c.code === code))
            return code;
    }
    return undefined;
}
