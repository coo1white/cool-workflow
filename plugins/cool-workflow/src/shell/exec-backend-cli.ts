// shell/exec-backend-cli.ts — CLI/MCP-reachable bodies for the execution-
// backend + sandbox-profile capability rows (backend.list|show|probe,
// backend.agent.config.show|set, sandbox.list|show|validate).
//
// MILESTONE 5. Byte-exact port of the old build's orchestrator methods
// (listSandboxProfiles/showSandboxProfile/
// validateSandboxProfile/listBackends/showBackend/probeBackend) plus
// cli operational-handler module's handleSandbox/handleBackend argv
// shape. Impure (fs/env) — this is the shell layer the capability-table's
// CLI/MCP handlers delegate to.

import * as path from "node:path";
import {
  backendListPayload,
  backendProbePayload,
  backendShowPayload,
} from "./execution-backend/registry";
import {
  listBundledSandboxProfiles,
  sandboxContextForValidation,
  showBundledSandboxProfile,
  validateSandboxProfileFile,
} from "./sandbox-profile";
import { SandboxProfileValidationResult } from "./execution-backend/types";
import { backendAgentConfigSet, backendAgentConfigShow } from "./agent-config";

function resolveCwd(options: Record<string, unknown>): string {
  return path.resolve(String(options.cwd || process.cwd()));
}

function resolveFromBase(target: string, options: Record<string, unknown>): string {
  return path.resolve(resolveCwd(options), target);
}

// ---------------------------------------------------------------------
// sandbox.list | sandbox.show | sandbox.validate
// ---------------------------------------------------------------------

export function listSandboxProfilesCli(options: Record<string, unknown> = {}) {
  return listBundledSandboxProfiles(sandboxContextForValidation(resolveCwd(options)));
}

export function showSandboxProfileCli(profileId: string, options: Record<string, unknown> = {}) {
  return showBundledSandboxProfile(profileId, sandboxContextForValidation(resolveCwd(options)));
}

export function validateSandboxProfileCli(profileFile: string, options: Record<string, unknown> = {}): SandboxProfileValidationResult {
  return validateSandboxProfileFile(resolveFromBase(profileFile, options), sandboxContextForValidation(resolveCwd(options)));
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
  return backendProbePayload(backendId, { cwd: resolveCwd(options) });
}

// ---------------------------------------------------------------------
// backend.agent.config.show | backend.agent.config.set
// ---------------------------------------------------------------------

export { backendAgentConfigSet, backendAgentConfigShow };
