import type { FindingClassification, PhaseStatus, Severity } from "./core";
import type { EvidenceProvenance } from "./trust";

export type EvidenceConfidence = "ungrounded" | "grounded" | "resolvable" | "verified";

export interface RunPaths {
  runDir: string;
  state: string;
  report: string;
  tasksDir: string;
  resultsDir: string;
  dispatchesDir: string;
  artifactsDir: string;
  commitsDir: string;
  stateNodesDir: string;
  feedbackDir: string;
  auditDir?: string;
  workersDir?: string;
  candidatesDir?: string;
  multiAgentDir?: string;
  blackboardDir?: string;
  topologiesDir?: string;
  /** Persisted operator graph snapshot path (v0.1.71). */
  graphSnapshotPath?: string;
}

export interface RunPhase {
  id: string;
  name: string;
  status: PhaseStatus;
  taskIds: string[];
  /** Carried from WorkflowPhaseDefinition.mode (parallel() DSL). The drive loop
   *  derives its round width from this: a "parallel" phase is fulfilled
   *  concurrently up to limits.maxConcurrentAgents through EVERY shipping
   *  surface (run --drive, quickstart). Absent ⇒ sequential. */
  mode?: "sequential" | "parallel";
}

export interface Finding {
  id: string;
  classification?: FindingClassification;
  severity?: Severity;
  evidence?: string[];
}

export interface ResultEnvelope {
  summary: string;
  findings: Finding[];
  evidence: string[];
}

export interface StateArtifact {
  id: string;
  kind: string;
  path: string;
  description?: string;
  /** SHA256 digest of the artifact content (v0.1.68). */
  sha256?: string;
  /** File size in bytes (v0.1.68). */
  sizeBytes?: number;
}

export interface StateEvidence {
  id: string;
  source?: string;
  path?: string;
  locator?: string;
  summary?: string;
  /** Derived confidence tier (v0.1.55): "ungrounded" | "grounded" | "resolvable" | "verified".
   *  Computed deterministically from the locator shape and (in strict mode) filesystem.
   *  "verified" is never auto-assigned — requires explicit host attestation. */
  confidence?: EvidenceConfidence;
  /** Optional reference to a recorded state record this evidence supports (v0.1.60).
   *  E.g. `{ kind: "candidate", id: "cand-1" }`, `{ kind: "commit", id: "c-abc" }`. */
  recordRef?: { kind: string; id: string };
  /** Extracted content from the evidence source file (v0.1.74).
   *  When a locator references `file.ts:42`, this holds the actual line content
   *  extracted from the file at resolution time. Never fabricated — absent when
   *  the file doesn't exist or the locator is not file-style. */
  contentPreview?: string;
  provenance?: EvidenceProvenance;
}
