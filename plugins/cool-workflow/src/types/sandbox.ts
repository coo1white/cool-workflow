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
  // H7: durable CUSTOM profile definitions (keyed by logical profile id) threaded
  // from run.customSandboxProfiles. When a boundary re-resolves a custom profile
  // by its logical id after scope-snapshot loss, resolveSandboxProfileById finds
  // the DEFINITION here and re-resolves it against THIS (worker) context — so
  // worker-specific path tokens bind correctly instead of failing closed.
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
