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

import * as fs from "node:fs";
import * as path from "node:path";
import { eventHashInput, sha256, stableStringify } from "../core/hash";
import { durableAppendFileSync, safeFileName, withFileLock, writeJson, writeTextDurable } from "./fs-atomic";
import { StateEvidence, WorkflowRun } from "../core/state/types";

export const TRUST_AUDIT_SCHEMA_VERSION = 1;

export interface TrustAuditEvent {
  schemaVersion: 1;
  id: string;
  createdAt: string;
  runId: string;
  kind: string;
  decision: string;
  source: string;
  actor?: string;
  workerId?: string;
  taskId?: string;
  nodeId?: string;
  feedbackIds?: string[];
  candidateId?: string;
  scoreId?: string;
  selectionId?: string;
  commitId?: string;
  multiAgentRunId?: string;
  agentRoleId?: string;
  agentGroupId?: string;
  agentMembershipId?: string;
  agentFanoutId?: string;
  agentFaninId?: string;
  blackboardId?: string;
  blackboardTopicId?: string;
  blackboardMessageId?: string;
  blackboardContextId?: string;
  blackboardArtifactRefId?: string;
  blackboardSnapshotId?: string;
  coordinatorDecisionId?: string;
  topologyId?: string;
  topologyRunId?: string;
  sandboxProfileId?: string;
  policyRef?: string;
  policySnapshot?: unknown;
  normalizedPath?: string;
  command?: string;
  networkTarget?: string;
  envVars?: string[];
  evidence?: StateEvidence[];
  evidenceRefs?: string[];
  parentEventIds?: string[];
  metadata?: Record<string, unknown>;
  prevEventHash?: string;
  eventHash?: string;
}

export interface RecordTrustAuditInput {
  kind: string;
  decision: string;
  source: string;
  actor?: string;
  workerId?: string;
  taskId?: string;
  nodeId?: string;
  feedbackIds?: string[];
  candidateId?: string;
  scoreId?: string;
  selectionId?: string;
  commitId?: string;
  multiAgentRunId?: string;
  agentRoleId?: string;
  agentGroupId?: string;
  agentMembershipId?: string;
  agentFanoutId?: string;
  agentFaninId?: string;
  blackboardId?: string;
  blackboardTopicId?: string;
  blackboardMessageId?: string;
  blackboardContextId?: string;
  blackboardArtifactRefId?: string;
  blackboardSnapshotId?: string;
  coordinatorDecisionId?: string;
  topologyId?: string;
  topologyRunId?: string;
  sandboxProfileId?: string;
  policyRef?: string;
  policySnapshot?: { id?: string };
  normalizedPath?: string;
  command?: string;
  networkTarget?: string;
  envVars?: string[];
  evidence?: StateEvidence[];
  evidenceRefs?: string[];
  parentEventIds?: string[];
  metadata?: Record<string, unknown>;
}

function trustAuditPaths(run: WorkflowRun): { eventLogPath: string; summaryPath: string; indexPath: string } {
  const dir = run.paths.auditDir || path.join(run.paths.runDir, "audit");
  return {
    eventLogPath: path.join(dir, "events.jsonl"),
    summaryPath: path.join(dir, "summary.json"),
    indexPath: path.join(dir, "index.json"),
  };
}

export function ensureTrustAudit(run: WorkflowRun): { eventLogPath: string; summaryPath: string; indexPath: string } {
  const dir = run.paths.auditDir || path.join(run.paths.runDir, "audit");
  fs.mkdirSync(dir, { recursive: true });
  run.paths.auditDir = dir;
  const audit = { schemaVersion: 1 as const, ...trustAuditPaths(run) };
  run.audit = audit;
  if (!fs.existsSync(audit.eventLogPath)) fs.writeFileSync(audit.eventLogPath, "", "utf8");
  return audit;
}

/** Genesis prevHash for a run's chain (no prior event). Exported so
 *  callers outside this module (verify tooling, tests) can recompute it
 *  independently rather than trusting a stored value. */
export function trustAuditGenesis(runId: string): string {
  return sha256(`cw-trust-audit:${runId}`);
}

/** Canonical bytes the eventHash binds: every field EXCEPT eventHash
 *  itself, via core/hash.ts's `eventHashInput` (the JSON round-trip
 *  pre-pass that drops nested `undefined`-valued keys BEFORE the
 *  sort-and-stringify step — not a formatting flag on the same shape,
 *  see docs/rebuild/PLAN.md byte-compat item 2). Hashing the PERSISTED form this
 *  way makes record-time hashes equal verify-time (parsed-from-disk)
 *  hashes. */
function computeEventHash(event: TrustAuditEvent): string {
  const { eventHash, ...rest } = event;
  void eventHash;
  return sha256(eventHashInput(rest));
}

interface RawEventsRead {
  events: TrustAuditEvent[];
  corruptLines: number;
}

// Perf cycle P1-2: `recordTrustAuditEvent` needs only the PRIOR event count
// and the last event's hash to append the next one -- both were re-derived
// by parsing the ENTIRE log on every single append (O(events) per append,
// O(events^2) over a run's life; a live audit measured 80ms/append at 50k
// events). This sidecar caches exactly those two numbers, keyed by the
// log's own byte size so any external change (a repair, a torn write, a
// different process's append landing between reads) is caught and falls
// back to the full parse -- fail closed, never guessed. Deliberately NOT
// part of the persisted `run.audit`/`RunAuditPaths` shape (a typed,
// serialized field) since this is a purely-derived, rebuildable path, not
// run state; keeping it out avoids any state.json schema change.
interface AuditTailCache {
  schemaVersion: 1;
  logBytes: number;
  count: number;
  lastHash: string;
}

function tailCachePathFor(eventLogPath: string): string {
  return path.join(path.dirname(eventLogPath), "tail-cache.json");
}

function readAuditTailCache(tailCachePath: string): AuditTailCache | undefined {
  if (!fs.existsSync(tailCachePath)) return undefined;
  try {
    const parsed = JSON.parse(fs.readFileSync(tailCachePath, "utf8"));
    if (parsed && parsed.schemaVersion === 1 && typeof parsed.logBytes === "number" && typeof parsed.count === "number" && typeof parsed.lastHash === "string") {
      return parsed as AuditTailCache;
    }
  } catch {
    // Corrupt/unreadable cache -- fall back to the full parse below.
  }
  return undefined;
}

function writeAuditTailCache(tailCachePath: string, cache: AuditTailCache): void {
  try {
    writeJson(tailCachePath, cache);
  } catch {
    // Best-effort: a failed cache write must never break the real append.
  }
}

/** Deletes the tail cache so the NEXT append always re-derives ground
 *  truth from the real log, rather than trusting a byte-size coincidence.
 *  Called whenever something OTHER than a plain append changes the log's
 *  content (currently: repair). */
function invalidateAuditTailCache(eventLogPath: string): void {
  try {
    fs.unlinkSync(tailCachePathFor(eventLogPath));
  } catch {
    // Nothing to invalidate (no cache existed yet) -- fine.
  }
}

/** Read events in FILE (append) order, tolerating corrupt lines — one
 *  bad line must not brick the whole audit read surface (it is counted,
 *  not thrown). The chain links append order, so this is the order
 *  verification walks. */
function readEventsRawCounted(eventLogPath: string): RawEventsRead {
  if (!fs.existsSync(eventLogPath)) return { events: [], corruptLines: 0 };
  let corruptLines = 0;
  const events: TrustAuditEvent[] = [];
  for (const line of fs.readFileSync(eventLogPath, "utf8").split(/\n/g)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed) as TrustAuditEvent);
    } catch {
      corruptLines += 1;
    }
  }
  return { events, corruptLines };
}

function readEventsRaw(eventLogPath: string): TrustAuditEvent[] {
  return readEventsRawCounted(eventLogPath).events;
}

/** Every recorded trust-audit event for this run, in append (file) order.
 *  Used by trust-policy/collaboration summaries (e.g.
 *  hasAcceptedJudgeRationale, summarizeMultiAgentTrust). */
export function listTrustAuditEvents(run: WorkflowRun): TrustAuditEvent[] {
  return readEventsRaw(ensureTrustAudit(run).eventLogPath);
}

export interface TrustAuditCheck {
  name: string;
  pass: boolean;
  code?: string;
}

export interface TrustAuditIntegrity {
  present: boolean;
  verified: boolean;
  eventCount: number;
  chained: number;
  unchained: number;
  corruptLines: number;
  checks: TrustAuditCheck[];
}

/** Optional truncation anchor for verifyTrustAudit. A pure chain walk is
 *  blind to ONE tamper shape: deleting the last N lines of events.jsonl
 *  leaves a shorter but perfectly consistent chain, so verify stays green.
 *  An anchor captured earlier (see trustAuditHead) closes that hole:
 *  `expectHead` must appear among the chain's head hashes and the walked
 *  log must reach `expectCount` events, else verification fails closed
 *  with `trust-audit-truncated`. */
export interface TrustAuditAnchor {
  expectHead?: string;
  expectCount?: number;
}

export interface TrustAuditHead {
  eventCount: number;
  headHash: string;
}

/** The current head of a run's trust-audit chain: the hash the NEXT
 *  appended event will link from (genesis when the log is empty), plus
 *  the event count. Read-only projection over existing data. Capture it
 *  (e.g. right after a run, or at export time) and later hand it to
 *  `verifyTrustAudit`'s anchor / `cw audit verify --expect-head` to
 *  re-prove the log was not shortened since the capture. */
export function trustAuditHead(run: WorkflowRun): TrustAuditHead {
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
function verifyEventsChain(runId: string, events: TrustAuditEvent[], corruptLines: number, anchor?: TrustAuditAnchor): TrustAuditIntegrity {
  const checks: TrustAuditCheck[] = [];
  let verified = corruptLines === 0;
  if (corruptLines > 0) checks.push({ name: "parse", pass: false, code: "trust-audit-corrupt-line" });
  let chained = 0;
  let unchained = 0;
  let expectedPrev = trustAuditGenesis(runId);
  const headTrail = new Set<string>([expectedPrev]);
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

export function verifyTrustAudit(run: WorkflowRun, anchor?: TrustAuditAnchor): TrustAuditIntegrity {
  const audit = ensureTrustAudit(run);
  const { events, corruptLines } = readEventsRawCounted(audit.eventLogPath);
  return verifyEventsChain(run.id, events, corruptLines, anchor);
}

export interface TrustAuditRepairResult {
  /** "clean": nothing wrong, no action needed (exit 0). "repaired": a torn
   *  trailing write was found and removed (or would be, in dry-run; exit
   *  0). "refused": something IS wrong but this tool will not touch it —
   *  the corruption is not confined to exactly the trailing line, so it
   *  looks like tampering rather than a crash artifact (exit 1: this needs
   *  a human, not an auto-fix). */
  outcome: "clean" | "repaired" | "refused";
  reason: string;
  removedLines?: number;
  removedBytes?: number;
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
export function repairTrustAuditTornTail(run: WorkflowRun, options: { write?: boolean; anchor?: TrustAuditAnchor } = {}): TrustAuditRepairResult {
  const audit = ensureTrustAudit(run);
  return withFileLock(audit.eventLogPath, () => {
    const raw = fs.readFileSync(audit.eventLogPath, "utf8");
    const lines = raw.split("\n").filter((line) => line.trim() !== "");

    const badIndexes: number[] = [];
    const events: TrustAuditEvent[] = [];
    lines.forEach((line, i) => {
      try {
        events.push(JSON.parse(line) as TrustAuditEvent);
      } catch {
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
      writeTextDurable(audit.eventLogPath, repairedContent, { durable: true });
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

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function scrubMetadata(value: Record<string, unknown>): Record<string, unknown> | undefined {
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined) continue;
    if (/secret|token|password|credential|authorization|api[_-]?key/i.test(key)) {
      result[key] = "[redacted]";
    } else if (Array.isArray(entry)) {
      result[key] = entry.map((item) => (typeof item === "string" && item.includes("=") ? item.split("=")[0] : item));
    } else if (entry && typeof entry === "object") {
      result[key] = scrubMetadata(entry as Record<string, unknown>);
    } else {
      result[key] = entry;
    }
  }
  return Object.keys(result).length ? result : undefined;
}

function compact(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

/** `count` must be the number of PRIOR events, read under the SAME lock
 *  the append itself happens under (see `recordTrustAuditEvent`) — an
 *  earlier version read this count separately, outside any lock, so two
 *  concurrent writers could mint the SAME id for two different events
 *  (the hash chain still forked-proof, but the id — referenced elsewhere
 *  as `auditEventIds`/`parentEventIds` for provenance — was not unique). */
function createEventId(kind: string, count: number): string {
  return `audit-${safeFileName(kind)}-${String(count + 1).padStart(4, "0")}`;
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
] as const;

function pickCorrelationIds(source: RecordTrustAuditInput): Record<string, string | undefined> {
  const picked: Record<string, string | undefined> = {};
  for (const field of CORRELATION_ID_FIELDS) picked[field] = source[field];
  return picked;
}

/** The audit index historically omits scoreId (byte-exact to the old build's
 *  INDEX_OMITTED_CORRELATION_IDS). */
const INDEX_OMITTED_CORRELATION_IDS: ReadonlySet<string> = new Set(["scoreId"]);

function indexCorrelationIds(event: TrustAuditEvent): Record<string, string | undefined> {
  const picked: Record<string, string | undefined> = {};
  for (const field of CORRELATION_ID_FIELDS) {
    if (INDEX_OMITTED_CORRELATION_IDS.has(field)) continue;
    picked[field] = (event as unknown as Record<string, string | undefined>)[field];
  }
  return picked;
}

/** True when the event log's final byte is "\n". A COMPLETED
 *  `durableAppendFileSync` always leaves the log ending in "\n" (it writes
 *  `<json>\n`), so a non-newline last byte means the previous append was
 *  torn by a crash — its bytes were never a confirmed event. Reads ONLY the
 *  last byte at `size-1`, so the append path stays O(1) and never re-reads
 *  the whole log (keeping the tail-cache perf win). A read failure returns
 *  false (treat as "not newline-terminated") — the safe side: an extra
 *  leading newline is harmless (readEventsRaw skips blank lines), while a
 *  MISSED torn boundary would merge two events into one unparseable line. */
function logEndsWithNewline(file: string, size: number): boolean {
  if (size <= 0) return false;
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(1);
    fs.readSync(fd, buf, 0, 1, size - 1);
    return buf[0] === 0x0a; // "\n"
  } catch {
    return false;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/** Read-modify-append: computes `prevEventHash` from the CURRENT last event
 *  and appends. Held under `withFileLock` (like every other read-modify-
 *  write in this codebase) so two processes recording events for the same
 *  run at once can never both read the same tail and compute the same
 *  `prevEventHash` — that would fork the hash chain, and a forked chain
 *  fails `verifyTrustAudit` for good, with no repair for THAT shape (unlike
 *  a torn trailing write, a fork is not confined to the last line). */
export function recordTrustAuditEvent(run: WorkflowRun, input: RecordTrustAuditInput): TrustAuditEvent {
  const audit = ensureTrustAudit(run);
  // `id` is NOT set here — it depends on the prior event count, which (like
  // prevEventHash) must be read under the lock below, or two concurrent
  // writers could mint the same id for two different events.
  const event = compact({
    schemaVersion: TRUST_AUDIT_SCHEMA_VERSION,
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
  }) as unknown as TrustAuditEvent;
  return withFileLock(audit.eventLogPath, () => {
    // The prior event count and last-event hash are the ONLY two things
    // this append needs from the existing log. A tail cache (keyed on the
    // log's own byte size) serves both without a full parse when nothing
    // else has touched the log since it was written; any size mismatch
    // (a repair, a torn write, this being the very first append) falls
    // back to the full parse, same as before this cache existed.
    const tailCachePath = tailCachePathFor(audit.eventLogPath);
    const currentBytes = fs.existsSync(audit.eventLogPath) ? fs.statSync(audit.eventLogPath).size : 0;
    const cached = readAuditTailCache(tailCachePath);
    let count: number;
    let prevHash: string;
    if (cached && cached.logBytes === currentBytes) {
      count = cached.count;
      prevHash = cached.lastHash;
    } else {
      const prior = readEventsRaw(audit.eventLogPath);
      count = prior.length;
      prevHash = prior.length ? prior[prior.length - 1].eventHash || computeEventHash(prior[prior.length - 1]) : trustAuditGenesis(run.id);
    }
    event.id = createEventId(input.kind, count);
    event.prevEventHash = prevHash;
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
    const leadingNewline = currentBytes > 0 && !logEndsWithNewline(audit.eventLogPath, currentBytes) ? "\n" : "";
    const line = `${leadingNewline}${JSON.stringify(event)}\n`;
    durableAppendFileSync(audit.eventLogPath, line);
    writeAuditTailCache(tailCachePath, { schemaVersion: 1, logBytes: currentBytes + Buffer.byteLength(line, "utf8"), count: count + 1, lastHash: event.eventHash });
    return event;
  });
}

export function recordSandboxPathDecision(
  run: WorkflowRun,
  input: { workerId: string; taskId?: string; sandboxProfileId?: string; policySnapshot?: { id?: string }; target: string; decision: "allowed" | "denied"; metadata?: Record<string, unknown> }
): TrustAuditEvent {
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

export interface EvidenceProvenance {
  schemaVersion: 1;
  runId: string;
  source: string;
  workerId?: string;
  taskId?: string;
  resultNodeId?: string;
  verifierNodeId?: string;
  candidateId?: string;
  scoreId?: string;
  selectionId?: string;
  commitId?: string;
  parentEvidenceIds: string[];
  auditEventIds: string[];
  note?: string;
}

/** normalizeEvidence — GROUNDING-ONLY provenance. Never carries the
 *  agent's command/args/model/handle (those live ONLY in
 *  node.metadata.agentDelegation) — this is the exact hygiene split
 *  exechard-evidence-triple-hygiene.case.js pins. */
export function normalizeEvidence(
  run: WorkflowRun,
  evidence: StateEvidence[],
  provenance: {
    source: string;
    workerId?: string;
    taskId?: string;
    resultNodeId?: string;
    verifierNodeId?: string;
    candidateId?: string;
    scoreId?: string;
    selectionId?: string;
    commitId?: string;
    parentEvidenceIds?: string[];
    auditEventIds?: string[];
    note?: string;
  }
): StateEvidence[] {
  return evidence.map((entry) => ({
    ...entry,
    confidence: entry.confidence || (entry.locator || entry.path || entry.summary ? "grounded" : "ungrounded"),
    provenance: {
      schemaVersion: TRUST_AUDIT_SCHEMA_VERSION,
      runId: run.id,
      source: provenance.source || entry.provenance?.source || "runtime-derived",
      workerId: provenance.workerId || (entry.provenance as Record<string, unknown> | undefined)?.workerId,
      taskId: provenance.taskId || (entry.provenance as Record<string, unknown> | undefined)?.taskId,
      resultNodeId: provenance.resultNodeId || (entry.provenance as Record<string, unknown> | undefined)?.resultNodeId,
      verifierNodeId: provenance.verifierNodeId || (entry.provenance as Record<string, unknown> | undefined)?.verifierNodeId,
      candidateId: provenance.candidateId || (entry.provenance as Record<string, unknown> | undefined)?.candidateId,
      scoreId: provenance.scoreId || (entry.provenance as Record<string, unknown> | undefined)?.scoreId,
      selectionId: provenance.selectionId || (entry.provenance as Record<string, unknown> | undefined)?.selectionId,
      commitId: provenance.commitId || (entry.provenance as Record<string, unknown> | undefined)?.commitId,
      parentEvidenceIds: unique([...(((entry.provenance as Record<string, unknown> | undefined)?.parentEvidenceIds as string[]) || []), ...(provenance.parentEvidenceIds || [])]).sort(),
      auditEventIds: unique([...(((entry.provenance as Record<string, unknown> | undefined)?.auditEventIds as string[]) || []), ...(provenance.auditEventIds || [])]).sort(),
      note: provenance.note || (entry.provenance as Record<string, unknown> | undefined)?.note,
    } as unknown as StateEvidence["provenance"],
  }));
}

export function writeTrustAuditIndexPlaceholder(run: WorkflowRun): void {
  const audit = ensureTrustAudit(run);
  writeJson(audit.summaryPath, { schemaVersion: 1, runId: run.id, eventCount: readEventsRaw(audit.eventLogPath).length });
}

function countBy<T>(values: T[], key: (v: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    const bucket = key(value);
    counts[bucket] = (counts[bucket] || 0) + 1;
  }
  return counts;
}

export interface TrustAuditSummary {
  schemaVersion: 1;
  runId: string;
  generatedAt: string;
  eventCount: number;
  integrity: TrustAuditIntegrity;
  eventLogPath: string;
  indexPath: string;
  summaryPath: string;
  byKind: Record<string, number>;
  byDecision: Record<string, number>;
  bySource: Record<string, number>;
  bySandboxProfile: Record<string, number>;
  workers: Array<{ workerId: string; taskId?: string; sandboxProfileId?: string; decisions: Record<string, number>; denied: number; feedbackIds: string[] }>;
  candidates: Array<{ candidateId: string; scoreIds: string[]; selectionIds: string[]; evidenceCount: number }>;
  commits: Array<{ commitId: string; verifierGated: boolean; candidateId?: string; selectionId?: string; evidenceCount: number; rationale?: Record<string, unknown> }>;
  multiAgent: { runs: number; roles: number; groups: number; memberships: number; fanouts: number; fanins: number; events: number };
  blackboard: { boards: number; topics: number; messages: number; contexts: number; artifacts: number; snapshots: number; decisions: number; events: number };
  topologies: { runs: number; events: number };
  multiAgentTrust: { rolePolicies: number; permissionDecisions: number; blackboardWrites: number; messageProvenance: number; judgeRationales: number; panelDecisions: number; policyViolations: number };
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
function groupEventsBy(events: TrustAuditEvent[], key: (e: TrustAuditEvent) => string | undefined): Map<string, TrustAuditEvent[]> {
  const groups = new Map<string, TrustAuditEvent[]>();
  for (const event of events) {
    const k = key(event);
    if (!k) continue;
    const list = groups.get(k);
    if (list) list.push(event);
    else groups.set(k, [event]);
  }
  return groups;
}

function workerRows(events: TrustAuditEvent[], run: WorkflowRun): TrustAuditSummary["workers"] {
  const workers = (run.workers as Array<{ id: string; taskId?: string; sandboxProfileId?: string }> | undefined) || [];
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

function candidateRows(events: TrustAuditEvent[], run: WorkflowRun): TrustAuditSummary["candidates"] {
  const cands = (run.candidates as Array<{ id: string; scores?: string[]; evidence?: unknown[] }> | undefined) || [];
  const selectionsAll = (run.candidateSelections as Array<{ id: string; candidateId: string }> | undefined) || [];
  const candsById = new Map(cands.map((c) => [c.id, c]));
  const selectionsByCandidateId = new Map<string, Array<{ id: string; candidateId: string }>>();
  for (const selection of selectionsAll) {
    const list = selectionsByCandidateId.get(selection.candidateId);
    if (list) list.push(selection);
    else selectionsByCandidateId.set(selection.candidateId, [selection]);
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

function commitRows(events: TrustAuditEvent[], run: WorkflowRun): TrustAuditSummary["commits"] {
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
      rationale: commit?.acceptanceRationale as Record<string, unknown> | undefined,
    };
  });
}

export function summarizeTrustAudit(run: WorkflowRun): TrustAuditSummary {
  const audit = ensureTrustAudit(run);
  const events = readEventsRaw(audit.eventLogPath);
  const ma = run.multiAgent;
  const bb = run.blackboard;
  const summary: TrustAuditSummary = {
    schemaVersion: TRUST_AUDIT_SCHEMA_VERSION,
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
    bySandboxProfile: countBy(
      events.filter((event) => event.sandboxProfileId),
      (event) => event.sandboxProfileId || "none"
    ),
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
  writeJson(audit.summaryPath, summary, { durable: true });
  writeJson(
    audit.indexPath,
    {
      schemaVersion: TRUST_AUDIT_SCHEMA_VERSION,
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
    },
    { durable: true }
  );
  run.audit = { schemaVersion: TRUST_AUDIT_SCHEMA_VERSION, ...audit };
  return summary;
}
