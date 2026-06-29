import fs from "node:fs";
import path from "node:path";
import { isContainedPath } from "./state";
import {
  ResolvedSandboxPolicy,
  SandboxCommandPolicy,
  SandboxEnvironmentPolicy,
  SandboxNetworkPolicy,
  SandboxProfileDefinition,
  SandboxProfileValidationIssue,
  SandboxProfileValidationResult,
  SandboxResolutionContext,
  SandboxWorkerOutputPolicy,
  WorkerBoundaryViolation,
  WorkflowRun
} from "./types";

export const SANDBOX_PROFILE_SCHEMA_VERSION = 1;
export const DEFAULT_SANDBOX_PROFILE_ID = "default";

export class SandboxProfileError extends Error {
  code: string;
  path?: string;
  details?: Record<string, unknown>;

  constructor(code: string, message: string, options: { path?: string; details?: Record<string, unknown> } = {}) {
    super(message);
    this.name = "SandboxProfileError";
    this.code = code;
    this.path = options.path;
    this.details = options.details;
  }
}

const BUNDLED_PROFILE_DEFINITIONS: SandboxProfileDefinition[] = [
  {
    schemaVersion: SANDBOX_PROFILE_SCHEMA_VERSION,
    id: "default",
    title: "Default Worker Boundary",
    description: "Preserves existing CW worker isolation: workers may read the workspace and write only accepted worker output paths unless additional allowedPaths are supplied.",
    readPaths: ["$cwd", "$workerDir"],
    writePaths: [],
    workerOutput: { result: true, artifacts: true, logs: true },
    execute: { mode: "any" },
    network: { mode: "any" },
    env: { inherit: false, expose: [] },
    hostInstructions: [
      "Run with the host's normal process policy.",
      "Preserve CW output acceptance checks for result.md, artifacts/, and logs/."
    ]
  },
  {
    schemaVersion: SANDBOX_PROFILE_SCHEMA_VERSION,
    id: "readonly",
    title: "Readonly Workspace",
    description: "Workers may read the workspace and write only worker-local output paths accepted by CW.",
    readPaths: ["$cwd", "$workerDir"],
    writePaths: [],
    workerOutput: { result: true, artifacts: true, logs: true },
    execute: { mode: "any" },
    network: { mode: "none" },
    env: { inherit: false, expose: [] },
    hostInstructions: [
      "Deny network access unless the operator explicitly layers a site policy over this profile.",
      "Mount or expose the workspace read-only when the agent host supports it."
    ]
  },
  {
    schemaVersion: SANDBOX_PROFILE_SCHEMA_VERSION,
    id: "workspace-write",
    title: "Workspace Write",
    description: "Workers may read and write the workspace, plus worker-local output paths.",
    readPaths: ["$cwd", "$workerDir"],
    writePaths: ["$cwd"],
    workerOutput: { result: true, artifacts: true, logs: true },
    execute: { mode: "any" },
    network: { mode: "any" },
    env: { inherit: false, expose: [] },
    hostInstructions: [
      "Use only for workers that are expected to modify repository files.",
      "Keep CW run state writes under CW control; workers should still return results through worker output."
    ]
  },
  {
    schemaVersion: SANDBOX_PROFILE_SCHEMA_VERSION,
    id: "locked-down",
    title: "Locked Down",
    description: "Workers may read only their input and write only the primary result file. Command, network, and inherited environment access are denied by policy.",
    readPaths: ["$inputPath"],
    writePaths: [],
    workerOutput: { result: true, artifacts: false, logs: false },
    execute: { mode: "none" },
    network: { mode: "none" },
    env: { inherit: false, expose: [] },
    hostInstructions: [
      "Expose only input.md and result.md to the worker when host sandboxing is available.",
      "Do not provide shell command execution, network access, or inherited environment variables."
    ]
  }
];

export function bundledSandboxProfileIds(): string[] {
  return BUNDLED_PROFILE_DEFINITIONS.map((profile) => profile.id).sort();
}

export function isBundledSandboxProfileId(id: string): boolean {
  return BUNDLED_PROFILE_DEFINITIONS.some((profile) => profile.id === id);
}

export function listBundledSandboxProfiles(context: SandboxResolutionContext = defaultSandboxContext()): ResolvedSandboxPolicy[] {
  return BUNDLED_PROFILE_DEFINITIONS.map((profile) => resolveSandboxProfile(profile, context));
}

export function showBundledSandboxProfile(id: string, context: SandboxResolutionContext = defaultSandboxContext()): ResolvedSandboxPolicy {
  const profile = BUNDLED_PROFILE_DEFINITIONS.find((candidate) => candidate.id === id);
  if (!profile) {
    throw new SandboxProfileError("sandbox-profile-not-found", `Sandbox profile not found: ${id}`, {
      details: { requestedProfileId: id, bundledProfileIds: BUNDLED_PROFILE_DEFINITIONS.map((candidate) => candidate.id) }
    });
  }
  return resolveSandboxProfile(profile, context);
}

export function resolveSandboxProfileById(
  id: string | undefined,
  context: SandboxResolutionContext = defaultSandboxContext()
): ResolvedSandboxPolicy {
  const requested = id || DEFAULT_SANDBOX_PROFILE_ID;
  if (isBundledSandboxProfileId(requested)) return showBundledSandboxProfile(requested, context);
  // A non-bundled id that resolves to a readable profile FILE is a CUSTOM profile:
  // validate and ENFORCE it (the resolved policy snapshots onto the worker scope).
  // This closes the gap where `sandbox validate` accepted a custom profile that
  // dispatch/worker-isolation then refused — validated but never enforceable.
  // A non-bundled, non-file id still fails closed via showBundledSandboxProfile.
  const absolute = path.resolve(context.cwd, requested);
  if (!absolute.startsWith(path.resolve(context.cwd) + path.sep) && absolute !== path.resolve(context.cwd)) {
    throw new SandboxProfileError("sandbox-profile-path-escape", `Custom profile path traversal denied: ${requested}`, {
      details: { requested }
    });
  }
  if (fs.existsSync(absolute) && fs.statSync(absolute).isFile()) {
    const result = validateSandboxProfileFile(requested, context);
    if (!result.valid || !result.profile) {
      throw new SandboxProfileError("sandbox-profile-invalid", `Custom sandbox profile is invalid: ${requested}`, {
        details: { issues: result.issues }
      });
    }
    return result.profile;
  }
  // H7: a custom profile loaded from a FILE at dispatch persists as a DEFINITION
  // in run.customSandboxProfiles (threaded here as context.customProfiles). After a
  // worker scope snapshot is lost, the boundary re-resolves by the profile's
  // LOGICAL id (e.g. "my-custom"), and the dispatch-time file path is gone. Resolve
  // the persisted definition against the CURRENT (worker) context so worker-specific
  // path tokens ($workerDir etc.) bind to THIS worker — re-enforcing the same
  // policy instead of throwing not-found. This runs only after the bundled +
  // file-path branches, so a custom id never shadows a bundled or on-disk profile.
  const customDefinition = context.customProfiles?.[requested];
  if (customDefinition) {
    return resolveSandboxProfile(customDefinition, context);
  }
  return showBundledSandboxProfile(requested, context);
}

export function resolveSandboxProfile(
  profile: SandboxProfileDefinition,
  context: SandboxResolutionContext = defaultSandboxContext()
): ResolvedSandboxPolicy {
  const issues = validateSandboxProfileDefinition(profile, context);
  if (issues.length) {
    throw new SandboxProfileError("sandbox-profile-invalid", `Sandbox profile ${profile.id || "(unknown)"} is invalid`, {
      details: { issues }
    });
  }
  const workerOutput = normalizeWorkerOutput(profile.workerOutput, context);
  const readPaths = uniqueResolvedPaths([...(profile.readPaths || []), ...(context.extraReadPaths || [])], context);
  const writePaths = uniqueResolvedPaths([...(profile.writePaths || []), ...(context.extraWritePaths || [])], context);
  const execute = normalizeExecute(profile.execute);
  const network = normalizeNetwork(profile.network);
  const env = normalizeEnv(profile.env);
  return {
    schemaVersion: SANDBOX_PROFILE_SCHEMA_VERSION,
    id: profile.id,
    title: profile.title,
    description: profile.description,
    readPaths,
    writePaths,
    workerOutput,
    execute,
    network,
    env,
    enforcement: {
      enforcedByCW: [
        "profile validation",
        "path normalization",
        "worker result acceptance against sandbox write policy",
        "durable ErrorFeedback for denied worker output"
      ],
      hostRequired: [
        "OS-level read isolation",
        "OS-level write isolation before result acceptance",
        "process execution restrictions",
        "network restrictions",
        "environment variable filtering"
      ]
    },
    hostInstructions: profile.hostInstructions || [],
    resolvedAt: new Date().toISOString(),
    metadata: profile.metadata
  };
}

export function validateSandboxProfileFile(
  profileFile: string,
  context: SandboxResolutionContext = defaultSandboxContext()
): SandboxProfileValidationResult {
  const absolutePath = path.resolve(profileFile);
  const issues: SandboxProfileValidationIssue[] = [];
  if (hasTraversal(profileFile)) {
    issues.push(issue("sandbox-profile-invalid", `Profile file path contains traversal: ${profileFile}`, profileFile));
    return { valid: false, profileFile: absolutePath, issues };
  }
  if (!fs.existsSync(absolutePath)) {
    issues.push(issue("sandbox-profile-invalid", `Profile file does not exist: ${absolutePath}`, absolutePath));
    return { valid: false, profileFile: absolutePath, issues };
  }
  let profile: SandboxProfileDefinition;
  try {
    profile = JSON.parse(fs.readFileSync(absolutePath, "utf8")) as SandboxProfileDefinition;
  } catch (error) {
    issues.push(issue("sandbox-profile-invalid", `Profile file is not valid JSON: ${messageOf(error)}`, absolutePath));
    return { valid: false, profileFile: absolutePath, issues };
  }
  // Fail closed if a CUSTOM file reuses a BUNDLED id (H7 hardening): resolution is
  // bundled-first, so a custom "default"/"workspace-write"/... would be silently
  // shadowed by the WIDER bundled policy on a snapshot-loss re-resolve — widening
  // the sandbox with no error. Reserve the bundled names for bundled profiles.
  if (profile && typeof profile.id === "string" && isBundledSandboxProfileId(profile.id)) {
    issues.push(issue("sandbox-profile-invalid", `Custom sandbox profile id "${profile.id}" is reserved (collides with a bundled profile); choose a different id`, absolutePath));
    return { valid: false, profileFile: absolutePath, issues };
  }
  issues.push(...validateSandboxProfileDefinition(profile, context));
  if (issues.length) return { valid: false, profileFile: absolutePath, issues };
  return { valid: true, profileFile: absolutePath, issues: [], profile: resolveSandboxProfile(profile, context) };
}

export function validateSandboxProfileDefinition(
  profile: SandboxProfileDefinition,
  context: SandboxResolutionContext = defaultSandboxContext()
): SandboxProfileValidationIssue[] {
  const issues: SandboxProfileValidationIssue[] = [];
  if (!profile || typeof profile !== "object") {
    return [issue("sandbox-profile-invalid", "Sandbox profile must be a JSON object")];
  }
  if (profile.schemaVersion !== SANDBOX_PROFILE_SCHEMA_VERSION) {
    issues.push(issue("sandbox-profile-invalid", `Sandbox profile schemaVersion must be ${SANDBOX_PROFILE_SCHEMA_VERSION}`));
  }
  if (!isValidId(profile.id)) issues.push(issue("sandbox-profile-invalid", `Sandbox profile id is malformed: ${String(profile.id || "")}`));
  if (!profile.title || typeof profile.title !== "string") issues.push(issue("sandbox-profile-invalid", "Sandbox profile title is required"));
  validatePathList("readPaths", profile.readPaths || [], context, issues);
  validatePathList("writePaths", profile.writePaths || [], context, issues);
  validateCommandPolicy(profile.execute, issues);
  validateNetworkPolicy(profile.network, issues);
  validateEnvironmentPolicy(profile.env, issues);
  return issues;
}

export function effectiveSandboxWritePaths(policy: ResolvedSandboxPolicy): string[] {
  const workerPaths = [
    policy.workerOutput.result ? policy.metadata?.resultPath : undefined,
    policy.workerOutput.artifacts ? policy.metadata?.artifactsDir : undefined,
    policy.workerOutput.logs ? policy.metadata?.logsDir : undefined
  ].filter((value): value is string => typeof value === "string" && value.length > 0);
  return uniqueResolvedPaths([...policy.writePaths, ...workerPaths], defaultSandboxContext());
}

export function sandboxPolicyForWorker(
  profileId: string | undefined,
  context: SandboxResolutionContext
): ResolvedSandboxPolicy {
  const policy = resolveSandboxProfileById(profileId, context);
  return {
    ...policy,
    metadata: compactMetadata({
      ...(policy.metadata || {}),
      cwd: context.cwd,
      runDir: context.runDir,
      workerDir: context.workerDir,
      inputPath: context.inputPath,
      resultPath: context.resultPath,
      artifactsDir: context.artifactsDir,
      logsDir: context.logsDir
    })
  };
}

export function validateSandboxWrite(
  policy: ResolvedSandboxPolicy,
  rawPath: string,
  workerId = ""
): WorkerBoundaryViolation | null {
  return validateSandboxPathAccess("write", policy, rawPath, effectiveSandboxWritePaths(policy), workerId);
}

export function validateSandboxRead(
  policy: ResolvedSandboxPolicy,
  rawPath: string,
  workerId = ""
): WorkerBoundaryViolation | null {
  return validateSandboxPathAccess("read", policy, rawPath, policy.readPaths, workerId);
}

export function validateSandboxCommand(policy: ResolvedSandboxPolicy, command: string, workerId = ""): WorkerBoundaryViolation | null {
  const normalized = command.trim();
  if (!normalized || hasControlCharacters(normalized)) {
    return denied("sandbox-command-denied", `Worker ${workerId} command is malformed: ${command}`, undefined, effectiveSandboxWritePaths(policy));
  }
  if (policy.execute.mode === "none") {
    return denied("sandbox-command-denied", `Worker ${workerId} command execution is denied by sandbox profile ${policy.id}: ${normalized}`, undefined, effectiveSandboxWritePaths(policy));
  }
  if (policy.execute.mode === "allowlist" && !(policy.execute.allow || []).includes(normalized)) {
    return denied("sandbox-command-denied", `Worker ${workerId} command is outside sandbox profile ${policy.id}: ${normalized}`, undefined, effectiveSandboxWritePaths(policy));
  }
  return null;
}

export function validateSandboxNetwork(policy: ResolvedSandboxPolicy, target: string, workerId = ""): WorkerBoundaryViolation | null {
  const normalized = target.trim();
  if (!normalized || hasControlCharacters(normalized)) {
    return denied("sandbox-network-denied", `Worker ${workerId} network target is malformed: ${target}`, undefined, effectiveSandboxWritePaths(policy));
  }
  if (policy.network.mode === "none") {
    return denied("sandbox-network-denied", `Worker ${workerId} network access is denied by sandbox profile ${policy.id}: ${normalized}`, undefined, effectiveSandboxWritePaths(policy));
  }
  if (policy.network.mode === "allowlist" && !(policy.network.allow || []).includes(normalized)) {
    return denied("sandbox-network-denied", `Worker ${workerId} network target is outside sandbox profile ${policy.id}: ${normalized}`, undefined, effectiveSandboxWritePaths(policy));
  }
  return null;
}

export function upsertRunSandboxPolicy(run: WorkflowRun, policy: ResolvedSandboxPolicy): void {
  run.sandboxProfiles = run.sandboxProfiles || [];
  const existing = run.sandboxProfiles.findIndex((candidate) => candidate.id === policy.id);
  run.sandboxProfiles =
    existing >= 0
      ? run.sandboxProfiles.map((candidate) => (candidate.id === policy.id ? policy : candidate))
      : [...run.sandboxProfiles, policy];
}

export function sandboxContextForRun(run: WorkflowRun): SandboxResolutionContext {
  return {
    cwd: run.cwd,
    runDir: run.paths.runDir,
    // H7: thread persisted custom profile DEFINITIONS so a boundary re-resolve by
    // logical id can find + re-resolve a custom profile after snapshot loss.
    customProfiles: run.customSandboxProfiles
  };
}

export function sandboxContextForValidation(cwd = process.cwd()): SandboxResolutionContext {
  const root = path.resolve(cwd);
  const runDir = path.join(root, ".cw", "runs", "_sandbox-profile-validation");
  const workerDir = path.join(runDir, "workers", "_worker");
  return {
    cwd: root,
    runDir,
    workerDir,
    inputPath: path.join(workerDir, "input.md"),
    resultPath: path.join(workerDir, "result.md"),
    artifactsDir: path.join(workerDir, "artifacts"),
    logsDir: path.join(workerDir, "logs")
  };
}

function validateSandboxPathAccess(
  mode: "read" | "write",
  policy: ResolvedSandboxPolicy,
  rawPath: string,
  allowedPaths: string[],
  workerId: string
): WorkerBoundaryViolation | null {
  if (hasTraversal(rawPath)) {
    return denied(`sandbox-${mode}-denied`, `Worker ${workerId} ${mode} path contains traversal: ${rawPath}`, rawPath, allowedPaths);
  }
  if (hasControlCharacters(rawPath)) {
    return denied(`sandbox-${mode}-denied`, `Worker ${workerId} ${mode} path is malformed: ${rawPath}`, rawPath, allowedPaths);
  }
  const candidate = path.resolve(rawPath);
  // Symlink-hardened (v0.1.40 self-audit P1): isContainedPath realpaths both sides
  // so a planted symlink whose textual path looks "inside" an allowed root but
  // whose real target escapes it is denied, not silently accepted.
  const insideAllowedPath = allowedPaths.some((allowed) => isContainedPath(candidate, allowed));
  if (!insideAllowedPath) {
    return denied(`sandbox-${mode}-denied`, `Worker ${workerId} ${mode} path is outside sandbox profile ${policy.id}: ${candidate}`, candidate, allowedPaths);
  }
  return null;
}

function denied(code: string, message: string, candidatePath: string | undefined, allowedPaths: string[]): WorkerBoundaryViolation {
  return {
    code,
    message,
    path: candidatePath,
    allowedPaths
  };
}

function defaultSandboxContext(): SandboxResolutionContext {
  return sandboxContextForValidation(process.cwd());
}

function validatePathList(
  field: "readPaths" | "writePaths",
  values: string[],
  context: SandboxResolutionContext,
  issues: SandboxProfileValidationIssue[]
): void {
  if (!Array.isArray(values)) {
    issues.push(issue("sandbox-profile-invalid", `${field} must be an array`));
    return;
  }
  for (const value of values) {
    if (typeof value !== "string" || !value.trim()) {
      issues.push(issue("sandbox-profile-invalid", `${field} contains an empty or non-string path`));
      continue;
    }
    if (hasControlCharacters(value)) {
      issues.push(issue("sandbox-profile-invalid", `${field} contains a malformed path`, value));
      continue;
    }
    if (hasTraversal(value)) {
      issues.push(issue("sandbox-profile-invalid", `${field} contains traversal: ${value}`, value));
      continue;
    }
    try {
      resolveProfilePath(value, context);
    } catch (error) {
      issues.push(issue("sandbox-profile-invalid", messageOf(error), value));
    }
  }
}

function uniqueResolvedPaths(values: string[], context: SandboxResolutionContext): string[] {
  const seen = new Set<string>();
  const resolved: string[] = [];
  for (const value of values) {
    const candidate = resolveProfilePath(value, context);
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    resolved.push(candidate);
  }
  return resolved;
}

function resolveProfilePath(value: string, context: SandboxResolutionContext): string {
  const expanded = expandPathToken(value, context);
  if (hasTraversal(expanded)) {
    throw new SandboxProfileError("sandbox-profile-invalid", `Sandbox path contains traversal: ${value}`, { path: value });
  }
  return path.resolve(context.cwd, expanded);
}

function expandPathToken(value: string, context: SandboxResolutionContext): string {
  const tokens: Record<string, string | undefined> = {
    $cwd: context.cwd,
    $runDir: context.runDir,
    $workerDir: context.workerDir,
    $inputPath: context.inputPath,
    $resultPath: context.resultPath,
    $artifactsDir: context.artifactsDir,
    $logsDir: context.logsDir
  };
  if (!value.startsWith("$")) return value;
  const replacement = tokens[value];
  if (!replacement) {
    throw new SandboxProfileError("sandbox-profile-invalid", `Unknown or unavailable sandbox path token: ${value}`, {
      path: value
    });
  }
  return replacement;
}

function normalizeWorkerOutput(
  policy: Partial<SandboxWorkerOutputPolicy> | undefined,
  context: SandboxResolutionContext
): SandboxWorkerOutputPolicy {
  return {
    result: policy?.result ?? true,
    artifacts: context.allowArtifacts ?? policy?.artifacts ?? true,
    logs: context.allowLogs ?? policy?.logs ?? true
  };
}

function normalizeExecute(policy: SandboxCommandPolicy | undefined): SandboxCommandPolicy {
  return {
    mode: policy?.mode || "none",
    allow: policy?.allow ? [...policy.allow] : undefined,
    deny: policy?.deny ? [...policy.deny] : undefined
  };
}

function normalizeNetwork(policy: SandboxNetworkPolicy | undefined): SandboxNetworkPolicy {
  return {
    mode: policy?.mode || "none",
    allow: policy?.allow ? [...policy.allow] : undefined
  };
}

function normalizeEnv(policy: SandboxEnvironmentPolicy | undefined): SandboxEnvironmentPolicy {
  return {
    inherit: Boolean(policy?.inherit),
    expose: policy?.expose ? [...policy.expose] : [],
    deny: policy?.deny ? [...policy.deny] : undefined
  };
}

function validateCommandPolicy(policy: SandboxCommandPolicy | undefined, issues: SandboxProfileValidationIssue[]): void {
  if (!policy) return;
  if (!["none", "allowlist", "any"].includes(policy.mode)) {
    issues.push(issue("sandbox-profile-invalid", `execute.mode is invalid: ${String(policy.mode)}`));
  }
  for (const command of [...(policy.allow || []), ...(policy.deny || [])]) {
    if (!command || hasControlCharacters(command)) {
      issues.push(issue("sandbox-profile-invalid", `execute command is malformed: ${String(command)}`));
    }
  }
}

function validateNetworkPolicy(policy: SandboxNetworkPolicy | undefined, issues: SandboxProfileValidationIssue[]): void {
  if (!policy) return;
  if (!["none", "allowlist", "any"].includes(policy.mode)) {
    issues.push(issue("sandbox-profile-invalid", `network.mode is invalid: ${String(policy.mode)}`));
  }
  for (const target of policy.allow || []) {
    if (!target || hasControlCharacters(target)) {
      issues.push(issue("sandbox-profile-invalid", `network target is malformed: ${String(target)}`));
    }
  }
}

function validateEnvironmentPolicy(policy: SandboxEnvironmentPolicy | undefined, issues: SandboxProfileValidationIssue[]): void {
  if (!policy) return;
  for (const name of [...(policy.expose || []), ...(policy.deny || [])]) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      issues.push(issue("sandbox-profile-invalid", `environment variable name is malformed: ${String(name)}`));
    }
  }
}

function issue(code: string, message: string, profilePath?: string): SandboxProfileValidationIssue {
  return { code, message, path: profilePath };
}

function isValidId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/.test(value);
}

function hasTraversal(value: string): boolean {
  return value.split(/[\\/]+/).includes("..");
}

function hasControlCharacters(value: string): boolean {
  return /[\u0000-\u001f]/.test(value);
}

function compactMetadata(value: Record<string, unknown>): Record<string, unknown> | undefined {
  const entries = Object.entries(value).filter(([, entry]) => entry !== undefined);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
