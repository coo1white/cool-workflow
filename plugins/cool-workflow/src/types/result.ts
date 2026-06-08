import type { FindingClassification, PhaseStatus, Severity } from "./core";
import type { EvidenceProvenance } from "./trust";

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
}

export interface RunPhase {
  id: string;
  name: string;
  status: PhaseStatus;
  taskIds: string[];
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
}

export interface StateEvidence {
  id: string;
  source?: string;
  path?: string;
  locator?: string;
  summary?: string;
  provenance?: EvidenceProvenance;
}
