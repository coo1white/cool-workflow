"use strict";
// shell/trust-audit.ts — MILESTONE 8: extended from milestone 6+7's
// scoped-down subset to the FULL trust-audit hash chain: eventHash (the
// JSON round-trip pre-pass), verifyTrustAudit (chain-link recompute +
// the era rule — a log is fully chained OR fully legacy, never mixed),
// event append (hash-chained), the evidence normalizer, and the
// sandbox-path decision helper.
//
// The milestone-6+7 subset (recordTrustAuditEvent, recordSandboxPath-
// Decision, normalizeEvidence, ensureTrustAudit) keeps its existing
// signatures byte-for-byte — shell/commit.ts and shell/worker-
// isolation.ts already import them. This edit ADDS verifyTrustAudit +
// the era-rule check + trustAuditGenesis on top, and switches
// computeEventHash to use core/hash.ts's named `eventHashInput` export
// (byte-identical behavior to the pre-existing inline JSON-round-trip,
// now shared with the rest of the hash-dedup story per docs/rebuild/PLAN.md byte-
// compat item 2).
//
// Evidence: SPEC/ledger-trust.md "Trust-audit chain", invariant 10 (era
// rule), byte-compat item 2; SPEC/pipeline-run.md's worker-accept
// references; plugins/cool-workflow/src/trust-audit.ts:1-731 (byte-exact
// source for the pieces ported here).
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
exports.TRUST_AUDIT_SCHEMA_VERSION = void 0;
exports.ensureTrustAudit = ensureTrustAudit;
exports.trustAuditGenesis = trustAuditGenesis;
exports.listTrustAuditEvents = listTrustAuditEvents;
exports.trustAuditHead = trustAuditHead;
exports.verifyTrustAudit = verifyTrustAudit;
exports.recordTrustAuditEvent = recordTrustAuditEvent;
exports.recordSandboxPathDecision = recordSandboxPathDecision;
exports.normalizeEvidence = normalizeEvidence;
exports.writeTrustAuditIndexPlaceholder = writeTrustAuditIndexPlaceholder;
exports.summarizeTrustAudit = summarizeTrustAudit;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const hash_1 = require("../core/hash");
const fs_atomic_1 = require("./fs-atomic");
exports.TRUST_AUDIT_SCHEMA_VERSION = 1;
function trustAuditPaths(run) {
    const dir = run.paths.auditDir || path.join(run.paths.runDir, "audit");
    return {
        eventLogPath: path.join(dir, "events.jsonl"),
        summaryPath: path.join(dir, "summary.json"),
        indexPath: path.join(dir, "index.json"),
    };
}
function ensureTrustAudit(run) {
    const dir = run.paths.auditDir || path.join(run.paths.runDir, "audit");
    fs.mkdirSync(dir, { recursive: true });
    run.paths.auditDir = dir;
    const audit = { schemaVersion: 1, ...trustAuditPaths(run) };
    run.audit = audit;
    if (!fs.existsSync(audit.eventLogPath))
        fs.writeFileSync(audit.eventLogPath, "", "utf8");
    return audit;
}
/** Genesis prevHash for a run's chain (no prior event). Exported so
 *  callers outside this module (verify tooling, tests) can recompute it
 *  independently rather than trusting a stored value. */
function trustAuditGenesis(runId) {
    return (0, hash_1.sha256)(`cw-trust-audit:${runId}`);
}
/** Canonical bytes the eventHash binds: every field EXCEPT eventHash
 *  itself, via core/hash.ts's `eventHashInput` (the JSON round-trip
 *  pre-pass that drops nested `undefined`-valued keys BEFORE the
 *  sort-and-stringify step — not a formatting flag on the same shape,
 *  see docs/rebuild/PLAN.md byte-compat item 2). Hashing the PERSISTED form this
 *  way makes record-time hashes equal verify-time (parsed-from-disk)
 *  hashes. */
function computeEventHash(event) {
    const { eventHash, ...rest } = event;
    void eventHash;
    return (0, hash_1.sha256)((0, hash_1.eventHashInput)(rest));
}
/** Read events in FILE (append) order, tolerating corrupt lines — one
 *  bad line must not brick the whole audit read surface (it is counted,
 *  not thrown). The chain links append order, so this is the order
 *  verification walks. */
function readEventsRawCounted(eventLogPath) {
    if (!fs.existsSync(eventLogPath))
        return { events: [], corruptLines: 0 };
    let corruptLines = 0;
    const events = [];
    for (const line of fs.readFileSync(eventLogPath, "utf8").split(/\n/g)) {
        const trimmed = line.trim();
        if (!trimmed)
            continue;
        try {
            events.push(JSON.parse(trimmed));
        }
        catch {
            corruptLines += 1;
        }
    }
    return { events, corruptLines };
}
function readEventsRaw(eventLogPath) {
    return readEventsRawCounted(eventLogPath).events;
}
/** Every recorded trust-audit event for this run, in append (file) order.
 *  Used by trust-policy/collaboration summaries (e.g.
 *  hasAcceptedJudgeRationale, summarizeMultiAgentTrust). */
function listTrustAuditEvents(run) {
    return readEventsRaw(ensureTrustAudit(run).eventLogPath);
}
/** The current head of a run's trust-audit chain: the hash the NEXT
 *  appended event will link from (genesis when the log is empty), plus
 *  the event count. Read-only projection over existing data. Capture it
 *  (e.g. right after a run, or at export time) and later hand it to
 *  `verifyTrustAudit`'s anchor / `cw audit verify --expect-head` to
 *  re-prove the log was not shortened since the capture. */
function trustAuditHead(run) {
    const audit = ensureTrustAudit(run);
    const events = readEventsRaw(audit.eventLogPath);
    let head = trustAuditGenesis(run.id);
    for (const event of events) {
        head = event.eventHash !== undefined ? event.eventHash : computeEventHash(event);
    }
    return { eventCount: events.length, headHash: head };
}
/** Re-prove the run's trust-audit chain: prevEventHash linkage (append
 *  order) + per-event hash recompute. A corrupt line, an edited event,
 *  or a removed event flips verified=false. Legacy events without a
 *  hash are reported as `unchained` (skipped), NOT treated as a forgery
 *  — they predate the chain.
 *
 *  ERA RULE (docs/rebuild/PLAN.md, SPEC/ledger-trust.md invariant 10): a single
 *  run is written by one code version, so a log is all-chained (chain
 *  era) or all-legacy (pre-chain). An unchained (eventHash-less) line
 *  mixed into an otherwise-chained log is a forgery attempt — dropping
 *  the hash to be waved through as "legacy" — so it fails with
 *  `trust-audit-unchained-event`, never silently accepted.
 *
 *  ANCHOR (optional): the walk alone cannot see tail truncation — see
 *  TrustAuditAnchor. With an anchor, the head-hash trail (genesis plus
 *  the hash after each event) must contain `expectHead`, and the log
 *  must reach `expectCount` events; a shortfall fails closed with
 *  `trust-audit-truncated`. Without an anchor, behavior is unchanged. */
function verifyTrustAudit(run, anchor) {
    const audit = ensureTrustAudit(run);
    const { events, corruptLines } = readEventsRawCounted(audit.eventLogPath);
    const checks = [];
    let verified = corruptLines === 0;
    if (corruptLines > 0)
        checks.push({ name: "parse", pass: false, code: "trust-audit-corrupt-line" });
    let chained = 0;
    let unchained = 0;
    let expectedPrev = trustAuditGenesis(run.id);
    const headTrail = new Set([expectedPrev]);
    for (let i = 0; i < events.length; i++) {
        const event = events[i];
        const recomputed = computeEventHash(event);
        if (event.eventHash === undefined) {
            unchained += 1;
            expectedPrev = recomputed; // advance the chain over legacy events
            headTrail.add(expectedPrev);
            continue;
        }
        chained += 1;
        if (event.eventHash !== recomputed) {
            verified = false;
            checks.push({ name: `event-hash[${i}]`, pass: false, code: "trust-audit-digest-mismatch" });
        }
        if (event.prevEventHash !== undefined && event.prevEventHash !== expectedPrev) {
            verified = false;
            checks.push({ name: `chain-link[${i}]`, pass: false, code: "trust-audit-chain-broken" });
        }
        expectedPrev = event.eventHash;
        headTrail.add(expectedPrev);
    }
    // Era rule: a log with ANY chained event must have EVERY event chained.
    if (chained > 0 && unchained > 0) {
        verified = false;
        checks.push({ name: "unchained-events", pass: false, code: "trust-audit-unchained-event" });
    }
    // Anchor rule: the captured head must still be ON the chain, and the log
    // must be at least as long as it was at capture time. A truncated-then-
    // appended log fails the head check (new events link from an earlier
    // point, so the old head is no longer in the trail).
    if (anchor) {
        if (anchor.expectCount !== undefined && events.length < anchor.expectCount) {
            verified = false;
            checks.push({ name: "anchor-count", pass: false, code: "trust-audit-truncated" });
        }
        if (anchor.expectHead !== undefined && !headTrail.has(anchor.expectHead)) {
            verified = false;
            checks.push({ name: "anchor-head", pass: false, code: "trust-audit-truncated" });
        }
    }
    return { present: events.length > 0, verified, eventCount: events.length, chained, unchained, corruptLines, checks };
}
function unique(values) {
    return Array.from(new Set(values.filter(Boolean)));
}
function scrubMetadata(value) {
    const result = {};
    for (const [key, entry] of Object.entries(value)) {
        if (entry === undefined)
            continue;
        if (/secret|token|password|credential|authorization|api[_-]?key/i.test(key)) {
            result[key] = "[redacted]";
        }
        else if (Array.isArray(entry)) {
            result[key] = entry.map((item) => (typeof item === "string" && item.includes("=") ? item.split("=")[0] : item));
        }
        else if (entry && typeof entry === "object") {
            result[key] = scrubMetadata(entry);
        }
        else {
            result[key] = entry;
        }
    }
    return Object.keys(result).length ? result : undefined;
}
function compact(value) {
    return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}
function createEventId(run, kind) {
    const count = readEventsRaw(trustAuditPaths(run).eventLogPath).length + 1;
    return `audit-${(0, fs_atomic_1.safeFileName)(kind)}-${String(count).padStart(4, "0")}`;
}
/** Correlation-id keys copied verbatim (and no others) — byte-exact list/
 *  order to the old build's CORRELATION_ID_FIELDS. */
const CORRELATION_ID_FIELDS = [
    "candidateId",
    "scoreId",
    "selectionId",
    "commitId",
    "multiAgentRunId",
    "agentRoleId",
    "agentGroupId",
    "agentMembershipId",
    "agentFanoutId",
    "agentFaninId",
    "blackboardId",
    "blackboardTopicId",
    "blackboardMessageId",
    "blackboardContextId",
    "blackboardArtifactRefId",
    "blackboardSnapshotId",
    "coordinatorDecisionId",
    "topologyId",
    "topologyRunId",
];
function pickCorrelationIds(source) {
    const picked = {};
    for (const field of CORRELATION_ID_FIELDS)
        picked[field] = source[field];
    return picked;
}
/** The audit index historically omits scoreId (byte-exact to the old build's
 *  INDEX_OMITTED_CORRELATION_IDS). */
const INDEX_OMITTED_CORRELATION_IDS = new Set(["scoreId"]);
function indexCorrelationIds(event) {
    const picked = {};
    for (const field of CORRELATION_ID_FIELDS) {
        if (INDEX_OMITTED_CORRELATION_IDS.has(field))
            continue;
        picked[field] = event[field];
    }
    return picked;
}
function recordTrustAuditEvent(run, input) {
    const audit = ensureTrustAudit(run);
    const event = compact({
        schemaVersion: exports.TRUST_AUDIT_SCHEMA_VERSION,
        id: createEventId(run, input.kind),
        createdAt: new Date().toISOString(),
        runId: run.id,
        kind: input.kind,
        decision: input.decision,
        source: input.source,
        actor: input.actor,
        workerId: input.workerId,
        taskId: input.taskId,
        nodeId: input.nodeId,
        feedbackIds: input.feedbackIds?.filter(Boolean).sort(),
        ...pickCorrelationIds(input),
        sandboxProfileId: input.sandboxProfileId || input.policySnapshot?.id,
        policyRef: input.policyRef || (input.policySnapshot?.id ? `run.sandboxProfiles.${input.policySnapshot.id}` : undefined),
        policySnapshot: input.policySnapshot,
        normalizedPath: input.normalizedPath ? path.resolve(input.normalizedPath) : undefined,
        command: input.command,
        networkTarget: input.networkTarget,
        envVars: input.envVars?.filter(Boolean).sort(),
        evidence: normalizeEvidence(run, input.evidence || [], { source: input.source, workerId: input.workerId, taskId: input.taskId, resultNodeId: input.nodeId }),
        evidenceRefs: unique(input.evidenceRefs || []).sort(),
        parentEventIds: unique(input.parentEventIds || []).sort(),
        metadata: scrubMetadata(input.metadata || {}),
    });
    const prior = readEventsRaw(audit.eventLogPath);
    event.prevEventHash = prior.length ? prior[prior.length - 1].eventHash || computeEventHash(prior[prior.length - 1]) : trustAuditGenesis(run.id);
    event.eventHash = computeEventHash(event);
    (0, fs_atomic_1.durableAppendFileSync)(audit.eventLogPath, `${JSON.stringify(event)}\n`);
    return event;
}
function recordSandboxPathDecision(run, input) {
    return recordTrustAuditEvent(run, {
        kind: "sandbox.path",
        decision: input.decision,
        source: "cw-validated",
        workerId: input.workerId,
        taskId: input.taskId,
        sandboxProfileId: input.sandboxProfileId,
        policySnapshot: input.policySnapshot,
        normalizedPath: input.target,
        metadata: input.metadata,
    });
}
/** normalizeEvidence — GROUNDING-ONLY provenance. Never carries the
 *  agent's command/args/model/handle (those live ONLY in
 *  node.metadata.agentDelegation) — this is the exact hygiene split
 *  exechard-evidence-triple-hygiene.case.js pins. */
function normalizeEvidence(run, evidence, provenance) {
    return evidence.map((entry) => ({
        ...entry,
        confidence: entry.confidence || (entry.locator || entry.path || entry.summary ? "grounded" : "ungrounded"),
        provenance: {
            schemaVersion: exports.TRUST_AUDIT_SCHEMA_VERSION,
            runId: run.id,
            source: provenance.source || entry.provenance?.source || "runtime-derived",
            workerId: provenance.workerId || entry.provenance?.workerId,
            taskId: provenance.taskId || entry.provenance?.taskId,
            resultNodeId: provenance.resultNodeId || entry.provenance?.resultNodeId,
            verifierNodeId: provenance.verifierNodeId || entry.provenance?.verifierNodeId,
            candidateId: provenance.candidateId || entry.provenance?.candidateId,
            scoreId: provenance.scoreId || entry.provenance?.scoreId,
            selectionId: provenance.selectionId || entry.provenance?.selectionId,
            commitId: provenance.commitId || entry.provenance?.commitId,
            parentEvidenceIds: unique([...(entry.provenance?.parentEvidenceIds || []), ...(provenance.parentEvidenceIds || [])]).sort(),
            auditEventIds: unique([...(entry.provenance?.auditEventIds || []), ...(provenance.auditEventIds || [])]).sort(),
            note: provenance.note || entry.provenance?.note,
        },
    }));
}
function writeTrustAuditIndexPlaceholder(run) {
    const audit = ensureTrustAudit(run);
    (0, fs_atomic_1.writeJson)(audit.summaryPath, { schemaVersion: 1, runId: run.id, eventCount: readEventsRaw(audit.eventLogPath).length });
}
function countBy(values, key) {
    const counts = {};
    for (const value of values) {
        const bucket = key(value);
        counts[bucket] = (counts[bucket] || 0) + 1;
    }
    return counts;
}
/** MILESTONE 11 (reporting/observability) — the `## Trust Audit` report
 *  section's data source. A scoped-down port of the old build's
 *  `summarizeTrustAudit` (plugins/cool-workflow/src/trust-audit.ts:413+):
 *  this milestone's report.ts only renders eventCount/integrity/byDecision/
 *  bySource/bySandboxProfile/paths, so those are the only fields carried
 *  here — the old build's extra workers/candidates/commits/multiAgent/
 *  blackboard rollups are milestone 9's own summarizeMultiAgent/
 *  candidate-scoring-io/coordinator-io surfaces, not duplicated here. */
function workerRows(events, run) {
    const workerIds = unique([...(run.workers || []).map((w) => w.id), ...events.map((e) => e.workerId || "")]).sort();
    return workerIds.filter(Boolean).map((workerId) => {
        const worker = (run.workers || []).find((w) => w.id === workerId);
        const scoped = events.filter((e) => e.workerId === workerId);
        return {
            workerId,
            taskId: worker?.taskId || scoped.find((e) => e.taskId)?.taskId,
            sandboxProfileId: worker?.sandboxProfileId || scoped.find((e) => e.sandboxProfileId)?.sandboxProfileId,
            decisions: countBy(scoped, (e) => e.decision),
            denied: scoped.filter((e) => e.decision === "denied" || e.decision === "rejected").length,
            feedbackIds: unique(scoped.flatMap((e) => e.feedbackIds || [])).sort(),
        };
    });
}
function candidateRows(events, run) {
    const cands = run.candidates || [];
    const selectionsAll = run.candidateSelections || [];
    const ids = unique([...cands.map((c) => c.id), ...events.map((e) => e.candidateId || "")]).sort();
    return ids.filter(Boolean).map((candidateId) => {
        const candidate = cands.find((c) => c.id === candidateId);
        const selections = selectionsAll.filter((s) => s.candidateId === candidateId);
        const scoped = events.filter((e) => e.candidateId === candidateId);
        return {
            candidateId,
            scoreIds: unique([...(candidate?.scores || []), ...scoped.map((e) => e.scoreId || "")]).filter(Boolean).sort(),
            selectionIds: unique([...selections.map((s) => s.id), ...scoped.map((e) => e.selectionId || "")]).filter(Boolean).sort(),
            evidenceCount: candidate?.evidence?.length || scoped.flatMap((e) => e.evidence || []).length,
        };
    });
}
function commitRows(events, run) {
    const ids = unique([...(run.commits || []).map((c) => c.id), ...events.map((e) => e.commitId || "")]).sort();
    return ids.filter(Boolean).map((commitId) => {
        const commit = (run.commits || []).find((c) => c.id === commitId);
        return {
            commitId,
            verifierGated: Boolean(commit?.verifierGated),
            candidateId: commit?.candidateId,
            selectionId: commit?.selectionId,
            evidenceCount: commit?.evidence?.length || 0,
            rationale: commit?.acceptanceRationale,
        };
    });
}
function summarizeTrustAudit(run) {
    const audit = ensureTrustAudit(run);
    const events = readEventsRaw(audit.eventLogPath);
    const ma = run.multiAgent;
    const bb = run.blackboard;
    const summary = {
        schemaVersion: exports.TRUST_AUDIT_SCHEMA_VERSION,
        runId: run.id,
        generatedAt: new Date().toISOString(),
        eventCount: events.length,
        integrity: verifyTrustAudit(run),
        eventLogPath: audit.eventLogPath,
        indexPath: audit.indexPath,
        summaryPath: audit.summaryPath,
        byKind: countBy(events, (event) => event.kind),
        byDecision: countBy(events, (event) => event.decision),
        bySource: countBy(events, (event) => event.source),
        bySandboxProfile: countBy(events.filter((event) => event.sandboxProfileId), (event) => event.sandboxProfileId || "none"),
        workers: workerRows(events, run),
        candidates: candidateRows(events, run),
        commits: commitRows(events, run),
        multiAgent: {
            runs: ma?.runs.length || 0,
            roles: ma?.roles.length || 0,
            groups: ma?.groups.length || 0,
            memberships: ma?.memberships.length || 0,
            fanouts: ma?.fanouts.length || 0,
            fanins: ma?.fanins.length || 0,
            events: events.filter((e) => Boolean(e.multiAgentRunId || e.agentRoleId || e.agentGroupId || e.agentMembershipId || e.agentFanoutId || e.agentFaninId)).length,
        },
        blackboard: {
            boards: bb?.boards.length || 0,
            topics: bb?.topics.length || 0,
            messages: bb?.messages.length || 0,
            contexts: bb?.contexts.length || 0,
            artifacts: bb?.artifacts.length || 0,
            snapshots: bb?.snapshots.length || 0,
            decisions: bb?.decisions.length || 0,
            events: events.filter((e) => Boolean(e.blackboardId || e.blackboardTopicId || e.blackboardMessageId || e.blackboardContextId || e.blackboardArtifactRefId || e.blackboardSnapshotId || e.coordinatorDecisionId)).length,
        },
        topologies: {
            runs: run.topologies?.runs.length || 0,
            events: events.filter((e) => Boolean(e.topologyId || e.topologyRunId || e.kind.startsWith("topology."))).length,
        },
        multiAgentTrust: {
            rolePolicies: events.filter((e) => e.kind === "multi-agent.role-policy").length,
            permissionDecisions: events.filter((e) => e.kind === "multi-agent.permission").length,
            blackboardWrites: events.filter((e) => e.kind === "blackboard.write").length,
            messageProvenance: events.filter((e) => e.kind === "blackboard.message-provenance").length,
            judgeRationales: events.filter((e) => e.kind === "judge.rationale").length,
            panelDecisions: events.filter((e) => e.kind === "judge.panel-decision").length,
            policyViolations: events.filter((e) => e.kind === "policy.violation").length,
        },
    };
    // Durable: the summary/index are the read-side view of the audit log; persist
    // them durably so a crash can't leave them pointing past the last durably-
    // appended event. Byte-behavior port of the old build's summarizeTrustAudit.
    (0, fs_atomic_1.writeJson)(audit.summaryPath, summary, { durable: true });
    (0, fs_atomic_1.writeJson)(audit.indexPath, {
        schemaVersion: exports.TRUST_AUDIT_SCHEMA_VERSION,
        runId: run.id,
        events: events.map((event) => ({
            id: event.id,
            createdAt: event.createdAt,
            kind: event.kind,
            decision: event.decision,
            source: event.source,
            workerId: event.workerId,
            taskId: event.taskId,
            ...indexCorrelationIds(event),
            sandboxProfileId: event.sandboxProfileId,
            policyRef: event.policyRef,
        })),
    }, { durable: true });
    run.audit = { schemaVersion: exports.TRUST_AUDIT_SCHEMA_VERSION, ...audit };
    return summary;
}
