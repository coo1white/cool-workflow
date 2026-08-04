// core/types/execution-backend.ts — plain data shapes for the driver layer.
//
// MILESTONE 5 (plugins/cool-workflow/project/docs/rebuild/PLAN.md build order, step 5). Byte-exact port of the shapes
// in the old build's src/types/execution-backend.ts and the sandbox slice of
// src/types/sandbox.ts that this subsystem needs. Types only — no logic —
// so this file lives in core/ (moved here from shell/execution-backend/
// types.ts, which now re-exports it for its 7 existing importers): the
// executor-boundary welds in core/types/boundary.ts need ResultEnvelope
// and ExecutionResultEnvelope, and neither can be cherry-picked out of
// this file alone without also carrying their whole dependency graph
// (ExecutionProvenance, SandboxAttestation, BackendLocality/BackendKind,
// BackendExecutionHandle, ...) — so the file moves as one piece, matching
// its own original header's claim that it was "safe to import from both
// shell/ (impure) and any future core/ caller."
//
// Evidence: SPEC/execution-backend.md.

// ---------------------------------------------------------------------------
// Sandbox profile shapes (src/types/sandbox.ts).
// ---------------------------------------------------------------------------

export type SandboxPolicyMode = "none" | "allowlist" | "any";

export interface SandboxCommandPolicy {
  mode: SandboxPolicyMode;
  allow?: string[];
  deny?: string[];
}

export interface SandboxNetworkPolicy {
  mode: SandboxPolicyMode;
  allow?: string[];
}

export interface SandboxEnvironmentPolicy {
  inherit?: boolean;
  expose: string[];
  deny?: string[];
}

export interface SandboxWorkerOutputPolicy {
  result: boolean;
  artifacts: boolean;
  logs: boolean;
}

export interface SandboxProfileDefinition {
  schemaVersion: 1;
  id: string;
  title: string;
  description?: string;
  readPaths?: string[];
  writePaths?: string[];
  workerOutput?: Partial<SandboxWorkerOutputPolicy>;
  execute?: SandboxCommandPolicy;
  network?: SandboxNetworkPolicy;
  env?: SandboxEnvironmentPolicy;
  hostInstructions?: string[];
  metadata?: Record<string, unknown>;
}

export interface SandboxEnforcementContract {
  enforcedByCW: string[];
  hostRequired: string[];
}

export interface ResolvedSandboxPolicy {
  schemaVersion: 1;
  id: string;
  title: string;
  description?: string;
  readPaths: string[];
  writePaths: string[];
  workerOutput: SandboxWorkerOutputPolicy;
  execute: SandboxCommandPolicy;
  network: SandboxNetworkPolicy;
  env: SandboxEnvironmentPolicy;
  enforcement: SandboxEnforcementContract;
  hostInstructions: string[];
  resolvedAt: string;
  metadata?: Record<string, unknown>;
}

export interface SandboxResolutionContext {
  cwd: string;
  runDir?: string;
  workerDir?: string;
  inputPath?: string;
  resultPath?: string;
  artifactsDir?: string;
  logsDir?: string;
  extraReadPaths?: string[];
  extraWritePaths?: string[];
  allowArtifacts?: boolean;
  allowLogs?: boolean;
  customProfiles?: Record<string, SandboxProfileDefinition>;
}

export interface SandboxProfileValidationIssue {
  code: string;
  message: string;
  path?: string;
}

export interface SandboxProfileValidationResult {
  valid: boolean;
  profileFile: string;
  issues: SandboxProfileValidationIssue[];
  profile?: ResolvedSandboxPolicy;
}

export interface WorkerBoundaryViolation {
  code: string;
  message: string;
  path?: string;
  allowedPaths: string[];
}

// ---------------------------------------------------------------------------
// Execution backend shapes (src/types/execution-backend.ts).
// ---------------------------------------------------------------------------

export type SandboxDimension = "read" | "write" | "command" | "network" | "env";
export type BackendLocality = "local" | "remote";
export type BackendKind = "local" | "delegating";
export type BackendReadiness = "ready" | "unavailable" | "unverified";
export type SandboxDimensionSupport = "enforce" | "attest" | "unsupported";

export interface BackendCapability {
  dimension: SandboxDimension;
  support: SandboxDimensionSupport;
  detail?: string;
}

export interface BackendDescriptor {
  schemaVersion: 1;
  id: string;
  title: string;
  description: string;
  kind: BackendKind;
  locality: BackendLocality;
  default: boolean;
  capabilities: BackendCapability[];
  enforces: SandboxDimension[];
  attests: SandboxDimension[];
  delegate?: string;
  readiness: BackendReadiness;
}

export interface BackendProbeCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface BackendProbeResult {
  schemaVersion: 1;
  backendId: string;
  locality: BackendLocality;
  kind: BackendKind;
  readiness: BackendReadiness;
  ready: boolean;
  enforces: SandboxDimension[];
  attests: SandboxDimension[];
  checks: BackendProbeCheck[];
  reason?: string;
}

export type BackendSelectionSource = "flag" | "env" | "task" | "default";

export interface BackendSelection {
  backendId: string;
  source: BackendSelectionSource;
  requested?: string;
}

export type SandboxAttestationStatus = "enforced" | "attested" | "refused";

export interface BackendExecutionHandle {
  kind: "container" | "remote" | "ci" | "process";
  ref: string;
  image?: string;
  digest?: string;
  endpoint?: string;
  jobId?: string;
  metadata?: Record<string, unknown>;
}

export interface SandboxAttestation {
  schemaVersion: 1;
  backendId: string;
  locality: BackendLocality;
  kind: BackendKind;
  sandboxProfileId: string;
  required: SandboxDimension[];
  enforced: SandboxDimension[];
  attested: SandboxDimension[];
  unenforceable: SandboxDimension[];
  status: SandboxAttestationStatus;
  enforcedByCW: string[];
  hostRequired: string[];
  recordedAt: string;
  handle?: BackendExecutionHandle;
  notes?: string[];
}

export type ExecutionStatus = "completed" | "failed" | "refused";

export interface ResultEnvelope {
  summary: string;
  findings: unknown[];
  evidence: string[];
}

export interface WorkerManifestForExecution {
  workerDir?: string;
  manifestPath?: string;
  inputPath?: string;
  resultPath?: string;
  prompt?: string;
}

export interface ExecutionRequest {
  schemaVersion: 1;
  runId?: string;
  taskId?: string;
  backendId: string;
  command?: string;
  args?: string[];
  cwd: string;
  sandboxPolicy: ResolvedSandboxPolicy;
  manifest?: WorkerManifestForExecution;
  label?: string;
  delegation?: {
    image?: string;
    digest?: string;
    endpoint?: string;
    jobId?: string;
    command?: string;
    args?: string[];
    model?: string;
  };
  timeoutMs?: number;
  metadata?: Record<string, unknown>;
  preparedAgentOutcome?: AgentChildOutcome;
}

export interface AgentChildOutcome {
  spawnError?: string;
  exitCode: number | null;
  stdout: string;
}

export interface ExecutionProvenance {
  schemaVersion: 1;
  backendId: string;
  locality: BackendLocality;
  kind: BackendKind;
  attestation: SandboxAttestation;
  handle?: BackendExecutionHandle;
}

export interface ExecutionResultEnvelope {
  schemaVersion: 1;
  status: ExecutionStatus;
  result: ResultEnvelope;
  evidence: string[];
  provenance: ExecutionProvenance;
}

export interface AgentDelegationConfig {
  schemaVersion: 1;
  command?: string;
  args?: string[];
  endpoint?: string;
  model?: string;
  timeoutMs?: number;
  attestPublicKey?: string;
  requireAttestedTelemetry?: boolean;
  source?: "flag" | "env" | "file" | "auto" | "none";
}

export interface ExecutionBackend {
  descriptor: BackendDescriptor;
  probe(context: { cwd?: string }): BackendProbeResult;
  run(request: ExecutionRequest): ExecutionResultEnvelope;
}
