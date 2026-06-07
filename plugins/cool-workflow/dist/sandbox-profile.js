"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SandboxProfileError = exports.DEFAULT_SANDBOX_PROFILE_ID = exports.SANDBOX_PROFILE_SCHEMA_VERSION = void 0;
exports.listBundledSandboxProfiles = listBundledSandboxProfiles;
exports.showBundledSandboxProfile = showBundledSandboxProfile;
exports.resolveSandboxProfileById = resolveSandboxProfileById;
exports.resolveSandboxProfile = resolveSandboxProfile;
exports.validateSandboxProfileFile = validateSandboxProfileFile;
exports.validateSandboxProfileDefinition = validateSandboxProfileDefinition;
exports.effectiveSandboxWritePaths = effectiveSandboxWritePaths;
exports.sandboxPolicyForWorker = sandboxPolicyForWorker;
exports.validateSandboxWrite = validateSandboxWrite;
exports.validateSandboxRead = validateSandboxRead;
exports.validateSandboxCommand = validateSandboxCommand;
exports.validateSandboxNetwork = validateSandboxNetwork;
exports.upsertRunSandboxPolicy = upsertRunSandboxPolicy;
exports.sandboxContextForRun = sandboxContextForRun;
exports.sandboxContextForValidation = sandboxContextForValidation;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
exports.SANDBOX_PROFILE_SCHEMA_VERSION = 1;
exports.DEFAULT_SANDBOX_PROFILE_ID = "default";
class SandboxProfileError extends Error {
    code;
    path;
    details;
    constructor(code, message, options = {}) {
        super(message);
        this.name = "SandboxProfileError";
        this.code = code;
        this.path = options.path;
        this.details = options.details;
    }
}
exports.SandboxProfileError = SandboxProfileError;
const BUNDLED_PROFILE_DEFINITIONS = [
    {
        schemaVersion: exports.SANDBOX_PROFILE_SCHEMA_VERSION,
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
        schemaVersion: exports.SANDBOX_PROFILE_SCHEMA_VERSION,
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
        schemaVersion: exports.SANDBOX_PROFILE_SCHEMA_VERSION,
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
        schemaVersion: exports.SANDBOX_PROFILE_SCHEMA_VERSION,
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
function listBundledSandboxProfiles(context = defaultSandboxContext()) {
    return BUNDLED_PROFILE_DEFINITIONS.map((profile) => resolveSandboxProfile(profile, context));
}
function showBundledSandboxProfile(id, context = defaultSandboxContext()) {
    const profile = BUNDLED_PROFILE_DEFINITIONS.find((candidate) => candidate.id === id);
    if (!profile) {
        throw new SandboxProfileError("sandbox-profile-not-found", `Sandbox profile not found: ${id}`, {
            details: { requestedProfileId: id, bundledProfileIds: BUNDLED_PROFILE_DEFINITIONS.map((candidate) => candidate.id) }
        });
    }
    return resolveSandboxProfile(profile, context);
}
function resolveSandboxProfileById(id, context = defaultSandboxContext()) {
    return showBundledSandboxProfile(id || exports.DEFAULT_SANDBOX_PROFILE_ID, context);
}
function resolveSandboxProfile(profile, context = defaultSandboxContext()) {
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
        schemaVersion: exports.SANDBOX_PROFILE_SCHEMA_VERSION,
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
function validateSandboxProfileFile(profileFile, context = defaultSandboxContext()) {
    const absolutePath = node_path_1.default.resolve(profileFile);
    const issues = [];
    if (hasTraversal(profileFile)) {
        issues.push(issue("sandbox-profile-invalid", `Profile file path contains traversal: ${profileFile}`, profileFile));
        return { valid: false, profileFile: absolutePath, issues };
    }
    if (!node_fs_1.default.existsSync(absolutePath)) {
        issues.push(issue("sandbox-profile-invalid", `Profile file does not exist: ${absolutePath}`, absolutePath));
        return { valid: false, profileFile: absolutePath, issues };
    }
    let profile;
    try {
        profile = JSON.parse(node_fs_1.default.readFileSync(absolutePath, "utf8"));
    }
    catch (error) {
        issues.push(issue("sandbox-profile-invalid", `Profile file is not valid JSON: ${messageOf(error)}`, absolutePath));
        return { valid: false, profileFile: absolutePath, issues };
    }
    issues.push(...validateSandboxProfileDefinition(profile, context));
    if (issues.length)
        return { valid: false, profileFile: absolutePath, issues };
    return { valid: true, profileFile: absolutePath, issues: [], profile: resolveSandboxProfile(profile, context) };
}
function validateSandboxProfileDefinition(profile, context = defaultSandboxContext()) {
    const issues = [];
    if (!profile || typeof profile !== "object") {
        return [issue("sandbox-profile-invalid", "Sandbox profile must be a JSON object")];
    }
    if (profile.schemaVersion !== exports.SANDBOX_PROFILE_SCHEMA_VERSION) {
        issues.push(issue("sandbox-profile-invalid", `Sandbox profile schemaVersion must be ${exports.SANDBOX_PROFILE_SCHEMA_VERSION}`));
    }
    if (!isValidId(profile.id))
        issues.push(issue("sandbox-profile-invalid", `Sandbox profile id is malformed: ${String(profile.id || "")}`));
    if (!profile.title || typeof profile.title !== "string")
        issues.push(issue("sandbox-profile-invalid", "Sandbox profile title is required"));
    validatePathList("readPaths", profile.readPaths || [], context, issues);
    validatePathList("writePaths", profile.writePaths || [], context, issues);
    validateCommandPolicy(profile.execute, issues);
    validateNetworkPolicy(profile.network, issues);
    validateEnvironmentPolicy(profile.env, issues);
    return issues;
}
function effectiveSandboxWritePaths(policy) {
    const workerPaths = [
        policy.workerOutput.result ? policy.metadata?.resultPath : undefined,
        policy.workerOutput.artifacts ? policy.metadata?.artifactsDir : undefined,
        policy.workerOutput.logs ? policy.metadata?.logsDir : undefined
    ].filter((value) => typeof value === "string" && value.length > 0);
    return uniqueResolvedPaths([...policy.writePaths, ...workerPaths], defaultSandboxContext());
}
function sandboxPolicyForWorker(profileId, context) {
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
function validateSandboxWrite(policy, rawPath, workerId = "") {
    return validateSandboxPathAccess("write", policy, rawPath, effectiveSandboxWritePaths(policy), workerId);
}
function validateSandboxRead(policy, rawPath, workerId = "") {
    return validateSandboxPathAccess("read", policy, rawPath, policy.readPaths, workerId);
}
function validateSandboxCommand(policy, command, workerId = "") {
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
function validateSandboxNetwork(policy, target, workerId = "") {
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
function upsertRunSandboxPolicy(run, policy) {
    run.sandboxProfiles = run.sandboxProfiles || [];
    const existing = run.sandboxProfiles.findIndex((candidate) => candidate.id === policy.id);
    run.sandboxProfiles =
        existing >= 0
            ? run.sandboxProfiles.map((candidate) => (candidate.id === policy.id ? policy : candidate))
            : [...run.sandboxProfiles, policy];
}
function sandboxContextForRun(run) {
    return {
        cwd: run.cwd,
        runDir: run.paths.runDir
    };
}
function sandboxContextForValidation(cwd = process.cwd()) {
    const root = node_path_1.default.resolve(cwd);
    const runDir = node_path_1.default.join(root, ".cw", "runs", "_sandbox-profile-validation");
    const workerDir = node_path_1.default.join(runDir, "workers", "_worker");
    return {
        cwd: root,
        runDir,
        workerDir,
        inputPath: node_path_1.default.join(workerDir, "input.md"),
        resultPath: node_path_1.default.join(workerDir, "result.md"),
        artifactsDir: node_path_1.default.join(workerDir, "artifacts"),
        logsDir: node_path_1.default.join(workerDir, "logs")
    };
}
function validateSandboxPathAccess(mode, policy, rawPath, allowedPaths, workerId) {
    if (hasTraversal(rawPath)) {
        return denied(`sandbox-${mode}-denied`, `Worker ${workerId} ${mode} path contains traversal: ${rawPath}`, rawPath, allowedPaths);
    }
    if (hasControlCharacters(rawPath)) {
        return denied(`sandbox-${mode}-denied`, `Worker ${workerId} ${mode} path is malformed: ${rawPath}`, rawPath, allowedPaths);
    }
    const candidate = node_path_1.default.resolve(rawPath);
    const insideAllowedPath = allowedPaths.some((allowed) => candidate === allowed || candidate.startsWith(`${allowed}${node_path_1.default.sep}`));
    if (!insideAllowedPath) {
        return denied(`sandbox-${mode}-denied`, `Worker ${workerId} ${mode} path is outside sandbox profile ${policy.id}: ${candidate}`, candidate, allowedPaths);
    }
    return null;
}
function denied(code, message, candidatePath, allowedPaths) {
    return {
        code,
        message,
        path: candidatePath,
        allowedPaths
    };
}
function defaultSandboxContext() {
    return sandboxContextForValidation(process.cwd());
}
function validatePathList(field, values, context, issues) {
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
        }
        catch (error) {
            issues.push(issue("sandbox-profile-invalid", messageOf(error), value));
        }
    }
}
function uniqueResolvedPaths(values, context) {
    const seen = new Set();
    const resolved = [];
    for (const value of values) {
        const candidate = resolveProfilePath(value, context);
        if (seen.has(candidate))
            continue;
        seen.add(candidate);
        resolved.push(candidate);
    }
    return resolved;
}
function resolveProfilePath(value, context) {
    const expanded = expandPathToken(value, context);
    if (hasTraversal(expanded)) {
        throw new SandboxProfileError("sandbox-profile-invalid", `Sandbox path contains traversal: ${value}`, { path: value });
    }
    return node_path_1.default.resolve(context.cwd, expanded);
}
function expandPathToken(value, context) {
    const tokens = {
        $cwd: context.cwd,
        $runDir: context.runDir,
        $workerDir: context.workerDir,
        $inputPath: context.inputPath,
        $resultPath: context.resultPath,
        $artifactsDir: context.artifactsDir,
        $logsDir: context.logsDir
    };
    if (!value.startsWith("$"))
        return value;
    const replacement = tokens[value];
    if (!replacement) {
        throw new SandboxProfileError("sandbox-profile-invalid", `Unknown or unavailable sandbox path token: ${value}`, {
            path: value
        });
    }
    return replacement;
}
function normalizeWorkerOutput(policy, context) {
    return {
        result: policy?.result ?? true,
        artifacts: context.allowArtifacts ?? policy?.artifacts ?? true,
        logs: context.allowLogs ?? policy?.logs ?? true
    };
}
function normalizeExecute(policy) {
    return {
        mode: policy?.mode || "none",
        allow: policy?.allow ? [...policy.allow] : undefined,
        deny: policy?.deny ? [...policy.deny] : undefined
    };
}
function normalizeNetwork(policy) {
    return {
        mode: policy?.mode || "none",
        allow: policy?.allow ? [...policy.allow] : undefined
    };
}
function normalizeEnv(policy) {
    return {
        inherit: Boolean(policy?.inherit),
        expose: policy?.expose ? [...policy.expose] : [],
        deny: policy?.deny ? [...policy.deny] : undefined
    };
}
function validateCommandPolicy(policy, issues) {
    if (!policy)
        return;
    if (!["none", "allowlist", "any"].includes(policy.mode)) {
        issues.push(issue("sandbox-profile-invalid", `execute.mode is invalid: ${String(policy.mode)}`));
    }
    for (const command of [...(policy.allow || []), ...(policy.deny || [])]) {
        if (!command || hasControlCharacters(command)) {
            issues.push(issue("sandbox-profile-invalid", `execute command is malformed: ${String(command)}`));
        }
    }
}
function validateNetworkPolicy(policy, issues) {
    if (!policy)
        return;
    if (!["none", "allowlist", "any"].includes(policy.mode)) {
        issues.push(issue("sandbox-profile-invalid", `network.mode is invalid: ${String(policy.mode)}`));
    }
    for (const target of policy.allow || []) {
        if (!target || hasControlCharacters(target)) {
            issues.push(issue("sandbox-profile-invalid", `network target is malformed: ${String(target)}`));
        }
    }
}
function validateEnvironmentPolicy(policy, issues) {
    if (!policy)
        return;
    for (const name of [...(policy.expose || []), ...(policy.deny || [])]) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
            issues.push(issue("sandbox-profile-invalid", `environment variable name is malformed: ${String(name)}`));
        }
    }
}
function issue(code, message, profilePath) {
    return { code, message, path: profilePath };
}
function isValidId(value) {
    return typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/.test(value);
}
function hasTraversal(value) {
    return value.split(/[\\/]+/).includes("..");
}
function hasControlCharacters(value) {
    return /[\u0000-\u001f]/.test(value);
}
function compactMetadata(value) {
    const entries = Object.entries(value).filter(([, entry]) => entry !== undefined);
    return entries.length ? Object.fromEntries(entries) : undefined;
}
function messageOf(error) {
    return error instanceof Error ? error.message : String(error);
}
