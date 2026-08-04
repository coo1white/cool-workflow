"use strict";
// shell/agent-config.ts — agent delegation config: env/file/flag resolution
// order, CW_HOME resolution, builtin:<name> expansion, PATH auto-detect.
//
// MILESTONE 5 (plugins/cool-workflow/project/docs/rebuild/PLAN.md build order, step 5). Byte-exact port of
// plugins/cool-workflow/src/agent-config.ts.
//
// Resolution order per field: flags > env > a durable
// $CW_HOME/agent-config.json > auto-detect > none. NO SECRETS IN COMMITTED
// STATE: the durable config holds a command-TEMPLATE + endpoint + operator-
// chosen model only; a secret-looking arg is stripped before persisting or
// showing.
//
// Evidence: SPEC/execution-backend.md "Agent delegation config".
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
exports.AGENT_CONFIG_SCHEMA_VERSION = void 0;
exports.resolveCwHome = resolveCwHome;
exports.agentConfigPath = agentConfigPath;
exports.loadAgentConfigFile = loadAgentConfigFile;
exports.resolveAgentConfig = resolveAgentConfig;
exports.agentConfigured = agentConfigured;
exports.setAgentConfigFile = setAgentConfigFile;
exports.agentConfigShow = agentConfigShow;
exports.backendAgentConfigSet = backendAgentConfigSet;
exports.backendAgentConfigShow = backendAgentConfigShow;
const fs = __importStar(require("node:fs"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const fs_atomic_1 = require("./fs-atomic");
const agent_1 = require("./execution-backend/agent");
exports.AGENT_CONFIG_SCHEMA_VERSION = 1;
/** CW_HOME resolution: CW_HOME > XDG_STATE_HOME/cool-workflow > ~/.local/state/cool-workflow. */
function resolveCwHome(env = process.env) {
    if (env.CW_HOME && String(env.CW_HOME).trim())
        return path.resolve(String(env.CW_HOME));
    if (env.XDG_STATE_HOME && String(env.XDG_STATE_HOME).trim()) {
        return path.join(path.resolve(String(env.XDG_STATE_HOME)), "cool-workflow");
    }
    return path.join(os.homedir(), ".local", "state", "cool-workflow");
}
function agentConfigPath(env = process.env) {
    return path.join(resolveCwHome(env), "agent-config.json");
}
function trimmed(value) {
    if (typeof value !== "string")
        return undefined;
    const out = value.trim();
    return out ? out : undefined;
}
function boolish(value) {
    if (typeof value === "boolean")
        return value;
    if (typeof value === "string") {
        const v = value.trim().toLowerCase();
        if (["1", "true", "yes", "on"].includes(v))
            return true;
        if (["0", "false", "no", "off"].includes(v))
            return false;
    }
    return undefined;
}
function asStringArray(value) {
    if (!Array.isArray(value))
        return undefined;
    const out = value.map((entry) => String(entry));
    return out.length ? out : undefined;
}
function firstDefined(...values) {
    for (const value of values)
        if (value !== undefined)
            return value;
    return undefined;
}
/** Split a single command string ("claude -p {{manifest}}") into binary +
 *  argv template — NEVER shell-interpreted. An explicit args array always
 *  wins. */
function splitCommand(command, args) {
    if (!command)
        return { command: undefined, args };
    if (args && args.length)
        return { command, args };
    if (/\s/.test(command)) {
        const parts = command.split(/\s+/).filter(Boolean);
        return { command: parts[0], args: parts.slice(1) };
    }
    return { command, args };
}
/** Read the durable config FILE (if any). Never throws — a corrupt file is
 *  treated as absent (fail closed). */
function loadAgentConfigFile(env = process.env) {
    const file = agentConfigPath(env);
    if (!fs.existsSync(file))
        return undefined;
    try {
        const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
        return {
            schemaVersion: 1,
            command: trimmed(parsed.command),
            args: asStringArray(parsed.args),
            endpoint: trimmed(parsed.endpoint),
            model: trimmed(parsed.model),
            timeoutMs: typeof parsed.timeoutMs === "number" ? parsed.timeoutMs : undefined,
            attestPublicKey: trimmed(parsed.attestPublicKey),
            requireAttestedTelemetry: boolish(parsed.requireAttestedTelemetry),
            source: "file",
        };
    }
    catch {
        return undefined;
    }
}
function agentConfigFromEnv(env) {
    const split = splitCommand(trimmed(env.CW_AGENT_COMMAND), undefined);
    return {
        schemaVersion: 1,
        command: split.command,
        args: split.args,
        endpoint: trimmed(env.CW_AGENT_ENDPOINT),
        model: trimmed(env.CW_AGENT_MODEL),
        timeoutMs: trimmed(env.CW_AGENT_TIMEOUT_MS) ? Number(env.CW_AGENT_TIMEOUT_MS) : undefined,
        attestPublicKey: trimmed(env.CW_AGENT_ATTEST_PUBKEY),
        requireAttestedTelemetry: boolish(env.CW_REQUIRE_ATTESTED_TELEMETRY),
        source: "env",
    };
}
function agentConfigFromArgs(args) {
    const rawCommand = trimmed(args.agentCommand ?? args["agent-command"]);
    const rawArgs = asStringArray(args.agentArgs ?? args["agent-args"]);
    const split = splitCommand(rawCommand, rawArgs);
    const rawTimeout = args.agentTimeoutMs ?? args["agent-timeout-ms"];
    return {
        schemaVersion: 1,
        command: split.command,
        args: split.args,
        endpoint: trimmed(args.agentEndpoint ?? args["agent-endpoint"]),
        model: trimmed(args.agentModel ?? args["agent-model"]),
        timeoutMs: rawTimeout !== undefined ? Number(rawTimeout) : undefined,
        attestPublicKey: trimmed(args.agentAttestPublicKey ?? args["agent-attest-public-key"]),
        requireAttestedTelemetry: boolish(args.requireAttestedTelemetry ?? args["require-attested-telemetry"]),
        source: "flag",
    };
}
/** Detect which known agent CLIs are on PATH. Returns the first found, or
 *  undefined. Skipped when CW_NO_AUTO_AGENT=1. */
function detectAgentFromPath(env = process.env) {
    if (env.CW_NO_AUTO_AGENT === "1")
        return undefined;
    const known = ["claude", "codex", "gemini", "opencode"];
    const dirs = (env.PATH || "").split(path.delimiter).filter(Boolean);
    const exts = process.platform === "win32" ? (env.PATHEXT || ".EXE;.CMD;.BAT").split(";") : [""];
    const templates = builtinAgentTemplates();
    for (const name of known) {
        if (!templates[name])
            continue;
        for (const dir of dirs) {
            for (const ext of exts) {
                try {
                    if (fs.statSync(path.join(dir, name + ext)).isFile())
                        return name;
                }
                catch {
                    /* keep looking */
                }
            }
        }
    }
    return undefined;
}
function builtinAgentTemplates() {
    const agentsDir = path.join(__dirname, "..", "..", "scripts", "agents");
    const manifest = JSON.parse(fs.readFileSync(path.join(agentsDir, "builtin-templates.json"), "utf8"));
    const out = {};
    for (const [name, script] of Object.entries(manifest.templates || {})) {
        out[name] = `node ${path.join(agentsDir, script)} {{input}} {{result}}`;
    }
    return out;
}
function expandBuiltinAgentCommand(command) {
    if (!command || !command.startsWith("builtin:"))
        return command;
    const name = command.slice("builtin:".length).trim();
    const templates = builtinAgentTemplates();
    const template = templates[name];
    if (!template) {
        throw new Error(`Unknown builtin agent template "${name}" — available: ${Object.keys(templates).join(", ")}`);
    }
    return template;
}
/** Resolve the EFFECTIVE agent config: flags > env > file > auto-detect >
 *  none. The returned `source` names the layer the command/endpoint came
 *  from. */
function resolveAgentConfig(args = {}, env = process.env) {
    const flagCfg = agentConfigFromArgs(args);
    const envCfg = agentConfigFromEnv(env);
    const fileCfg = loadAgentConfigFile(env);
    const command = expandBuiltinAgentCommand(firstDefined(flagCfg.command, envCfg.command, fileCfg?.command));
    const cfgArgs = firstDefined(flagCfg.args, envCfg.args, fileCfg?.args);
    const endpoint = firstDefined(flagCfg.endpoint, envCfg.endpoint, fileCfg?.endpoint);
    const model = firstDefined(flagCfg.model, envCfg.model, fileCfg?.model);
    const timeoutMs = firstDefined(flagCfg.timeoutMs, envCfg.timeoutMs, fileCfg?.timeoutMs);
    const attestPublicKey = firstDefined(flagCfg.attestPublicKey, envCfg.attestPublicKey, fileCfg?.attestPublicKey);
    const requireAttestedTelemetry = firstDefined(flagCfg.requireAttestedTelemetry, envCfg.requireAttestedTelemetry, fileCfg?.requireAttestedTelemetry);
    const source = flagCfg.command || flagCfg.endpoint
        ? "flag"
        : envCfg.command || envCfg.endpoint
            ? "env"
            : fileCfg && (fileCfg.command || fileCfg.endpoint)
                ? "file"
                : "none";
    let finalCommand = command;
    let finalSource = source;
    let finalModel = model;
    if (!finalCommand && !endpoint) {
        const detected = detectAgentFromPath(env);
        if (detected) {
            // Detect = use what was found. Auto-detect saw a BINARY on PATH, so it
            // must resolve to the wrapper that runs THAT binary. For "gemini" the
            // plain builtin:gemini template goes through opencode instead (a user
            // choice kept for the explicit -gemini flag, where --help says "via
            // opencode") — a machine with only the native gemini CLI would be
            // detected as ready and then fail when the wrapper spawns a missing
            // opencode. So the auto path maps gemini to builtin:gemini-cli, the
            // wrapper that spawns the found binary itself.
            const template = detected === "gemini" ? "gemini-cli" : detected;
            finalCommand = expandBuiltinAgentCommand(`builtin:${template}`);
            finalSource = "auto";
            if (!finalModel)
                finalModel = `builtin:${template}`;
        }
    }
    return {
        schemaVersion: 1,
        command: finalCommand,
        args: cfgArgs,
        endpoint,
        model: finalModel,
        timeoutMs,
        attestPublicKey,
        requireAttestedTelemetry,
        source: finalSource,
    };
}
/** True iff a command-template OR endpoint is configured (after resolution). */
function agentConfigured(args = {}, env = process.env) {
    const resolved = resolveAgentConfig(args, env);
    return Boolean(resolved.command || resolved.endpoint);
}
/** Secret-stripped copy safe to persist or show — never carries raw
 *  credentials. */
function redacted(config) {
    return {
        ...config,
        args: config.args ? (0, agent_1.stripSecretArgs)(config.args) : undefined,
    };
}
/** Persist the durable config (secret-stripped). Returns the stored,
 *  redacted config. API keys are NEVER written — they come from the
 *  agent's own env. */
function setAgentConfigFile(patch, env = process.env) {
    const current = loadAgentConfigFile(env) || { schemaVersion: 1 };
    const incoming = agentConfigFromArgs(patch);
    const merged = {
        schemaVersion: 1,
        command: firstDefined(incoming.command, current.command),
        args: firstDefined(incoming.args, current.args),
        endpoint: firstDefined(incoming.endpoint, current.endpoint),
        model: firstDefined(incoming.model, current.model),
        timeoutMs: firstDefined(incoming.timeoutMs, current.timeoutMs),
        attestPublicKey: firstDefined(incoming.attestPublicKey, current.attestPublicKey),
        requireAttestedTelemetry: firstDefined(incoming.requireAttestedTelemetry, current.requireAttestedTelemetry),
        source: "file",
    };
    const stored = redacted(merged);
    const file = agentConfigPath(env);
    (0, fs_atomic_1.writeJson)(file, stored);
    return stored;
}
/** Read-only, deterministic projection of the effective config
 *  (secret-stripped). No now-derived field — safe for CLI<->MCP payload
 *  parity. */
function agentConfigShow(args = {}, env = process.env) {
    const resolved = resolveAgentConfig(args, env);
    return {
        schemaVersion: 1,
        configured: Boolean(resolved.command || resolved.endpoint),
        source: resolved.source,
        config: redacted(resolved),
        path: agentConfigPath(env),
        fileExists: fs.existsSync(agentConfigPath(env)),
    };
}
/** Persist the durable agent config (secret-stripped) and return the new
 *  state. */
function backendAgentConfigSet(args, env = process.env) {
    setAgentConfigFile(args, env);
    return agentConfigShow(args, env);
}
/** Read-only, deterministic projection of the effective agent config
 *  (secret-stripped). */
function backendAgentConfigShow(args, env = process.env) {
    return agentConfigShow(args, env);
}
