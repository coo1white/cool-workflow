// shell/exec-backend-cli.ts — CLI/MCP-reachable bodies for the execution-
// backend + sandbox-profile capability rows (backend.list|show|probe,
// backend.agent.config.show|set, sandbox.list|show|validate).
//
// Impure (fs/env) — this is the shell layer the capability-table's
// CLI/MCP handlers delegate to.

import * as path from "node:path";
import { cwdArg } from "../core/util/cli-args.js";
import {
  backendListPayload,
  backendProbePayload,
  backendShowPayload,
} from "./execution-backend/registry.js";
import {
  listBundledSandboxProfiles,
  sandboxContextForValidation,
  showBundledSandboxProfile,
  validateSandboxProfileFile,
} from "./sandbox-profile.js";
import { SandboxProfileValidationResult } from "./execution-backend/types.js";
import { backendAgentConfigSet, backendAgentConfigShow } from "./agent-config.js";

function resolveFromBase(target: string, options: Record<string, unknown>): string {
  return path.resolve(cwdArg(options, ["cwd"], true), target);
}

// ---------------------------------------------------------------------
// sandbox.list | sandbox.show | sandbox.validate
// ---------------------------------------------------------------------

export function listSandboxProfilesCli(options: Record<string, unknown> = {}) {
  return listBundledSandboxProfiles(sandboxContextForValidation(cwdArg(options, ["cwd"], true)));
}

export function showSandboxProfileCli(profileId: string, options: Record<string, unknown> = {}) {
  return showBundledSandboxProfile(profileId, sandboxContextForValidation(cwdArg(options, ["cwd"], true)));
}

export function validateSandboxProfileCli(profileFile: string, options: Record<string, unknown> = {}): SandboxProfileValidationResult {
  return validateSandboxProfileFile(resolveFromBase(profileFile, options), sandboxContextForValidation(cwdArg(options, ["cwd"], true)));
}

// ---------------------------------------------------------------------
// backend.list | backend.show | backend.probe
// ---------------------------------------------------------------------

export function listBackendsCli() {
  return backendListPayload();
}

export function showBackendCli(backendId: string) {
  return backendShowPayload(backendId);
}

export function probeBackendCli(backendId: string | undefined, options: Record<string, unknown> = {}) {
  return backendProbePayload(backendId, { cwd: cwdArg(options, ["cwd"], true) });
}

// ---------------------------------------------------------------------
// backend.agent.config.show | backend.agent.config.set
// ---------------------------------------------------------------------

export { backendAgentConfigSet, backendAgentConfigShow };
