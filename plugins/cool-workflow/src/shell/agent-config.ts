// shell/agent-config.ts — which agent command CW delegates to. Order per
// field: flags > env > $CW_HOME/agent-config.json > PATH auto-detect > none.
// The command and its args are one unit: both come from the first layer that
// sets a command. `builtin:<name>` expands to a bundled wrapper script.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { findProgram, splitAgentCommand } from "../core/util/cli-args.js";
import { AgentDelegationConfig } from "./execution-backend/agent.js";

/** CW_HOME resolution: CW_HOME > XDG_STATE_HOME/cool-workflow > ~/.local/state/cool-workflow. */
export function resolveCwHome(env: NodeJS.ProcessEnv = process.env): string {
  if (env.CW_HOME && String(env.CW_HOME).trim()) return path.resolve(String(env.CW_HOME));
  if (env.XDG_STATE_HOME && String(env.XDG_STATE_HOME).trim()) {
    return path.join(path.resolve(String(env.XDG_STATE_HOME)), "cool-workflow");
  }
  return path.join(os.homedir(), ".local", "state", "cool-workflow");
}

function agentConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveCwHome(env), "agent-config.json");
}

function trimmed(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const out = value.trim();
  return out ? out : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.map((entry) => String(entry));
  return out.length ? out : undefined;
}

function firstDefined<T>(...values: (T | undefined)[]): T | undefined {
  for (const value of values) if (value !== undefined) return value;
  return undefined;
}

/** Read the durable config FILE (if any). Never throws — a corrupt file is
 *  treated as absent (fail closed). */
function loadAgentConfigFile(env: NodeJS.ProcessEnv): AgentDelegationConfig | undefined {
  const file = agentConfigPath(env);
  if (!fs.existsSync(file)) return undefined;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    return {
      command: trimmed(parsed.command),
      args: asStringArray(parsed.args),
      model: trimmed(parsed.model),
      timeoutMs: typeof parsed.timeoutMs === "number" ? parsed.timeoutMs : undefined,
      attestPublicKey: trimmed(parsed.attestPublicKey),
      source: "file",
    };
  } catch {
    return undefined;
  }
}

function agentConfigFromEnv(env: NodeJS.ProcessEnv): AgentDelegationConfig {
  const split = splitAgentCommand(trimmed(env.CW_AGENT_COMMAND), undefined);
  return {
    command: split.command,
    args: split.args,
    model: trimmed(env.CW_AGENT_MODEL),
    timeoutMs: trimmed(env.CW_AGENT_TIMEOUT_MS) ? Number(env.CW_AGENT_TIMEOUT_MS) : undefined,
    attestPublicKey: trimmed(env.CW_AGENT_ATTEST_PUBKEY),
    source: "env",
  };
}

function agentConfigFromArgs(args: Record<string, unknown>): AgentDelegationConfig {
  const rawCommand = trimmed(args.agentCommand ?? args["agent-command"]);
  const rawArgs = asStringArray(args.agentArgs ?? args["agent-args"]);
  const split = splitAgentCommand(rawCommand, rawArgs);
  const rawTimeout = args.agentTimeoutMs ?? args["agent-timeout-ms"];
  return {
    command: split.command,
    args: split.args,
    model: trimmed(args.agentModel ?? args["agent-model"]),
    timeoutMs: rawTimeout !== undefined ? Number(rawTimeout) : undefined,
    attestPublicKey: trimmed(args.agentAttestPublicKey ?? args["agent-attest-public-key"]),
    source: "flag",
  };
}

/** Detect which known agent CLIs are on PATH. Returns the first found, or
 *  undefined. Skipped when CW_NO_AUTO_AGENT=1. */
function detectAgentFromPath(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.CW_NO_AUTO_AGENT === "1") return undefined;
  const known = ["claude", "codex", "gemini", "opencode", "muse"];
  const templates = builtinAgentTemplates();
  return known.find((name) => templates[name] && findProgram(name, env, (file) => { try { return fs.statSync(file).isFile(); } catch { return false; } }));
}

const AGENTS_DIR = path.join(import.meta.dirname, "..", "..", "scripts", "agents");

function builtinManifest(): { templates?: Record<string, string> } {
  return JSON.parse(fs.readFileSync(path.join(AGENTS_DIR, "builtin-templates.json"), "utf8"));
}

function builtinAgentTemplates(): Record<string, string> {
  const manifest = builtinManifest();
  const out: Record<string, string> = {};
  for (const [name, script] of Object.entries(manifest.templates || {})) {
    out[name] = `node ${path.join(AGENTS_DIR, script)} {{input}} {{result}}`;
  }
  return out;
}

function expandBuiltinAgentCommand(command: string | undefined): string | undefined {
  if (!command || !command.startsWith("builtin:")) return command;
  const name = command.slice("builtin:".length).trim();
  const templates = builtinAgentTemplates();
  const template = templates[name];
  if (!template) {
    throw new Error(`Unknown builtin agent template "${name}" — available: ${Object.keys(templates).join(", ")}`);
  }
  return template;
}

export const AGENT_FIX =
  'Install an agent CLI such as Claude Code, then add -claude to your cw command, for one: cw -q "your question" -claude (or set CW_AGENT_COMMAND=builtin:claude). -codex, -gemini and -opencode work too.';

/** Resolve the EFFECTIVE agent config: flags > env > file > auto-detect >
 *  none. The returned `source` names the layer the command/endpoint came
 *  from. */
export function resolveAgentConfig(args: Record<string, unknown> = {}, env: NodeJS.ProcessEnv = process.env): AgentDelegationConfig {
  const flagCfg = agentConfigFromArgs(args);
  const envCfg = agentConfigFromEnv(env);
  const fileCfg = loadAgentConfigFile(env);
  // Command and args are ONE unit: the layer that supplies the command
  // supplies its args too. A lower layer's args are never attached to a
  // higher layer's command (they were written for a different binary).
  const commandLayer = [flagCfg, envCfg, fileCfg].find((layer) => layer && layer.command !== undefined);
  const command = expandBuiltinAgentCommand(commandLayer?.command);
  const cfgArgs = commandLayer ? commandLayer.args : firstDefined(flagCfg.args, envCfg.args, fileCfg?.args);
  const model = firstDefined(flagCfg.model, envCfg.model, fileCfg?.model);
  const timeoutMs = firstDefined(flagCfg.timeoutMs, envCfg.timeoutMs, fileCfg?.timeoutMs);
  const attestPublicKey = firstDefined(flagCfg.attestPublicKey, envCfg.attestPublicKey, fileCfg?.attestPublicKey);
  const base = { model, timeoutMs, attestPublicKey };
  if (command) return { ...base, command, args: cfgArgs, source: commandLayer!.source };
  const detected = detectAgentFromPath(env);
  if (!detected) return { ...base, args: cfgArgs, source: "none" };
  // Auto-detect saw a binary on PATH, so it must use the wrapper that runs
  // that binary: a found "gemini" maps to builtin:gemini-cli (builtin:gemini
  // goes through opencode).
  const template = detected === "gemini" ? "gemini-cli" : detected;
  return { ...base, command: expandBuiltinAgentCommand(`builtin:${template}`), model: model || `builtin:${template}`, source: "auto" };
}

/** True iff an agent command is configured (after resolution). */
export function agentConfigured(args: Record<string, unknown> = {}, env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(resolveAgentConfig(args, env).command);
}
