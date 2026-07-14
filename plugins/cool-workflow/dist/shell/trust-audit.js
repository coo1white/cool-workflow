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
exports.repairTrustAuditTornTail = repairTrustAuditTornTail;
exports.recordTrustAuditEvent = recordTrustAuditEvent;
exports.withTrustAuditBatch = withTrustAuditBatch;
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
    // Create-if-missing must NEVER truncate: this runs OUTSIDE the append
    // lock, so between an existsSync(false) here and a plain create, another
    // process may have already created the log AND appended real events —
    // a truncating create then silently deletes them (one event lost, chain
    // still verifies "clean" from genesis; seen once on CI under coverage
    // I/O). Flag "a" is O_CREAT without O_TRUNC: it makes the file when
    // missing and adds zero bytes when not, with no exists-check window.
    if (!fs.existsSync(audit.eventLogPath))
        fs.writeFileSync(audit.eventLogPath, "", { encoding: "utf8", flag: "a" });
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
const ACTIVE_AUDIT_BATCHES = new Map();
function tailCachePathFor(eventLogPath) {
    return path.join(path.dirname(eventLogPath), "tail-cache.json");
}
function readAuditTailCache(tailCachePath) {
    if (!fs.existsSync(tailCachePath))
        return undefined;
    try {
        const parsed = JSON.parse(fs.readFileSync(tailCachePath, "utf8"));
        if (parsed && parsed.schemaVersion === 1 && typeof parsed.logBytes === "number" && typeof parsed.count === "number" && typeof parsed.lastHash === "string") {
            return parsed;
        }
    }
    catch {
        // Corrupt/unreadable cache -- fall back to the full parse below.
    }
    return undefined;
}
function writeAuditTailCache(tailCachePath, cache) {
    try {
        (0, fs_atomic_1.writeJson)(tailCachePath, cache);
    }
    catch {
        // Best-effort: a failed cache write must never break the real append.
    }
}
/** Deletes the tail cache so the NEXT append always re-derives ground
 *  truth from the real log, rather than trusting a byte-size coincidence.
 *  Called whenever something OTHER than a plain append changes the log's
 *  content (currently: repair). */
function invalidateAuditTailCache(eventLogPath) {
    try {
        fs.unlinkSync(tailCachePathFor(eventLogPath));
    }
    catch {
        // Nothing to invalidate (no cache existed yet) -- fine.
    }
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
/** Chain-walk core shared by `verifyTrustAudit` (reads from disk) and
 *  `repairTrustAuditTornTail` (re-checks an in-memory candidate result
 *  BEFORE ever writing it to disk). Pure — no fs. */
function verifyEventsChain(runId, events, corruptLines, anchor) {
    const checks = [];
    let verified = corruptLines === 0;
    if (corruptLines > 0)
        checks.push({ name: "parse", pass: false, code: "trust-audit-corrupt-line" });
    let chained = 0;
    let unchained = 0;
    let expectedPrev = trustAuditGenesis(runId);
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
        // No `undefined` skip here: the writer ALWAYS sets prevEventHash (the
        // first event gets the genesis hash), so a chained event without it is
        // a forgery — dropping the field and re-making eventHash must NOT let a
        // cut or re-ordered chain verify green. Fail closed on the mismatch.
        if (event.prevEventHash !== expectedPrev) {
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
function verifyTrustAudit(run, anchor) {
    const audit = ensureTrustAudit(run);
    const { events, corruptLines } = readEventsRawCounted(audit.eventLogPath);
    return verifyEventsChain(run.id, events, corruptLines, anchor);
}
/** Repairs a torn TRAILING write in the audit event log — the ONE
 *  corruption shape a crash mid-append can produce (`durableAppendFileSync`
 *  only ever adds bytes at the current end of file, so an interruption can
 *  only ever leave the LAST append incomplete; it can never touch earlier,
 *  already-flushed lines). Every line is always actually parsed — the
 *  file's trailing-newline byte says only whether the LAST WRITE
 *  completed, nothing about whether any line parses: if a run is RESUMED
 *  after a torn write (another event appended right after the garbled
 *  remnant, with no separating newline of its own), the two merge into one
 *  unparseable line and the file ends in a newline again, even though
 *  content is still corrupt. Refuses (`outcome: "refused"`) rather than
 *  touching anything when:
 *   - more than one line is unparseable, or the sole bad line is NOT the
 *     last one (not a shape a crash can produce — treated as possible
 *     tampering, not auto-repaired);
 *   - removing the bad trailing line still leaves an unverifiable chain,
 *     OR (when `anchor` is given) the repaired chain doesn't reach
 *     `anchor.expectCount`/contain `anchor.expectHead` — an anchor
 *     captured before the corruption is the ONLY way to catch an attacker
 *     deleting real historical events and leaving a torn-looking fragment
 *     behind (an empty/short chain otherwise "verifies" trivially — the
 *     same documented blind spot `verifyTrustAudit` itself has without an
 *     anchor; this function must never launder that shape into a
 *     confidently-"repaired" empty log).
 *  `write: false` (default) reports what WOULD happen without touching
 *  disk, matching this codebase's `cw state check [--write]` convention.
 *  Held under the SAME `withFileLock` as `recordTrustAuditEvent` (below),
 *  so a repair can never interleave with a live append. */
function repairTrustAuditTornTail(run, options = {}) {
    const audit = ensureTrustAudit(run);
    return (0, fs_atomic_1.withFileLock)(audit.eventLogPath, () => {
        const raw = fs.readFileSync(audit.eventLogPath, "utf8");
        const lines = raw.split("\n").filter((line) => line.trim() !== "");
        const badIndexes = [];
        const events = [];
        lines.forEach((line, i) => {
            try {
                events.push(JSON.parse(line));
            }
            catch {
                badIndexes.push(i);
            }
        });
        if (badIndexes.length === 0) {
            return { outcome: "clean", reason: "every line parses — no torn trailing write to repair" };
        }
        if (badIndexes.length > 1 || badIndexes[0] !== lines.length - 1) {
            return {
                outcome: "refused",
                reason: "corruption is not confined to exactly the trailing line — this is not a shape a crash mid-append can produce and will not be auto-repaired (looks like tampering)",
            };
        }
        // `events` already holds every line EXCEPT the one bad trailing line
        // (JSON.parse threw for it, so nothing was pushed) — exactly the "good"
        // set, in file order.
        const recheck = verifyEventsChain(run.id, events, 0, options.anchor);
        if (!recheck.verified) {
            return {
                outcome: "refused",
                reason: options.anchor
                    ? "removing the torn trailing write still doesn't reach the given --expect-head/--expect-count anchor — refusing to repair (this looks like deleted history, not a crash)"
                    : "removing the torn trailing write still leaves an unverifiable chain — refusing to repair (this looks like tampering, not a crash)",
            };
        }
        const removedBytes = Buffer.byteLength(lines[lines.length - 1], "utf8");
        const repairedContent = events.length > 0 ? `${lines.slice(0, -1).join("\n")}\n` : "";
        if (options.write) {
            (0, fs_atomic_1.writeTextDurable)(audit.eventLogPath, repairedContent, { durable: true });
            // The log's bytes just changed out from under the append tail cache
            // (perf cycle P1-2) -- invalidate rather than rely on the size check
            // alone catching every case.
            invalidateAuditTailCache(audit.eventLogPath);
        }
        return {
            outcome: "repaired",
            reason: options.write
                ? `removed a torn trailing write (${removedBytes} bytes) and restored a verified chain of ${events.length} event(s)`
                : `would remove a torn trailing write (${removedBytes} bytes) and restore a verified chain of ${events.length} event(s) — pass --write to apply`,
            removedLines: 1,
            removedBytes,
        };
    });
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
/** `count` must be the number of PRIOR events, read under the SAME lock
 *  the append itself happens under (see `recordTrustAuditEvent`) — an
 *  earlier version read this count separately, outside any lock, so two
 *  concurrent writers could mint the SAME id for two different events
 *  (the hash chain still forked-proof, but the id — referenced elsewhere
 *  as `auditEventIds`/`parentEventIds` for provenance — was not unique). */
function createEventId(kind, count) {
    return `audit-${(0, fs_atomic_1.safeFileName)(kind)}-${String(count + 1).padStart(4, "0")}`;
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
/** Read-modify-append: computes `prevEventHash` from the CURRENT last event
 *  and appends. Held under `withFileLock` (like every other read-modify-
 *  write in this codebase) so two processes recording events for the same
 *  run at once can never both read the same tail and compute the same
 *  `prevEventHash` — that would fork the hash chain, and a forked chain
 *  fails `verifyTrustAudit` for good, with no repair for THAT shape (unlike
 *  a torn trailing write, a fork is not confined to the last line). */
function recordTrustAuditEvent(run, input) {
    const audit = ensureTrustAudit(run);
    // `id` is NOT set here — it depends on the prior event count, which (like
    // prevEventHash) must be read under the lock below, or two concurrent
    // writers could mint the same id for two different events.
    const event = compact({
        schemaVersion: exports.TRUST_AUDIT_SCHEMA_VERSION,
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
    const batch = ACTIVE_AUDIT_BATCHES.get(path.resolve(audit.eventLogPath));
    if (batch)
        return appendTrustAuditEvent(run, input, event, batch);
    return (0, fs_atomic_1.withFileLock)(audit.eventLogPath, () => {
        const currentBytes = fs.existsSync(audit.eventLogPath) ? fs.statSync(audit.eventLogPath).size : 0;
        const cached = readAuditTailCache(tailCachePathFor(audit.eventLogPath));
        const prior = cached && cached.logBytes === currentBytes ? undefined : readEventsRaw(audit.eventLogPath);
        const state = {
            audit,
            currentBytes,
            count: cached && cached.logBytes === currentBytes ? cached.count : prior.length,
            lastHash: cached && cached.logBytes === currentBytes ? cached.lastHash : (prior.length ? prior[prior.length - 1].eventHash || computeEventHash(prior[prior.length - 1]) : trustAuditGenesis(run.id)),
            lines: [],
        };
        const result = appendTrustAuditEvent(run, input, event, state);
        flushTrustAuditBatch(state);
        return result;
    });
}
function appendTrustAuditEvent(run, input, event, batch) {
    // The prior event count and last-event hash are the ONLY two things
    // this append needs from the existing log. A tail cache (keyed on the
    // log's own byte size) serves both without a full parse when nothing
    // else has touched the log since it was written; any size mismatch
    // (a repair, a torn write, this being the very first append) falls
    // back to the full parse, same as before this cache existed.
    event.id = createEventId(input.kind, batch.count);
    event.prevEventHash = batch.lastHash;
    event.eventHash = computeEventHash(event);
    // Newline-boundary safety (fail-closed). `durableAppendFileSync` only ever
    // ADDS bytes at the end of file and never writes a separator of its own. A
    // completed append always leaves the log ending in "\n"; if the last byte
    // is NOT "\n", the previous append was torn by a crash (its bytes were
    // never a confirmed event — the append never returned). Writing this new,
    // already-cross-linked event straight onto that partial byte-run would
    // MERGE the two into one line that no longer parses — losing THIS event and
    // poisoning the forward chain (the next append's prevEventHash would point
    // into an unparseable blob), with no repair for that shape. So put the new
    // event on its own clean line: prepend a "\n" when the log does not already
    // end in one, confining any crash artifact to its own now-orphaned line.
    // (Reads only the last byte, so the O(1) tail-cache path is preserved.)
    // An empty log (currentBytes === 0, e.g. the first append) has no tail to
    // merge with, so it never needs a leading newline.
    const leadingNewline = batch.currentBytes > 0 && batch.lines.length === 0 && !(0, fs_atomic_1.logEndsWithNewline)(batch.audit.eventLogPath, batch.currentBytes) ? "\n" : "";
    const line = `${leadingNewline}${JSON.stringify(event)}\n`;
    batch.lines.push(line);
    batch.currentBytes += Buffer.byteLength(line, "utf8");
    batch.count += 1;
    batch.lastHash = event.eventHash;
    return event;
}
function flushTrustAuditBatch(batch) {
    if (!batch.lines.length)
        return;
    (0, fs_atomic_1.durableAppendFileSync)(batch.audit.eventLogPath, batch.lines.join(""));
    writeAuditTailCache(tailCachePathFor(batch.audit.eventLogPath), { schemaVersion: 1, logBytes: batch.currentBytes, count: batch.count, lastHash: batch.lastHash });
}
/** Run a short, synchronous mutation group under one audit lock and append its
 *  exact NDJSON lines with one durable write before the caller checkpoints. */
function withTrustAuditBatch(run, fn) {
    const audit = ensureTrustAudit(run);
    const key = path.resolve(audit.eventLogPath);
    if (ACTIVE_AUDIT_BATCHES.has(key))
        return fn();
    return (0, fs_atomic_1.withFileLock)(audit.eventLogPath, () => {
        const currentBytes = fs.existsSync(audit.eventLogPath) ? fs.statSync(audit.eventLogPath).size : 0;
        const cached = readAuditTailCache(tailCachePathFor(audit.eventLogPath));
        const prior = cached && cached.logBytes === currentBytes ? undefined : readEventsRaw(audit.eventLogPath);
        const batch = {
            audit,
            currentBytes,
            count: cached && cached.logBytes === currentBytes ? cached.count : prior.length,
            lastHash: cached && cached.logBytes === currentBytes ? cached.lastHash : (prior.length ? prior[prior.length - 1].eventHash || computeEventHash(prior[prior.length - 1]) : trustAuditGenesis(run.id)),
            lines: [],
        };
        ACTIVE_AUDIT_BATCHES.set(key, batch);
        try {
            const result = fn();
            flushTrustAuditBatch(batch);
            return result;
        }
        finally {
            ACTIVE_AUDIT_BATCHES.delete(key);
        }
    });
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
/** Groups events by a key field once, so each row below is an O(1) Map
 *  lookup instead of an O(events) `.filter()` re-scan per id -- found
 *  alongside the id.find() version of this same shape while pinning perf
 *  cycle P1-1's review-fix regression test (O(ids x events) otherwise). */
function groupEventsBy(events, key) {
    const groups = new Map();
    for (const event of events) {
        const k = key(event);
        if (!k)
            continue;
        const list = groups.get(k);
        if (list)
            list.push(event);
        else
            groups.set(k, [event]);
    }
    return groups;
}
function workerRows(events, run) {
    const workers = run.workers || [];
    const workersById = new Map(workers.map((w) => [w.id, w]));
    const eventsByWorkerId = groupEventsBy(events, (e) => e.workerId);
    const workerIds = unique([...workers.map((w) => w.id), ...events.map((e) => e.workerId || "")]).sort();
    return workerIds.filter(Boolean).map((workerId) => {
        const worker = workersById.get(workerId);
        const scoped = eventsByWorkerId.get(workerId) || [];
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
    const candsById = new Map(cands.map((c) => [c.id, c]));
    const selectionsByCandidateId = new Map();
    for (const selection of selectionsAll) {
        const list = selectionsByCandidateId.get(selection.candidateId);
        if (list)
            list.push(selection);
        else
            selectionsByCandidateId.set(selection.candidateId, [selection]);
    }
    const eventsByCandidateId = groupEventsBy(events, (e) => e.candidateId);
    const ids = unique([...cands.map((c) => c.id), ...events.map((e) => e.candidateId || "")]).sort();
    return ids.filter(Boolean).map((candidateId) => {
        const candidate = candsById.get(candidateId);
        const selections = selectionsByCandidateId.get(candidateId) || [];
        const scoped = eventsByCandidateId.get(candidateId) || [];
        return {
            candidateId,
            scoreIds: unique([...(candidate?.scores || []), ...scoped.map((e) => e.scoreId || "")]).filter(Boolean).sort(),
            selectionIds: unique([...selections.map((s) => s.id), ...scoped.map((e) => e.selectionId || "")]).filter(Boolean).sort(),
            evidenceCount: candidate?.evidence?.length || scoped.flatMap((e) => e.evidence || []).length,
        };
    });
}
function commitRows(events, run) {
    const commits = run.commits || [];
    const commitsById = new Map(commits.map((c) => [c.id, c]));
    const ids = unique([...commits.map((c) => c.id), ...events.map((e) => e.commitId || "")]).sort();
    return ids.filter(Boolean).map((commitId) => {
        const commit = commitsById.get(commitId);
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
// Perf cycle P1 (read side): every read command (`cw status`, each
// `writeReport` call, multi-agent status) called `summarizeTrustAudit`,
// which read+parsed the log via `readEventsRaw`, THEN called
// `verifyTrustAudit(run)`, which read+parsed the SAME log AGAIN and
// recomputed a sha256 for every event -- two full passes for one call.
// It then durably (fsync) rewrote summary.json AND index.json on EVERY
// call, even when nothing about the run or the log had changed since the
// last call (a live audit reaches ~50k events, so `writeReport` alone --
// which calls this once per pipeline step and per feedback op -- turned
// into a real, repeated cost).
//
// Fix, in two parts:
//  1. Read the log ONCE (`readEventsRawCounted`) and hand the SAME parsed
//     array to `verifyEventsChain` directly -- the exact same check
//     `verifyTrustAudit` runs with no anchor, so the integrity result is
//     byte-identical to before. `verifyTrustAudit` itself is untouched and
//     every OTHER caller (doctor.ts, `cw audit verify`, drive.ts,
//     run-export.ts) still gets a real, independent, always-full check.
//  2. Skip the durable rewrite of summary.json/index.json when the freshly
//     and FULLY recomputed content is unchanged from last time. This is
//     NOT a shortcut on verification -- the full parse+rehash+chain-walk
//     above always runs, on every call, no exceptions. A cache that
//     reused a stale "verified" verdict would be unsound here: this
//     codebase's chain check is a sequential field-comparison walk, not a
//     content-addressed (Merkle) chain, so tampering with an EARLY event
//     can leave the file's total size and its LAST event's bytes fully
//     unchanged while still flipping `verified` to false. So the cache
//     below only ever gates the DISK WRITE of an already fully-verified
//     result, never the verification itself, and the function's RETURN
//     VALUE is always the fresh `summary` object either way.
function summaryFingerprintPathFor(summaryPath) {
    return path.join(path.dirname(summaryPath), "summary-fingerprint.json");
}
function readSummaryFingerprint(fingerprintPath) {
    if (!fs.existsSync(fingerprintPath))
        return undefined;
    try {
        const parsed = JSON.parse(fs.readFileSync(fingerprintPath, "utf8"));
        if (parsed && parsed.schemaVersion === 1 && typeof parsed.hash === "string")
            return parsed.hash;
    }
    catch {
        // Corrupt/unreadable fingerprint -- fall back to a real rewrite below.
    }
    return undefined;
}
function writeSummaryFingerprint(fingerprintPath, fingerprint) {
    try {
        (0, fs_atomic_1.writeJson)(fingerprintPath, fingerprint);
    }
    catch {
        // Best-effort: a failed fingerprint write must never break the real call
        // -- it just means the next call falls back to a real rewrite.
    }
}
function summarizeTrustAudit(run, options = {}) {
    const persist = options.persist !== false;
    // A read-only projection must not call ensureTrustAudit(): that helper is
    // deliberately for mutation paths and creates the audit directory and an
    // empty event log when they are absent.
    const audit = persist ? ensureTrustAudit(run) : { schemaVersion: 1, ...trustAuditPaths(run) };
    const { events, corruptLines } = readEventsRawCounted(audit.eventLogPath);
    const ma = run.multiAgent;
    const bb = run.blackboard;
    const summary = {
        schemaVersion: exports.TRUST_AUDIT_SCHEMA_VERSION,
        runId: run.id,
        generatedAt: new Date().toISOString(),
        eventCount: events.length,
        integrity: verifyEventsChain(run.id, events, corruptLines),
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
    const index = {
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
    };
    // Durable: the summary/index are the read-side view of the audit log; persist
    // them durably so a crash can't leave them pointing past the last durably-
    // appended event. Byte-behavior port of the old build's summarizeTrustAudit.
    //
    // Skip the rewrite only when the freshly, fully recomputed content is
    // unchanged from last time (see the comment on `summaryFingerprintPathFor`
    // above) -- `generatedAt` is dropped before fingerprinting since it is the
    // one field that legitimately changes on every call. The RETURNED
    // `summary` below always carries a real, fresh `generatedAt` either way;
    // only the ON-DISK bytes may keep the previous call's `generatedAt` when
    // nothing else changed.
    const { generatedAt: _generatedAt, ...summaryForFingerprint } = summary;
    void _generatedAt;
    const fingerprintPath = summaryFingerprintPathFor(audit.summaryPath);
    const freshFingerprint = (0, hash_1.stableHash)({ summary: summaryForFingerprint, index });
    const priorFingerprint = readSummaryFingerprint(fingerprintPath);
    if (persist && priorFingerprint !== freshFingerprint) {
        (0, fs_atomic_1.writeJson)(audit.summaryPath, summary, { durable: true });
        (0, fs_atomic_1.writeJson)(audit.indexPath, index, { durable: true });
        writeSummaryFingerprint(fingerprintPath, { schemaVersion: 1, hash: freshFingerprint });
    }
    if (persist)
        run.audit = { schemaVersion: exports.TRUST_AUDIT_SCHEMA_VERSION, ...audit };
    return summary;
}
