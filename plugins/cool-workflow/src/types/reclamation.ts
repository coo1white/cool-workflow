// Run Retention & Provable Reclamation (v0.1.39) — type contracts.
//
// Reclamation frees disk WITHOUT violating the audit/replay moat. It is a
// VERIFIABLE, append-only state transition: freeing bytes leaves behind a
// hash-chained tombstone proving what was freed is reconstructable-or-worthless
// and that the audit-essential subset is sealed. See docs/run-retention-reclamation.7.md.

import type { RunCapability, RunCapabilityReason, RunLifecycleState, RunTier } from "./run-registry";

/** The per-kind classification of a freeable path. A path is freeable ONLY if it
 *  is reconstructable from retained inputs + a recipe + an `expectDigest`, OR is
 *  pure scratch with zero audit value AND referenced by no surviving evidence
 *  locator / audit event. Any UNCLASSIFIED path defaults to RETAINED (fail-closed). */
export type ReclaimKind =
  | "scratch"
  | "reconstructable-snapshot"
  | "candidate"
  | "reference-free-blackboard";

/** Recipe to re-derive a reconstructable artifact from RETAINED inputs. The
 *  reconstruction verifier re-runs `recipeKind` over the retained inputs (keyed on
 *  `inputsDigest`) and asserts the result's sha256 equals `expectDigest` — it
 *  never routes through the freed source bytes. */
export interface ReconstructionRecipe {
  recipeKind: string;
  /** Per-input content digests retained on disk and fed to the recipe. */
  inputDigests: string[];
  /** Combined digest the verifier keys on (sha256 over the sorted inputDigests). */
  inputsDigest: string;
  /** sha256 the re-derivation MUST reproduce to prove faithfulness. */
  expectDigest: string;
  /** The node id / logical source the recipe reconstructs (for diagnostics). */
  sourceRef?: string;
}

/** One freed path, content-addressed BEFORE deletion so its existence is provable
 *  even with the bytes gone. */
export interface FreedManifestEntry {
  /** Path RELATIVE to the run dir (portable across machines). */
  path: string;
  kind: ReclaimKind;
  bytes: number;
  /** Pre-deletion sha256 of the file (or of the dir's stable content digest). */
  sha256: string;
  /** Present for reconstructable kinds; absent for pure scratch. */
  recipe?: ReconstructionRecipe;
}

/** The SKELETON — the audit-essential subset that MUST survive every reclamation.
 *  SKELETON_REQUIRED_KEYS is the machine-checkable contract; if extraction can't
 *  produce a complete skeleton, reclamation fails closed and frees nothing. */
export interface ReclamationSkeleton {
  schemaVersion: 1;
  runId: string;
  /** The run's terminal verdict (lifecycle + whether a verifier-gated commit sealed it). */
  finalVerdict: {
    lifecycle: RunLifecycleState;
    loopStage: string;
    terminal: boolean;
    commitGated: boolean;
  };
  /** Every commit record (verifier-gated commits carry the acceptance rationale). */
  commits: Array<{
    id: string;
    verifierGated: boolean;
    checkpoint: boolean;
    candidateId?: string;
    selectionId?: string;
    verifierNodeId?: string;
    evidenceCount: number;
    acceptanceRationale?: Record<string, unknown>;
  }>;
  /** Every surviving evidence locator's content digest (presence is sealed forever). */
  evidenceDigests: Array<{ ref: string; digest: string }>;
  /** The append-only attestation chain (digest of audit/events.jsonl + a slim index). */
  attestationChain: {
    auditLogDigest: string;
    eventCount: number;
    events: Array<{ id: string; kind: string; decision: string; createdAt: string }>;
  };
  /** The cost record: per-task host-attested usage + a metrics-report digest if present. */
  costRecord: {
    tasks: Array<{ taskId: string; model?: string; source?: string }>;
    metricsDigest?: string;
  };
  /** The append-only trust-audit log (allow-listed, never freed; digest sealed here). */
  auditLog: { path: string; digest: string };
  /** The append-only collaboration log (v0.1.32): approvals/comments/handoffs counts + digest. */
  collaborationLog: { digest: string; approvals: number; comments: number; handoffs: number };
  /** sha256 of the run's authoritative state.json at reclaim time. */
  stateDigest: string;
}

/** The tombstone — a NEW append-only `reclaimed.json` overlay (peer of archive.json).
 *  It is itself an audit record, hash-chained: `tombstoneHash` is recomputed from
 *  the freed-manifest + sealed skeleton + `prevTombstoneHash`; genesis
 *  `prevTombstoneHash` = sha256 of the sealed skeleton. A tampered entry is caught
 *  because `gc verify` recomputes `tombstoneHash` independently, never trusting
 *  the stored value. */
export interface ReclamationTombstone {
  schemaVersion: 1;
  runId: string;
  tombstoneId: string;
  reclaimedAt: string;
  actor?: string;
  /** sha256 of the canonicalized policy that authorized this reclamation. */
  policyDigest: string;
  freed: FreedManifestEntry[];
  bytesFreed: number;
  skeleton: ReclamationSkeleton;
  capability: RunCapability;
  capabilityReason: RunCapabilityReason;
  /** Prior tombstone's hash within this run (genesis = sha256 of sealed skeleton). */
  prevTombstoneHash: string;
  /** Recomputed from freed-manifest + skeleton + prevTombstoneHash. */
  tombstoneHash: string;
}

/** The `reclaimed.json` overlay file — the per-run append-only chain of tombstones.
 *  Lives in the run dir (peer of archive.json's role), in the ALLOW-LIST (never
 *  freed). The registry reads it to derive `tier`/`capability` per run. */
export interface ReclaimedOverlay {
  schemaVersion: 1;
  runId: string;
  tombstones: ReclamationTombstone[];
}

/** Closed enum of eligibility / refusal codes. */
export type ReclaimRefusalCode =
  | "not-archived"
  | "within-retention"
  | "non-terminal"
  | "open-feedback"
  | "unreadable"
  | "already-reclaimed"
  | "skeleton-incomplete";

/** Closed enum of `gc verify` failure codes. */
export type ReclaimVerifyCode =
  | "not-reclaimed"
  | "skeleton-incomplete"
  | "tombstone-digest-mismatch"
  | "tombstone-chain-broken"
  | "reconstruction-digest-mismatch"
  | "ineligible-when-reclaimed";

/** One freeable path as seen by `gc plan` (dry-run — frees nothing). */
export interface GcPlanFreeable {
  path: string;
  kind: ReclaimKind;
  bytes: number;
}

export interface GcPlanEntry {
  runId: string;
  repo: string;
  eligible: boolean;
  /** "eligible" when eligible, else the matching ReclaimRefusalCode. */
  reason: string;
  tier: RunTier;
  /** The capability the run WOULD downgrade to if reclaimed. */
  capability: RunCapability;
  capabilityReason: RunCapabilityReason;
  bytesToFree: number;
  byKind: Partial<Record<ReclaimKind, number>>;
  freeable: GcPlanFreeable[];
}

export interface GcPlanResult {
  schemaVersion: 1;
  scope: "repo" | "home";
  generatedAt: string;
  policy: { reclaimAfterArchiveDays: number; keepSnapshots: boolean; keepScratch: boolean; reclaimStates: RunLifecycleState[] };
  total: number;
  eligibleCount: number;
  bytesToFree: number;
  entries: GcPlanEntry[];
  nextAction: string;
}

export interface GcRunReclaimed {
  runId: string;
  bytesFreed: number;
  tombstoneHash: string;
  capability: RunCapability;
  capabilityReason: RunCapabilityReason;
}

export interface GcRunRefused {
  runId: string;
  code: ReclaimRefusalCode;
}

export interface GcRunResult {
  schemaVersion: 1;
  scope: "repo" | "home";
  generatedAt: string;
  dryRun: boolean;
  reclaimed: GcRunReclaimed[];
  refused: GcRunRefused[];
  totalBytesFreed: number;
  nextAction: string;
}

export interface GcVerifyCheck {
  name: string;
  pass: boolean;
  code?: ReclaimVerifyCode;
  detail?: string;
}

export interface GcVerifyResult {
  schemaVersion: 1;
  runId: string;
  reclaimed: boolean;
  verified: boolean;
  tier: RunTier;
  capability: RunCapability;
  capabilityReason?: RunCapabilityReason;
  tombstoneHash?: string;
  chainLength: number;
  checks: GcVerifyCheck[];
  nextAction: string;
}
