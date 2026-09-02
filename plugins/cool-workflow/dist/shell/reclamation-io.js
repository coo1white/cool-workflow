"use strict";
// shell/reclamation-io.ts — gc plan/run/verify's write-ahead reclamation
// transaction, plus the orphan-run sweep and the clone cache gc.
//
// MILESTONE 10 (PLAN.md (project/docs/rebuild) build order, step 10). Byte-exact port of the
// old build's reclamation, reclamation-hash, run-registry gc/orphans, and
// clones modules. Reuses
// shell/fs-atomic.ts's `withFileLock` directly (no reimplementation, per
// the task's instruction) and core/state/node-projection.ts's
// `replayStableStringify`/`nodeProjectionDigestInput` so the tombstone
// hash-chain input shares the exact same canonical bytes as node-
// snapshot.ts (never re-derived).
//
// WRITE-AHEAD ORDER (the safety property; SPEC/scheduling-registry.md
// section E, "Rebuild risks" #2): extractSkeleton -> validateSkeleton +
// validateSkeletonAgainstRun (refuse skeleton-incomplete) -> under the
// per-run lock: planReclamation + buildTombstone + commitTombstone
// (durable fsync) -> prepareFree (re-point node artifacts off scratch,
// persist state.json durably, prove no dangling reference; refuse
// repoint-incomplete) -> freeBulk. A crash between any two steps leaves
// EITHER the full run OR a complete tombstone, never half-deleted.
//
// tombstoneHash reproducibility: `freeable` MUST be sorted by path bytes
// BEFORE it is hashed (this is exactly what the tombstonesort-*.case.js
// conformance cases pin) — see `planReclamation`'s explicit sort below.
//
// Evidence: SPEC/scheduling-registry.md sections E, F, G; the old build's
// reclamation, reclamation-hash, run-registry gc/orphans, and clones
// modules (byte-exact source).
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_ORPHAN_MIN_AGE_MINUTES = exports.SKELETON_REQUIRED_KEYS = exports.ReclamationAbort = exports.ReclamationError = void 0;
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
exports.verifyReclamation = verifyReclamation;
exports.reclamationPolicy = reclamationPolicy;
exports.reclaimEligibility = reclaimEligibility;
exports.gcPlan = gcPlan;
exports.gcRun = gcRun;
exports.gcVerify = gcVerify;
exports.formatGcPlan = formatGcPlan;
exports.formatGcRun = formatGcRun;
exports.formatGcVerify = formatGcVerify;
exports.listOrphanRuns = listOrphanRuns;
exports.gcOrphanRuns = gcOrphanRuns;
exports.formatOrphanRunsList = formatOrphanRunsList;
exports.formatOrphanRunsGc = formatOrphanRunsGc;
exports.listClones = listClones;
exports.gcClones = gcClones;
exports.formatClonesList = formatClonesList;
exports.formatClonesGc = formatClonesGc;
const fs = __importStar(require("node:fs"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const fs_atomic_1 = require("./fs-atomic");
const trust_audit_1 = require("./trust-audit");
const node_store_1 = require("./node-store");
const node_snapshot_1 = require("../core/state/node-snapshot");
const node_projection_1 = require("../core/state/node-projection");
const hash_1 = require("../core/hash");
const collate_1 = require("../core/util/collate");
const run_registry_io_1 = require("./run-registry-io");
// ---------------------------------------------------------------------------
// Content addressing + byte measurement (in-process, no `du`) — carried
// forward from reclamation hash module.
// ---------------------------------------------------------------------------
function sha256OfString(value) {
    return (0, hash_1.sha256)(value);
}
function sha256OfFile(file) {
    return `sha256:${(0, hash_1.sha256Bytes)(fs.readFileSync(file))}`;
}
/** Walk a path and sum file sizes IN-PROCESS. Returns 0 if absent. */
function dirBytes(p) {
    let stat;
    try {
        stat = fs.statSync(p);
    }
    catch {
        return 0;
    }
    if (stat.isFile())
        return stat.size;
    if (!stat.isDirectory())
        return 0;
    let total = 0;
    for (const entry of fs.readdirSync(p, { withFileTypes: true })) {
        total += dirBytes(path.join(p, entry.name));
    }
    return total;
}
/** Stable content digest of a path (file = its bytes; dir = digest over
 *  each member's relative path + bytes, sorted). */
function contentDigest(p) {
    const stat = fs.statSync(p);
    if (stat.isFile())
        return sha256OfFile(p);
    const parts = [];
    const walk = (dir, rel) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (0, run_registry_io_1.compareBytes)(a.name, b.name))) {
            const abs = path.join(dir, entry.name);
            const r = path.join(rel, entry.name);
            if (entry.isDirectory())
                walk(abs, r);
            else
                parts.push(`${r}:${sha256OfFile(abs)}`);
        }
    };
    walk(p, "");
    return sha256OfString(parts.join("\n"));
}
/** Fail-closed refusal: a real reason reclamation froze nothing. */
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
/** Synthetic abort thrown by runReclamation({ faultAfter }) — a TESTABLE
 *  crash injection that never kills the process. */
class ReclamationAbort extends Error {
    step;
    constructor(step) {
        super(`ReclamationAbort after step: ${step}`);
        this.name = "ReclamationAbort";
        this.step = step;
    }
}
exports.ReclamationAbort = ReclamationAbort;
exports.SKELETON_REQUIRED_KEYS = [
    "runId",
    "finalVerdict",
    "commits",
    "evidenceDigests",
    "attestationChain",
    "costRecord",
    "auditLog",
    "collaborationLog",
    "stateDigest",
];
/** Same lock every other state.json writer holds (saveCheckpoint,
 *  withRunStateLock — shell/run-store.ts) across its write, so a GC pass's
 *  persist can never land invisibly inside another writer's critical
 *  section. */
function persistRunDurable(run) {
    (0, fs_atomic_1.withFileLock)(run.paths.state, () => {
        run.updatedAt = new Date().toISOString();
        (0, fs_atomic_1.writeJson)(run.paths.state, run, { durable: true });
    });
}
function withRunLock(run, fn) {
    return (0, fs_atomic_1.withFileLock)(reclaimedLogPath(run), fn);
}
function reclaimedLogPath(run) {
    return path.join(run.paths.runDir, "reclaimed.json");
}
/** Fail-OPEN on absence/corruption: a malformed overlay must never brick
 *  the run (SPEC/scheduling-registry.md "Rebuild risks" #1). */
function loadReclamationLog(run) {
    const file = reclaimedLogPath(run);
    if (!fs.existsSync(file))
        return { schemaVersion: 1, runId: run.id, tombstones: [] };
    try {
        const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
        if (!parsed || typeof parsed !== "object" || parsed.schemaVersion !== 1 || !Array.isArray(parsed.tombstones)) {
            return { schemaVersion: 1, runId: run.id, tombstones: [], corrupted: true };
        }
        return { schemaVersion: 1, runId: run.id, tombstones: parsed.tombstones };
    }
    catch {
        return { schemaVersion: 1, runId: run.id, tombstones: [], corrupted: true };
    }
}
// ---------------------------------------------------------------------------
// Skeleton extraction
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
    return run.audit?.eventLogPath || path.join(run.paths.auditDir || path.join(run.paths.runDir, "audit"), "events.jsonl");
}
function digestEvidenceEntry(entry) {
    const ref = entry.locator || entry.path || entry.summary || entry.id;
    if (!ref)
        return undefined;
    const candidatePath = entry.path || entry.locator;
    if (candidatePath && typeof candidatePath === "string" && !candidatePath.includes(":") && fs.existsSync(candidatePath)) {
        try {
            const stat = fs.statSync(candidatePath);
            if (stat.isFile())
                return { ref, digest: sha256OfFile(candidatePath) };
        }
        catch {
            /* fall through to locator digest */
        }
    }
    return { ref, digest: sha256OfString(ref) };
}
/** STEP 1: extract + seal the skeleton. Pure read over the run; never
 *  mutates. */
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
        acceptanceRationale: commit.acceptanceRationale,
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
    const evidenceDigests = [...evidenceMap.entries()].map(([ref, digest]) => ({ ref, digest })).sort((a, b) => (0, run_registry_io_1.compareBytes)(a.ref, b.ref));
    const eventLog = auditEventLogPath(run);
    const auditLogDigest = fs.existsSync(eventLog) ? sha256OfFile(eventLog) : sha256OfString("");
    const events = fs.existsSync(eventLog)
        ? fs
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
    const metricsReport = path.join(run.paths.runDir, "metrics", "metrics-report.json");
    const costRecord = {
        tasks: (run.tasks || []).map((task) => ({ taskId: task.id, model: task.model, source: task.agentType })),
        metricsDigest: fs.existsSync(metricsReport) ? sha256OfFile(metricsReport) : undefined,
    };
    const collaboration = run.collaboration;
    const collaborationLog = {
        digest: sha256OfString((0, node_projection_1.replayStableStringify)(collaboration || {})),
        approvals: collaboration?.approvals?.length || 0,
        comments: collaboration?.comments?.length || 0,
        handoffs: collaboration?.handoffs?.length || 0,
    };
    const stateDigest = fs.existsSync(run.paths.state) ? sha256OfFile(run.paths.state) : "";
    return {
        schemaVersion: 1,
        runId: run.id,
        finalVerdict: {
            lifecycle,
            loopStage: run.loopStage,
            terminal: lifecycle === "completed" || lifecycle === "failed",
            commitGated: (run.commits || []).some((c) => c.verifierGated),
        },
        commits,
        evidenceDigests,
        attestationChain: { auditLogDigest, eventCount: events.length, events },
        costRecord,
        auditLog: { path: path.relative(run.paths.runDir, eventLog), digest: auditLogDigest },
        collaborationLog,
        stateDigest,
    };
}
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
/** Refuse if extraction dropped audit content the run actually has. */
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
function snapshotProjectionDigest(node) {
    return sha256OfString((0, node_projection_1.nodeProjectionDigestInput)(node));
}
function nodeBodyDigest(node) {
    return sha256OfString((0, node_projection_1.nodeProjectionDigestInput)(node));
}
/** Build the retention plan: which paths are freeable under `policy`, of
 *  what kind, how many bytes, and the resulting capability downgrade. */
function planReclamation(run, policy = {}) {
    const runDir = run.paths.runDir;
    const freeable = [];
    const rel = (abs) => path.relative(runDir, abs);
    // (1) Worker scratch dirs — pure scratch with zero audit value.
    let reclaimedScratch = false;
    if (!policy.keepScratch) {
        for (const scope of run.workers || []) {
            const workerDir = scope.workerDir;
            if (!workerDir || !fs.existsSync(workerDir))
                continue;
            const task = (run.tasks || []).find((t) => t.id === scope.taskId);
            const resultNodeId = scope.resultNodeId || task?.resultNodeId;
            const resultsCopy = task?.resultPath;
            if (!resultNodeId || !resultsCopy || !fs.existsSync(resultsCopy))
                continue;
            const bytes = dirBytes(workerDir);
            if (bytes <= 0)
                continue;
            freeable.push({ path: rel(workerDir), absPath: workerDir, kind: "scratch", bytes, repointResultNodeId: resultNodeId });
            reclaimedScratch = true;
        }
    }
    const repointNodeIds = new Set(freeable.filter((f) => f.repointResultNodeId).map((f) => f.repointResultNodeId));
    // (2) Reconstructable node snapshots.
    let reclaimedSnapshot = false;
    let reconstructableSnapshot = false;
    if (!policy.keepSnapshots) {
        const nodesDir = run.paths.stateNodesDir || path.join(runDir, "nodes");
        const snapshotsRoot = path.join(nodesDir, "snapshots");
        if (fs.existsSync(snapshotsRoot)) {
            for (const nodeDirName of fs.readdirSync(snapshotsRoot, { withFileTypes: true })) {
                if (!nodeDirName.isDirectory())
                    continue;
                const nodeDir = path.join(snapshotsRoot, nodeDirName.name);
                for (const file of fs.readdirSync(nodeDir, { withFileTypes: true })) {
                    if (!file.isFile() || !file.name.endsWith(".json"))
                        continue;
                    const snapFile = path.join(nodeDir, file.name);
                    let snap;
                    try {
                        snap = JSON.parse(fs.readFileSync(snapFile, "utf8"));
                    }
                    catch {
                        continue;
                    }
                    if (!snap || typeof snap !== "object" || typeof snap.nodeId !== "string")
                        continue;
                    const nodeId = snap.nodeId;
                    const node = (run.nodes || []).find((n) => n.id === nodeId);
                    if (!node)
                        continue;
                    if (repointNodeIds.has(node.id))
                        continue;
                    const bytes = dirBytes(snapFile);
                    if (bytes <= 0)
                        continue;
                    const inputDigest = nodeBodyDigest(node);
                    const recipe = {
                        recipeKind: "node-snapshot-projection",
                        inputDigests: [inputDigest],
                        inputsDigest: sha256OfString((0, node_projection_1.replayStableStringify)([inputDigest])),
                        expectDigest: snapshotProjectionDigest(node),
                        sourceRef: node.id,
                    };
                    freeable.push({ path: rel(snapFile), absPath: snapFile, kind: "reconstructable-snapshot", bytes, recipe });
                    reclaimedSnapshot = true;
                    reconstructableSnapshot = true;
                }
            }
        }
    }
    // (3) Superseded, non-verifier-gated commit snapshots. Each commitState()
    // call writes only the commit's own small record into commits/<id>.json
    // (not the whole run), but these files still add up over a long run with
    // no reclamation path today. Only the run's LATEST commit and any
    // verifier-gated commit (the actual audit-significant milestones) are
    // kept — an intermediate, non-gated "checkpoint" commit's only value is
    // as a point-in-time snapshot, and state.json (not commits/) is the
    // source of truth for resume. Treated as not reconstructable (no recipe)
    // on purpose, kept conservative: a commit snapshot is not offered a
    // projection path derivable from retained data.
    let reclaimedCommitSnapshot = false;
    if (!policy.keepCommits) {
        const commits = run.commits || [];
        for (let i = 0; i < commits.length - 1; i++) {
            const commit = commits[i];
            if (commit.verifierGated)
                continue;
            if (!commit.snapshotPath || !fs.existsSync(commit.snapshotPath))
                continue;
            const bytes = dirBytes(commit.snapshotPath);
            if (bytes <= 0)
                continue;
            freeable.push({ path: rel(commit.snapshotPath), absPath: commit.snapshotPath, kind: "commit-snapshot", bytes });
            reclaimedCommitSnapshot = true;
        }
    }
    // Determinism (HARD constraint): sort by path BEFORE anything hashes it,
    // so tombstoneHash is reproducible across hosts regardless of
    // fs.readdirSync's filesystem-dependent order.
    freeable.sort((a, b) => (0, run_registry_io_1.compareBytes)(a.path, b.path));
    const byKind = {};
    let bytesToFree = 0;
    for (const entry of freeable) {
        byKind[entry.kind] = (byKind[entry.kind] || 0) + entry.bytes;
        bytesToFree += entry.bytes;
    }
    let capability = "re-runnable";
    let capabilityReason = "scratch-only-reclaimed";
    // A reclaimed commit snapshot is never reconstructable (a genuine
    // point-in-time capture, no recipe) — it caps capability at "verify-only"
    // regardless of what node-snapshot reclamation achieved, same as an
    // unreconstructable node snapshot would.
    if (reclaimedCommitSnapshot) {
        capability = "verify-only";
        capabilityReason = "snapshot-reclaimed-no-reconstruction";
    }
    else if (reclaimedSnapshot && reconstructableSnapshot) {
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
// ---------------------------------------------------------------------------
// Tombstone construction + hash chain
// ---------------------------------------------------------------------------
function policyDigestOf(policy) {
    return sha256OfString((0, node_projection_1.replayStableStringify)(policy));
}
/** genesis prevTombstoneHash = sha256 of the sealed skeleton. */
function genesisPrevHash(skeleton) {
    return sha256OfString((0, node_projection_1.replayStableStringify)(skeleton));
}
function tombstoneHashInput(t) {
    return (0, node_projection_1.replayStableStringify)({
        runId: t.runId,
        tombstoneId: t.tombstoneId,
        reclaimedAt: t.reclaimedAt,
        actor: t.actor || null,
        policyDigest: t.policyDigest,
        freed: t.freed.map((f) => ({ path: f.path, kind: f.kind, bytes: f.bytes, sha256: f.sha256, recipe: f.recipe || null })),
        bytesFreed: t.bytesFreed,
        skeletonDigest: sha256OfString((0, node_projection_1.replayStableStringify)(t.skeleton)),
        capability: t.capability,
        capabilityReason: t.capabilityReason,
        prevTombstoneHash: t.prevTombstoneHash,
    });
}
function computeTombstoneHash(t) {
    return sha256OfString(tombstoneHashInput(t));
}
function tombstoneId(seq) {
    return `tomb-${String(seq).padStart(3, "0")}`;
}
/** STEP 2: build the FULL tombstone (pre-deletion sha256 per freed path +
 *  the hash chain). Reads the freed files (still present); mutates
 *  nothing on disk. */
function buildTombstone(run, skeleton, plan, options = {}) {
    const now = options.now || new Date().toISOString();
    const priorLog = loadReclamationLog(run);
    // Fail closed, not open: a CORRUPTED log must never be read as "no prior
    // tombstones" — that reading is only correct for a genuinely absent file.
    // Minting a fresh genesis tombstone over a corrupted log would durably
    // overwrite it (commitTombstone), destroying whatever history the
    // corruption hid. This is defense in depth on top of reclaimEligibility's
    // own "reclamation-log-corrupted" refusal — direct callers of
    // buildTombstone are stopped here too.
    if (priorLog.corrupted) {
        throw new ReclamationError("reclamation-log-corrupted", `Refusing to build a tombstone: ${reclaimedLogPath(run)} exists but failed to parse/validate. Restore or manually inspect it before reclaiming this run.`, { runId: run.id });
    }
    const prior = priorLog.tombstones;
    const prevTombstoneHash = prior.length ? prior[prior.length - 1].tombstoneHash : genesisPrevHash(skeleton);
    const freed = plan.freeable.map((entry) => ({
        path: entry.path,
        kind: entry.kind,
        bytes: entry.bytes,
        sha256: contentDigest(entry.absPath),
        recipe: entry.recipe,
    }));
    const base = {
        schemaVersion: 1,
        runId: run.id,
        tombstoneId: tombstoneId(prior.length + 1),
        reclaimedAt: now,
        actor: options.actor,
        policyDigest: policyDigestOf(options.policy || {}),
        freed,
        bytesFreed: freed.reduce((sum, f) => sum + f.bytes, 0),
        skeleton,
        capability: plan.capability,
        capabilityReason: plan.capabilityReason,
        prevTombstoneHash,
    };
    return { ...base, tombstoneHash: computeTombstoneHash(base) };
}
/** STEP 3: commit the tombstone DURABLY into the append-only overlay
 *  (temp -> fsync -> rename) and record the attestation. No byte is freed
 *  here — write-ahead order is the safety property. */
function commitTombstone(run, tombstone) {
    const log = loadReclamationLog(run);
    log.tombstones.push(tombstone);
    (0, fs_atomic_1.writeJson)(reclaimedLogPath(run), log, { durable: true });
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
                actor: tombstone.actor,
            },
        });
    }
    catch {
        // The tombstone is already durable; an audit-append hiccup must not unwind it.
    }
}
/** STEP 4: re-point every surviving node's artifacts off the scratch
 *  paths about to vanish, DURABLY persist that state.json change, and
 *  PROVE no surviving node still references a freed path — BEFORE a
 *  single byte is freed. Fail closed (`repoint-incomplete`) if the proof
 *  does not hold. */
function prepareFree(run, tombstone) {
    const runDir = run.paths.runDir;
    const scratchDirs = tombstone.freed.filter((f) => f.kind === "scratch").map((f) => (0, fs_atomic_1.realResolve)(path.join(runDir, f.path)));
    const commitSnapshotPaths = tombstone.freed.filter((f) => f.kind === "commit-snapshot").map((f) => (0, fs_atomic_1.realResolve)(path.join(runDir, f.path)));
    if (!scratchDirs.length && !commitSnapshotPaths.length)
        return;
    const repointed = new Set();
    for (const scratchDir of scratchDirs) {
        for (const id of repointResultNodeArtifacts(run, scratchDir))
            repointed.add(id);
    }
    // Unlike scratch (which has a retained "result" artifact to repoint to),
    // a reclaimed commit snapshot has no surviving alternative — its OWN
    // StateNode's "snapshot" artifact (recordCommitNode, shell/commit.ts) is
    // the only reference to it, so it is stripped outright rather than
    // repointed. node.outputs.snapshotPath (a plain metadata string, not an
    // artifact the check below inspects) is left as a historical record,
    // same as commit.snapshotPath itself staying in state.json.
    stripCommitSnapshotArtifacts(run, commitSnapshotPaths);
    persistRunDurable(run);
    for (const node of run.nodes || []) {
        for (const artifact of node.artifacts || []) {
            if (!artifact.path)
                continue;
            const resolved = (0, fs_atomic_1.realResolve)(artifact.path);
            for (const scratchDir of scratchDirs) {
                if (resolved === scratchDir || resolved.startsWith(scratchDir + path.sep)) {
                    throw new ReclamationError("repoint-incomplete", `node ${node.id} artifact ${artifact.id} still references freed scratch path ${artifact.path}`, { nodeId: node.id, artifactId: artifact.id, path: artifact.path });
                }
            }
            if (commitSnapshotPaths.includes(resolved)) {
                throw new ReclamationError("repoint-incomplete", `node ${node.id} artifact ${artifact.id} still references freed commit snapshot ${artifact.path}`, { nodeId: node.id, artifactId: artifact.id, path: artifact.path });
            }
        }
    }
    for (const nodeId of repointed) {
        try {
            const fresh = (0, node_store_1.snapshotNode)(run, nodeId, { persist: false });
            const { freshness } = (0, node_snapshot_1.loadNodeSnapshot)(run, fresh, fs.existsSync);
            if (freshness === "absent") {
                throw new ReclamationError("repoint-incomplete", `re-pointed node ${nodeId} snapshot is absent (dangling artifact)`, { nodeId });
            }
        }
        catch (error) {
            if (error instanceof ReclamationError)
                throw error;
            throw new ReclamationError("repoint-incomplete", `could not prove re-pointed node ${nodeId} stays valid: ${error.message}`, {
                nodeId,
            });
        }
    }
}
/** STEP 5: free the bulk DATA bytes. Pure deletion — every re-point is
 *  already done and DURABLY persisted by prepareFree(). */
function freeBulk(run, tombstone) {
    const runDir = run.paths.runDir;
    let freedBytes = 0;
    for (const entry of tombstone.freed) {
        const abs = path.join(runDir, entry.path);
        // planReclamation always derives entry.path as a relative path already
        // confined under runDir, but a tampered/imported state.json could carry a
        // worker/artifact path that resolves outside it — re-check containment
        // right before the recursive delete so that can never turn into an
        // out-of-tree rmSync.
        if (!(0, fs_atomic_1.isContainedPath)(abs, runDir)) {
            throw new ReclamationError("unsafe-free-path", `refusing to free path outside the run directory: ${entry.path}`, {
                path: entry.path,
            });
        }
        const before = dirBytes(abs);
        fs.rmSync(abs, { recursive: true, force: true });
        freedBytes += before;
    }
    return freedBytes;
}
function repointResultNodeArtifacts(run, freedScratchDir) {
    const freedReal = (0, fs_atomic_1.realResolve)(freedScratchDir);
    const freedPrefix = freedReal + path.sep;
    const changedIds = [];
    for (const node of run.nodes || []) {
        if (!node.artifacts)
            continue;
        let changed = false;
        for (const artifact of node.artifacts) {
            if (!artifact.path)
                continue;
            const resolved = (0, fs_atomic_1.realResolve)(artifact.path);
            if (resolved === freedReal || resolved.startsWith(freedPrefix)) {
                const retained = node.artifacts.find((a) => a.id === "result" && a.path && fs.existsSync(a.path));
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
/** Removes the "snapshot" artifact entry from any node that references one
 *  of `freedCommitSnapshotPaths` — there is no retained alternative to
 *  repoint to (unlike a scratch dir's "result" copy), so the reference is
 *  dropped outright. StateArtifact.path is a required string, so the
 *  artifact entry is filtered out rather than nulled. */
function stripCommitSnapshotArtifacts(run, freedCommitSnapshotPaths) {
    if (!freedCommitSnapshotPaths.length)
        return [];
    const freedSet = new Set(freedCommitSnapshotPaths);
    const changedIds = [];
    for (const node of run.nodes || []) {
        if (!node.artifacts || !node.artifacts.length)
            continue;
        const before = node.artifacts.length;
        node.artifacts = node.artifacts.filter((artifact) => !artifact.path || !freedSet.has((0, fs_atomic_1.realResolve)(artifact.path)));
        if (node.artifacts.length !== before) {
            node.updatedAt = new Date().toISOString();
            changedIds.push(node.id);
        }
    }
    return changedIds;
}
/** Execute the write-ahead, fail-closed reclamation transaction. */
function runReclamation(run, options = {}) {
    const skeleton = extractSkeleton(run);
    const missing = validateSkeleton(skeleton);
    if (missing.length) {
        throw new ReclamationError("skeleton-incomplete", `Skeleton missing required keys: ${missing.join(", ")}`, { missing });
    }
    const contentLoss = validateSkeletonAgainstRun(run, skeleton);
    if (contentLoss.length) {
        throw new ReclamationError("skeleton-incomplete", `Skeleton dropped audit content: ${contentLoss.join(", ")}`, { contentLoss });
    }
    if (options.faultAfter === "skeleton")
        throw new ReclamationAbort("skeleton");
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
    prepareFree(run, tombstone);
    const bytesFreed = freeBulk(run, tombstone);
    return { tombstone, bytesFreed, plan };
}
// ---------------------------------------------------------------------------
// Reconstruction + verification
// ---------------------------------------------------------------------------
function reconstructArtifact(run, recipe) {
    if (recipe.recipeKind === "node-snapshot-projection") {
        const node = (run.nodes || []).find((n) => n.id === recipe.sourceRef);
        if (!node) {
            return { inputsDigest: sha256OfString("absent"), expectDigest: sha256OfString("absent") };
        }
        const inputDigest = nodeBodyDigest(node);
        const inputsDigest = sha256OfString((0, node_projection_1.replayStableStringify)([inputDigest]));
        const expectDigest = snapshotProjectionDigest(node);
        return { inputsDigest, expectDigest };
    }
    return { inputsDigest: sha256OfString("unknown-recipe"), expectDigest: sha256OfString("unknown-recipe") };
}
/** Re-prove the whole reclamation chain for a run. Recomputes every hash
 *  independently — never trusts the stored value. */
function verifyReclamation(run) {
    const log = loadReclamationLog(run);
    const tombstones = log.tombstones;
    const checks = [];
    if (log.corrupted) {
        // Distinct from "not-reclaimed": a corrupted log means the run's
        // reclamation status genuinely cannot be read, not that it was never
        // reclaimed. Reporting "not-reclaimed" here would look identical to the
        // honest empty-log case and hide the corruption from an operator running
        // `cw gc verify` directly.
        return {
            reclaimed: false,
            verified: false,
            checks: [{ name: "reclaimed", pass: false, code: "reclamation-log-corrupted", detail: `${reclaimedLogPath(run)} exists but failed to parse/validate` }],
            tombstones,
        };
    }
    if (!tombstones.length) {
        return { reclaimed: false, verified: false, checks: [{ name: "reclaimed", pass: false, code: "not-reclaimed" }], tombstones };
    }
    let chainOk = true;
    for (let i = 0; i < tombstones.length; i++) {
        const expectedPrev = i === 0 ? genesisPrevHash(tombstones[0].skeleton) : tombstones[i - 1].tombstoneHash;
        const pass = tombstones[i].prevTombstoneHash === expectedPrev;
        if (!pass)
            chainOk = false;
        checks.push({ name: `chain-link[${i}]`, pass, code: pass ? undefined : "tombstone-chain-broken" });
    }
    let digestsOk = true;
    for (let i = 0; i < tombstones.length; i++) {
        const { tombstoneHash, ...rest } = tombstones[i];
        const recomputed = computeTombstoneHash(rest);
        const pass = recomputed === tombstoneHash;
        if (!pass)
            digestsOk = false;
        checks.push({ name: `tombstone-hash[${i}]`, pass, code: pass ? undefined : "tombstone-digest-mismatch" });
    }
    let skeletonOk = true;
    for (let i = 0; i < tombstones.length; i++) {
        const missing = validateSkeleton(tombstones[i].skeleton);
        const pass = missing.length === 0;
        if (!pass)
            skeletonOk = false;
        checks.push({ name: `skeleton[${i}]`, pass, code: pass ? undefined : "skeleton-incomplete", detail: missing.join(",") || undefined });
    }
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
                detail: pass ? undefined : `inputs=${inputsMatch} expect=${expectMatch}`,
            });
        }
    }
    const verified = chainOk && digestsOk && skeletonOk && reconstructionOk;
    return { reclaimed: true, verified, checks, tombstones };
}
function reclamationPolicy(overrides = {}) {
    return { ...run_registry_io_1.DEFAULT_RUN_REGISTRY_POLICY, ...overrides };
}
/** Fail-closed eligibility, checked IN ORDER (SPEC "Rebuild risks" #6):
 *  reclamation-log-corrupted -> already-reclaimed -> non-terminal ->
 *  open-feedback -> not-archived -> within-retention. `null` means eligible.
 *
 *  reclamation-log-corrupted is checked FIRST, ahead of even
 *  already-reclaimed: record.tier is derived from the same corrupted
 *  reclaimed.json (loadReclaimedFromDir), so a corrupted log makes `tier`
 *  itself unreliable — it reads "live", not "reclaimed", exactly the
 *  reading that would let a run past the already-reclaimed gate and into a
 *  destructive re-reclaim (self-audit-cool-workflow-v0.2.6.md P2). */
function reclaimEligibility(record, policy, nowMs) {
    if (record.reclamationLogCorrupted)
        return "reclamation-log-corrupted";
    if (record.tier === "reclaimed")
        return "already-reclaimed";
    const terminalStates = policy.reclaimStates && policy.reclaimStates.length ? policy.reclaimStates : ["completed", "failed"];
    if (record.derivedLifecycle !== "completed" && record.derivedLifecycle !== "failed")
        return "non-terminal";
    if (!terminalStates.includes(record.derivedLifecycle))
        return "non-terminal";
    if (record.openFeedbackCount > 0)
        return "open-feedback";
    if (!record.archived)
        return "not-archived";
    const days = policy.reclaimAfterArchiveDays ?? 0;
    if (days > 0) {
        const archivedAtMs = record.archivedAt ? Date.parse(record.archivedAt) : NaN;
        if (!Number.isFinite(archivedAtMs))
            return "within-retention";
        if (archivedAtMs > nowMs - days * 24 * 60 * 60 * 1000)
            return "within-retention";
    }
    return null;
}
function recordsForRunId(host, runId, scope) {
    const located = host.locate(runId, scope);
    return located ? [located.record] : [];
}
function gcPlan(host, options = {}) {
    const scope = options.scope || "home";
    const policy = reclamationPolicy(options.policy);
    const nowIso = options.now || new Date().toISOString();
    const nowMs = Date.parse(nowIso);
    const records = options.runId ? recordsForRunId(host, options.runId, scope) : host.buildIndex(scope).records;
    const entries = [];
    let bytesToFree = 0;
    let eligibleCount = 0;
    for (const record of records) {
        const refusal = reclaimEligibility(record, policy, nowMs);
        let plan;
        try {
            const run = host.loadRun(record.repo, record.runId);
            plan = planReclamation(run, { keepScratch: policy.keepScratch, keepSnapshots: policy.keepSnapshots, keepCommits: policy.keepCommits });
        }
        catch {
            entries.push({
                runId: record.runId,
                repo: record.repo,
                eligible: false,
                reason: "unreadable",
                tier: record.tier || "live",
                capability: record.capability || "re-runnable",
                capabilityReason: record.capabilityReason || "live-full",
                bytesToFree: 0,
                byKind: {},
                freeable: [],
            });
            continue;
        }
        const eligible = refusal === null;
        const entry = {
            runId: record.runId,
            repo: record.repo,
            eligible,
            reason: eligible ? "eligible" : refusal,
            tier: record.tier || "live",
            capability: plan.capability,
            capabilityReason: plan.capabilityReason,
            bytesToFree: eligible ? plan.bytesToFree : 0,
            byKind: eligible ? plan.byKind : {},
            freeable: eligible ? plan.freeable.map((f) => ({ path: f.path, kind: f.kind, bytes: f.bytes })) : [],
        };
        entries.push(entry);
        if (eligible) {
            eligibleCount += 1;
            bytesToFree += plan.bytesToFree;
        }
    }
    return {
        schemaVersion: 1,
        scope,
        generatedAt: nowIso,
        policy: {
            reclaimAfterArchiveDays: policy.reclaimAfterArchiveDays ?? 0,
            keepSnapshots: Boolean(policy.keepSnapshots),
            keepScratch: Boolean(policy.keepScratch),
            keepCommits: Boolean(policy.keepCommits),
            reclaimStates: policy.reclaimStates && policy.reclaimStates.length ? policy.reclaimStates : ["completed", "failed"],
        },
        total: entries.length,
        eligibleCount,
        bytesToFree,
        entries,
        nextAction: eligibleCount ? "cw gc run" : "cw run search",
    };
}
function gcRun(host, options = {}) {
    const scope = options.scope || "home";
    const policy = reclamationPolicy(options.policy);
    const nowIso = options.now || new Date().toISOString();
    const nowMs = Date.parse(nowIso);
    const records = options.runId ? recordsForRunId(host, options.runId, scope) : host.buildIndex(scope).records;
    const maxRuns = options.limit ?? (policy.maxReclaimRuns || 0);
    const maxBytes = policy.maxReclaimBytes || 0;
    const reclaimed = [];
    const refused = [];
    let totalBytesFreed = 0;
    for (const record of records) {
        const refusal = reclaimEligibility(record, policy, nowMs);
        if (refusal) {
            refused.push({ runId: record.runId, code: refusal });
            continue;
        }
        if (maxRuns > 0 && reclaimed.length >= maxRuns)
            break;
        let run;
        try {
            run = host.loadRun(record.repo, record.runId);
        }
        catch {
            refused.push({ runId: record.runId, code: "unreadable" });
            continue;
        }
        try {
            const result = runReclamation(run, {
                now: nowIso,
                actor: options.actor,
                policy: { reclaimAfterArchiveDays: policy.reclaimAfterArchiveDays, keepScratch: policy.keepScratch, keepSnapshots: policy.keepSnapshots, keepCommits: policy.keepCommits },
                reclaimPolicy: { keepScratch: policy.keepScratch, keepSnapshots: policy.keepSnapshots, keepCommits: policy.keepCommits },
            });
            reclaimed.push({
                runId: record.runId,
                bytesFreed: result.bytesFreed,
                tombstoneHash: result.tombstone.tombstoneHash,
                capability: result.tombstone.capability,
                capabilityReason: result.tombstone.capabilityReason,
            });
            (0, trust_audit_1.recordTrustAuditEvent)(run, {
                kind: "run.reclaimed",
                decision: "recorded",
                source: "cw-validated",
                metadata: { tombstoneHash: result.tombstone.tombstoneHash, bytesFreed: result.bytesFreed, capability: result.tombstone.capability },
            });
            totalBytesFreed += result.bytesFreed;
            if (maxBytes > 0 && totalBytesFreed >= maxBytes)
                break;
        }
        catch (error) {
            if (error instanceof ReclamationError)
                refused.push({ runId: record.runId, code: error.code });
            else
                throw error;
        }
    }
    return {
        schemaVersion: 1,
        scope,
        generatedAt: nowIso,
        dryRun: false,
        reclaimed,
        refused,
        totalBytesFreed,
        nextAction: reclaimed.length ? "cw gc verify <run-id>" : "cw gc plan",
    };
}
function gcVerify(host, runId, options = {}) {
    const scope = options.scope || "home";
    const located = host.locate(runId, scope);
    if (!located) {
        return {
            schemaVersion: 1,
            runId,
            reclaimed: false,
            verified: false,
            tier: "live",
            capability: "re-runnable",
            chainLength: 0,
            checks: [{ name: "located", pass: false, code: "not-reclaimed", detail: "run source not found" }],
            nextAction: "cw registry refresh" + (scope === "home" ? " --scope home" : ""),
        };
    }
    const run = host.loadRun(located.record.repo, runId);
    const result = verifyReclamation(run);
    const checks = result.checks.map((c) => ({ name: c.name, pass: c.pass, code: c.code, detail: c.detail }));
    let eligibleWhenReclaimed = result.reclaimed;
    for (const tombstone of result.tombstones) {
        const terminal = tombstone.skeleton.finalVerdict?.terminal === true;
        if (!terminal) {
            eligibleWhenReclaimed = false;
            checks.push({ name: `eligible-when-reclaimed:${tombstone.tombstoneId}`, pass: false, code: "ineligible-when-reclaimed", detail: "non-terminal verdict sealed" });
        }
    }
    const last = result.tombstones[result.tombstones.length - 1];
    const witnessed = (0, trust_audit_1.listTrustAuditEvents)(run).some((event) => event.kind === "run.reclaimed");
    const proofDeleted = witnessed && !result.reclaimed;
    if (proofDeleted) {
        checks.push({ name: "reclaim-witness", pass: false, code: "reclaim-proof-deleted", detail: "trust-audit attests reclamation but reclaimed.json is missing/empty" });
    }
    const reclaimed = result.reclaimed || proofDeleted;
    const verified = result.verified && eligibleWhenReclaimed && !proofDeleted;
    return {
        schemaVersion: 1,
        runId,
        reclaimed,
        verified,
        tier: located.record.tier || (reclaimed ? "reclaimed" : "live"),
        capability: located.record.capability || "re-runnable",
        capabilityReason: located.record.capabilityReason,
        tombstoneHash: last?.tombstoneHash,
        chainLength: result.tombstones.length,
        checks,
        nextAction: verified ? "cw run show " + runId : "cw gc plan",
    };
}
// ---------------------------------------------------------------------------
// Human formatting for gc (CLI-only)
// ---------------------------------------------------------------------------
function formatGcPlan(result) {
    const lines = [
        `GC Plan (${result.scope}): ${result.eligibleCount}/${result.total} eligible, ${result.bytesToFree} byte(s) would be freed [DRY-RUN, frees nothing]`,
        `  policy: reclaimAfterArchiveDays=${result.policy.reclaimAfterArchiveDays} keepScratch=${result.policy.keepScratch} keepSnapshots=${result.policy.keepSnapshots} keepCommits=${result.policy.keepCommits}`,
    ];
    for (const entry of result.entries) {
        if (entry.eligible) {
            const kinds = Object.entries(entry.byKind)
                .map(([k, v]) => `${k}=${v}`)
                .join(" ");
            lines.push(`  [eligible] ${entry.runId} -> ${entry.capability} (${entry.capabilityReason}) ${entry.bytesToFree}B {${kinds}}`);
        }
        else {
            lines.push(`  [skip:${entry.reason}] ${entry.runId} (tier=${entry.tier})`);
        }
    }
    if (!result.entries.length)
        lines.push("  (no runs in scope)");
    return lines.join("\n");
}
function formatGcRun(result) {
    const lines = [`GC Run (${result.scope}): reclaimed ${result.reclaimed.length} run(s), freed ${result.totalBytesFreed} byte(s)`];
    for (const r of result.reclaimed)
        lines.push(`  [reclaimed] ${r.runId} -> ${r.capability} (${r.capabilityReason}) ${r.bytesFreed}B tombstone=${r.tombstoneHash.slice(0, 19)}`);
    for (const r of result.refused)
        lines.push(`  [refused:${r.code}] ${r.runId}`);
    if (!result.reclaimed.length && !result.refused.length)
        lines.push("  (nothing eligible)");
    return lines.join("\n");
}
function formatGcVerify(result) {
    const lines = [
        `GC Verify ${result.runId}: reclaimed=${result.reclaimed} verified=${result.verified} tier=${result.tier} capability=${result.capability}${result.tombstoneHash ? ` tombstone=${result.tombstoneHash.slice(0, 19)}` : ""}`,
    ];
    for (const check of result.checks)
        lines.push(`  ${check.pass ? "PASS" : "FAIL"} ${check.name}${check.code ? ` [${check.code}]` : ""}${check.detail ? ` (${check.detail})` : ""}`);
    return lines.join("\n");
}
exports.DEFAULT_ORPHAN_MIN_AGE_MINUTES = 60;
function resolveNowMs(now) {
    if (now === undefined)
        return Date.now();
    const ms = new Date(now).getTime();
    if (!Number.isFinite(ms))
        throw new Error(`--now must be a valid ISO date (got ${now})`);
    return ms;
}
/** Walk a directory tree; return total bytes + the newest mtime found
 *  anywhere in it (including the directory itself). Best-effort. */
function walk(dir) {
    let bytes = 0;
    let newestMs = 0;
    const bump = (p) => {
        let st;
        try {
            st = fs.lstatSync(p);
        }
        catch {
            return;
        }
        if (st.mtimeMs > newestMs)
            newestMs = st.mtimeMs;
        if (st.isDirectory()) {
            let names;
            try {
                names = fs.readdirSync(p);
            }
            catch {
                return;
            }
            for (const name of names)
                bump(path.join(p, name));
        }
        else {
            bytes += st.size;
        }
    };
    bump(dir);
    return { bytes, newestMs };
}
function runsDirFor(repo) {
    return path.join(repo, ".cw", "runs");
}
function candidatesFor(repo, knownDirs, nowMs) {
    const runsDir = runsDirFor(repo);
    let dirents;
    try {
        dirents = fs.readdirSync(runsDir, { withFileTypes: true });
    }
    catch {
        return [];
    }
    const out = [];
    for (const entry of dirents) {
        if (!entry.isDirectory())
            continue;
        const dir = path.join(runsDir, entry.name);
        if (knownDirs.has(path.resolve(dir)))
            continue;
        if (fs.existsSync(path.join(dir, "state.json")))
            continue; // gc.ts's territory
        const { bytes, newestMs } = walk(dir);
        const ageMinutes = Math.max(0, Math.round((nowMs - newestMs) / 60000));
        out.push({ repo, runId: entry.name, path: dir, ageMinutes, bytes });
    }
    return out;
}
function scan(host, scope, nowMs) {
    const index = host.buildIndex(scope);
    const known = new Set(index.records.map((r) => path.resolve(r.runDir)));
    const entries = [];
    for (const repo of index.repos)
        entries.push(...candidatesFor(repo, known, nowMs));
    return { repos: index.repos, entries };
}
/** `cw orphans list` (read-only). */
function listOrphanRuns(host, options = {}) {
    const scope = options.scope || "home";
    const { repos, entries } = scan(host, scope, resolveNowMs(options.now));
    return {
        schemaVersion: 1,
        scope,
        repos,
        count: entries.length,
        totalBytes: entries.reduce((sum, e) => sum + e.bytes, 0),
        entries,
    };
}
/** `cw orphans gc [--min-age-minutes N] [--all]` — reclaim orphan run
 *  directories. The re-check (state.json still absent) and the delete
 *  run inside the SAME `state.json.lock` held by `saveCheckpoint`, via
 *  `withFileLock` reused directly from shell/fs-atomic.ts. */
function gcOrphanRuns(host, options = {}) {
    const scope = options.scope || "home";
    const all = Boolean(options.all);
    let minAgeMinutes = null;
    if (!all) {
        minAgeMinutes = options.minAgeMinutes ?? exports.DEFAULT_ORPHAN_MIN_AGE_MINUTES;
        if (!Number.isFinite(minAgeMinutes) || minAgeMinutes < 0) {
            throw new Error(`--min-age-minutes must be a non-negative number (got ${String(options.minAgeMinutes)})`);
        }
    }
    const nowMs = resolveNowMs(options.now);
    const { entries } = scan(host, scope, nowMs);
    const removed = [];
    let freedBytes = 0;
    for (const entry of entries) {
        if (!all && entry.ageMinutes < minAgeMinutes)
            continue;
        const runsDirResolved = path.resolve(runsDirFor(entry.repo));
        const resolved = path.resolve(entry.path);
        if (!resolved.startsWith(runsDirResolved + path.sep))
            continue; // containment, fail closed
        const statePath = path.join(resolved, "state.json");
        const deleted = (0, fs_atomic_1.withFileLock)(statePath, () => {
            if (fs.existsSync(statePath))
                return false; // a checkpoint landed between scan and here
            fs.rmSync(resolved, { recursive: true, force: true });
            return true;
        });
        if (!deleted)
            continue;
        removed.push({ repo: entry.repo, runId: entry.runId, path: entry.path, bytes: entry.bytes });
        freedBytes += entry.bytes;
    }
    return {
        schemaVersion: 1,
        scope,
        removed,
        freedBytes,
        keptCount: entries.length - removed.length,
        minAgeMinutes,
        all,
    };
}
function humanBytesLocal(n) {
    if (n < 1024)
        return `${n}B`;
    const units = ["KiB", "MiB", "GiB"];
    let v = n / 1024;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) {
        v /= 1024;
        i += 1;
    }
    return `${v.toFixed(1)}${units[i]}`;
}
function formatOrphanRunsList(result) {
    if (!result.count)
        return `No orphan run(s) (${result.scope}): every ".cw/runs/" entry across ${result.repos.length} repo(s) is known to the registry.`;
    const lines = [`Orphan Runs (${result.scope}): ${result.count} in ${result.repos.length} repo(s), ${humanBytesLocal(result.totalBytes)} total`];
    for (const e of result.entries)
        lines.push(`  ${e.runId} (${e.repo}) age=${e.ageMinutes}m ${humanBytesLocal(e.bytes)}`);
    lines.push(`\nReclaim with: cw orphans gc --min-age-minutes ${exports.DEFAULT_ORPHAN_MIN_AGE_MINUTES}   (or --all)`);
    return lines.join("\n");
}
function formatOrphanRunsGc(result) {
    const scope = result.all ? "all orphan candidates" : `orphans older than ${result.minAgeMinutes} minute(s)`;
    if (!result.removed.length)
        return `Nothing to reclaim (${scope}); ${result.keptCount} kept (${result.scope}).`;
    const lines = [`Reclaimed ${result.removed.length} orphan run(s) (${scope}) — freed ${humanBytesLocal(result.freedBytes)}; ${result.keptCount} kept`];
    for (const r of result.removed)
        lines.push(`  ${r.runId} (${r.repo}) ${humanBytesLocal(r.bytes)}`);
    return lines.join("\n");
}
function isTrue(value) {
    return value === true || value === "true" || value === "1" || value === 1;
}
function optionalNumber(value) {
    if (value === undefined || value === null || value === "")
        return undefined;
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
}
function clonesRoot(env = process.env) {
    return path.join(resolveCwHomeForClones(env), "clones");
}
// Local, tiny re-implementation of run-registry-io.ts's resolveCwHome so
// this module has no import-time dependency on that file beyond the type
// re-exports already pulled in above (keeps the module boundary the same
// shape as the old build's clones.ts -> run-registry.ts single-function
// import).
function resolveCwHomeForClones(env) {
    if (env.CW_HOME && String(env.CW_HOME).trim())
        return path.resolve(String(env.CW_HOME));
    if (env.XDG_STATE_HOME && String(env.XDG_STATE_HOME).trim()) {
        return path.join(path.resolve(String(env.XDG_STATE_HOME)), "cool-workflow");
    }
    return path.join(os.homedir(), ".local", "state", "cool-workflow");
}
function dirSize(dir) {
    let total = 0;
    const walkDir = (d) => {
        let names;
        try {
            names = fs.readdirSync(d);
        }
        catch {
            return;
        }
        for (const name of names) {
            const p = path.join(d, name);
            let st;
            try {
                st = fs.lstatSync(p);
            }
            catch {
                continue;
            }
            if (st.isDirectory())
                walkDir(p);
            else
                total += st.size;
        }
    };
    walkDir(dir);
    return total;
}
function readCloneEntries(root) {
    let names = [];
    try {
        names = fs.readdirSync(root);
    }
    catch {
        return [];
    }
    const entries = [];
    for (const hash of names) {
        if (hash.startsWith("."))
            continue;
        const dir = path.join(root, hash);
        let st;
        try {
            st = fs.statSync(dir);
        }
        catch {
            continue;
        }
        if (!st.isDirectory())
            continue;
        let meta = {};
        try {
            meta = JSON.parse(fs.readFileSync(path.join(dir, ".cw-clone-meta.json"), "utf8"));
        }
        catch {
            /* legacy/partial entry without meta — still listable/reclaimable */
        }
        entries.push({
            hash,
            url: typeof meta.url === "string" ? meta.url : "(unknown)",
            kind: typeof meta.kind === "string" ? meta.kind : "git",
            ref: typeof meta.ref === "string" ? meta.ref : null,
            fetchedAt: typeof meta.fetchedAt === "string" ? meta.fetchedAt : null,
            commit: typeof meta.commit === "string" ? meta.commit : null,
            bytes: dirSize(dir),
        });
    }
    entries.sort((a, b) => (0, collate_1.stableCompare)(a.fetchedAt || "", b.fetchedAt || ""));
    return entries;
}
/** `cw clones list` — every cached remote checkout with its origin,
 *  commit, age, and size. */
function listClones(env = process.env) {
    const root = clonesRoot(env);
    const entries = readCloneEntries(root);
    return { schemaVersion: 1, clonesDir: root, count: entries.length, totalBytes: entries.reduce((sum, e) => sum + e.bytes, 0), entries };
}
/** `cw clones gc [--older-than-days N] [--all]` — reclaim cached
 *  checkouts. Default keeps entries fetched within the last 30 days;
 *  `--all` removes every entry. Deletes ONLY paths proven inside the
 *  clones root (fail closed). */
function gcClones(options = {}, env = process.env) {
    const root = clonesRoot(env);
    const all = isTrue(options.all);
    let olderThanDays = null;
    if (!all) {
        const raw = options.olderThanDays;
        olderThanDays = optionalNumber(raw) ?? 30;
        if (!Number.isFinite(olderThanDays) || olderThanDays < 0) {
            throw new Error(`--older-than-days must be a non-negative number (got ${String(raw)})`);
        }
    }
    let now = Date.now();
    if (options.now !== undefined) {
        now = new Date(String(options.now)).getTime();
        if (!Number.isFinite(now))
            throw new Error(`--now must be a valid ISO date (got ${String(options.now)})`);
    }
    const cutoff = olderThanDays != null ? now - olderThanDays * 24 * 60 * 60 * 1000 : Infinity;
    const rootResolved = path.resolve(root);
    const removed = [];
    let freedBytes = 0;
    const entries = readCloneEntries(root);
    for (const entry of entries) {
        if (!all) {
            if (!entry.fetchedAt)
                continue;
            const age = new Date(entry.fetchedAt).getTime();
            if (!Number.isFinite(age) || age > cutoff)
                continue;
        }
        const dir = path.join(root, entry.hash);
        if (!path.resolve(dir).startsWith(rootResolved + path.sep))
            continue; // containment, fail closed
        fs.rmSync(dir, { recursive: true, force: true });
        removed.push({ hash: entry.hash, url: entry.url, bytes: entry.bytes });
        freedBytes += entry.bytes;
    }
    return { schemaVersion: 1, clonesDir: root, removed, freedBytes, keptCount: entries.length - removed.length, olderThanDays, all };
}
function formatClonesList(result) {
    if (result.count === 0)
        return `No cached remote checkouts in ${result.clonesDir}.`;
    const rows = result.entries.map((e) => {
        const when = e.fetchedAt ? e.fetchedAt.replace("T", " ").replace(/\..*$/, "Z") : "unknown";
        return `  ${e.kind.padEnd(7)} ${humanBytesLocal(e.bytes).padStart(8)}  ${when}  ${e.url}${e.ref ? `@${e.ref}` : ""}`;
    });
    return [
        `${result.count} cached checkout${result.count === 1 ? "" : "s"} — ${humanBytesLocal(result.totalBytes)} in ${result.clonesDir}`,
        "  KIND       SIZE  FETCHED               SOURCE",
        ...rows,
        `\nReclaim with: cw clones gc --older-than-days 30   (or --all)`,
    ].join("\n");
}
function formatClonesGc(result) {
    const scope = result.all ? "all entries" : `entries older than ${result.olderThanDays} day(s)`;
    if (result.removed.length === 0)
        return `Nothing to reclaim (${scope}); ${result.keptCount} kept in ${result.clonesDir}.`;
    const rows = result.removed.map((r) => `  ${humanBytesLocal(r.bytes).padStart(8)}  ${r.url}`);
    return [
        `Reclaimed ${result.removed.length} checkout${result.removed.length === 1 ? "" : "s"} (${scope}) — freed ${humanBytesLocal(result.freedBytes)}; ${result.keptCount} kept`,
        ...rows,
    ].join("\n");
}
