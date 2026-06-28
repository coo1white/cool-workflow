"use strict";
// Agent Delegation Config (v0.1.38) — POLICY expressed as DATA. WHICH agent
// (claude / codex / ollama / an HTTP endpoint) fulfills each worker is a plain,
// diffable config record, NEVER a CW dependency. Resolution order is
// flags > env > a durable $CW_HOME/agent-config.json > fail-closed.
//
// BSD discipline:
//  - MECHANISM vs POLICY: the `agent` backend is mechanism; this file is the
//    policy data it reads. The kernel never learns which vendor was chosen.
//  - NO SECRETS IN COMMITTED STATE [load-bearing]: the durable config holds a
//    command-TEMPLATE + endpoint + operator-chosen model only. API keys come from
//    the AGENT's own inherited env, never written into .cw/ or the config file.
//    Any secret-looking arg is stripped before it is persisted OR shown.
//  - DETERMINISTIC SHOW: `agentConfigShow` is a pure projection of env + file —
//    no now-derived field — so `cw backend agent config show --json` is
//    byte-identical to the MCP tool (CLI<->MCP parity).
//
// See docs/agent-delegation-drive.7.md.
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AGENT_CONFIG_SCHEMA_VERSION = void 0;
exports.agentConfigPath = agentConfigPath;
exports.loadAgentConfigFile = loadAgentConfigFile;
exports.resolveAgentConfig = resolveAgentConfig;
exports.agentConfigured = agentConfigured;
exports.setAgentConfigFile = setAgentConfigFile;
exports.agentConfigShow = agentConfigShow;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const run_registry_1 = require("./run-registry");
const execution_backend_1 = require("./execution-backend");
const state_1 = require("./state");
exports.AGENT_CONFIG_SCHEMA_VERSION = 1;
function agentConfigPath(env = process.env) {
    return node_path_1.default.join((0, run_registry_1.resolveCwHome)(env), "agent-config.json");
}
function trimmed(value) {
    if (typeof value !== "string")
        return undefined;
    const out = value.trim();
    return out ? out : undefined;
}
/** Parse a boolean from a flag (boolean) or an env/file string. Returns undefined
 *  for unset/unrecognized so `firstDefined` falls through to the next layer. */
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
/** Split a single command string ("claude -p {{manifest}}") into binary + argv
 *  template — NEVER shell-interpreted. An explicit args array always wins. */
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
    if (!node_fs_1.default.existsSync(file))
        return undefined;
    try {
        const parsed = JSON.parse(node_fs_1.default.readFileSync(file, "utf8"));
        return {
            schemaVersion: 1,
            command: trimmed(parsed.command),
            args: asStringArray(parsed.args),
            endpoint: trimmed(parsed.endpoint),
            model: trimmed(parsed.model),
            timeoutMs: typeof parsed.timeoutMs === "number" ? parsed.timeoutMs : undefined,
            attestPublicKey: trimmed(parsed.attestPublicKey),
            requireAttestedTelemetry: boolish(parsed.requireAttestedTelemetry),
            source: "file"
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
        source: "env"
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
        source: "flag"
    };
}
// Bundled agent templates, addressable by a stable name so an operator (or an
// npx/global install, where $(pwd)-relative paths don't exist) can configure a
// WORKING agent without knowing where the package landed on disk:
//   --agent-command builtin:claude   (or CW_AGENT_COMMAND=builtin:claude)
// resolves to the packaged wrapper invocation. Still pure config — the template
// is an out-of-process delegation script; CW never calls a model API.
//
// The builtin set is DATA, not a kernel TS literal (FreeBSD-audit L15): it lives
// in scripts/agents/builtin-templates.json (vendor name -> wrapper script name).
// Adding a vendor is a content/distribution step (drop a wrapper + a JSON line),
// not a kernel edit — keeping CW vendor-agnostic at the source level.
/** Detect which known agent CLIs are on PATH. Returns the first found, or undefined.
 *  Skipped when CW_NO_AUTO_AGENT=1 (test sandboxes, CI without real agents). */
function detectAgentFromPath(env = process.env) {
    if (env.CW_NO_AUTO_AGENT === "1")
        return undefined;
    const known = ["claude", "codex", "gemini", "opencode"];
    const dirs = (env.PATH || "").split(node_path_1.default.delimiter).filter(Boolean);
    const exts = process.platform === "win32" ? (env.PATHEXT || ".EXE;.CMD;.BAT").split(";") : [""];
    for (const name of known) {
        // Also check if the builtin template exists (so we don't suggest an unsupported agent).
        const templates = builtinAgentTemplates();
        if (!templates[name])
            continue;
        for (const dir of dirs) {
            for (const ext of exts) {
                try {
                    if (node_fs_1.default.statSync(node_path_1.default.join(dir, name + ext)).isFile())
                        return name;
                }
                catch { /* keep looking */ }
            }
        }
    }
    return undefined;
}
function builtinAgentTemplates() {
    const agentsDir = node_path_1.default.join(__dirname, "..", "scripts", "agents");
    const manifest = JSON.parse(node_fs_1.default.readFileSync(node_path_1.default.join(agentsDir, "builtin-templates.json"), "utf8"));
    const out = {};
    for (const [name, script] of Object.entries(manifest.templates || {})) {
        out[name] = `node ${node_path_1.default.join(agentsDir, script)} {{input}} {{result}}`;
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
/** Resolve the EFFECTIVE agent config: flags > env > file > none. The returned
 *  `source` names the layer the command/endpoint came from. */
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
    // Auto-detect: if no agent is configured, check PATH for known agent CLIs and
    // resolve via builtin:<name>. This makes `cw quickstart` work without
    // --agent-command on machines where claude/codex/gemini/opencode are installed.
    let finalCommand = command;
    let finalSource = source;
    let finalModel = model;
    if (!finalCommand && !endpoint) {
        const detected = detectAgentFromPath(env);
        if (detected) {
            finalCommand = expandBuiltinAgentCommand(`builtin:${detected}`);
            finalSource = "auto";
            // Store the detected vendor name as the model hint so doctor can show it.
            if (!finalModel)
                finalModel = `builtin:${detected}`;
        }
    }
    return { schemaVersion: 1, command: finalCommand, args: cfgArgs, endpoint, model: finalModel, timeoutMs, attestPublicKey, requireAttestedTelemetry, source: finalSource };
}
/** True iff a command-template OR endpoint is configured (after resolution). */
function agentConfigured(args = {}, env = process.env) {
    const resolved = resolveAgentConfig(args, env);
    return Boolean(resolved.command || resolved.endpoint);
}
/** Secret-stripped copy safe to persist or show — never carries raw credentials. */
function redacted(config) {
    return {
        ...config,
        args: config.args ? (0, execution_backend_1.stripSecretArgs)(config.args) : undefined
    };
}
/** Persist the durable config (secret-stripped). Returns the stored, redacted
 *  config. API keys are NEVER written — they come from the agent's own env. */
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
        source: "file"
    };
    const stored = redacted(merged);
    const file = agentConfigPath(env);
    node_fs_1.default.mkdirSync(node_path_1.default.dirname(file), { recursive: true });
    (0, state_1.writeJson)(file, stored);
    return stored;
}
/** Read-only, deterministic projection of the effective config (secret-stripped).
 *  No now-derived field — safe for CLI<->MCP payload parity. */
function agentConfigShow(args = {}, env = process.env) {
    const resolved = resolveAgentConfig(args, env);
    return {
        schemaVersion: 1,
        configured: Boolean(resolved.command || resolved.endpoint),
        source: resolved.source,
        config: redacted(resolved),
        path: agentConfigPath(env),
        fileExists: node_fs_1.default.existsSync(agentConfigPath(env))
    };
}
