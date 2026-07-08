// shell/execution-backend/local.ts — the local-execution driver body
// (executeLocal) shared by the node/bun/shell built-in drivers.
//
// MILESTONE 5 (docs/rebuild/PLAN.md build order, step 5). Byte-exact port of
// plugins/cool-workflow/src/execution-backend.ts's `executeLocal` (lines
// 547-626) plus the leaf helpers it needs (sha256/hasExecutable/messageOf).
//
// Evidence: SPEC/execution-backend.md "Local execution (executeLocal)".

import { spawnSync } from "node:child_process";
import { sha256 } from "../../core/hash";
import { hasExecutable } from "./probes";
import { BackendDescriptor, ExecutionRequest, ExecutionResultEnvelope, ResolvedSandboxPolicy, ResultEnvelope, SandboxAttestation } from "./types";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function buildChildEnv(policy: ResolvedSandboxPolicy, baseEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  if (policy.env.inherit) return { ...baseEnv };
  const env: NodeJS.ProcessEnv = {};
  if (baseEnv.PATH !== undefined) env.PATH = baseEnv.PATH;
  if (baseEnv.HOME !== undefined) env.HOME = baseEnv.HOME;
  for (const name of policy.env.expose || []) {
    if (baseEnv[name] !== undefined) env[name] = baseEnv[name];
  }
  for (const name of policy.env.deny || []) {
    delete env[name];
  }
  return env;
}

export type LocalSpawnStyle = "direct" | "shell";

/** Shell injection guard (SPEC/execution-backend.md "Local execution"): for
 *  the `shell` driver, the joined string (with `{{token}}` placeholders
 *  taken out first) must not match the control-character set. Throws a
 *  plain Error with the byte-exact message on a hit. */
export function checkShellGuard(command: string, args: string[]): void {
  const shellArg = [command, ...args].join(" ").replace(/\{\{[a-zA-Z0-9_.-]+\}\}/g, "");
  if (/[;&|`$(){}<>!\n\r#*?~]/.test(shellArg)) {
    throw new Error(
      `Shell backend refused: args contain shell control characters. ` +
        `Use the node, bun, or agent backend instead for untrusted inputs.`
    );
  }
}

export function runtimeNoteFor(backendId: string): string {
  if (backendId === "bun") {
    return hasExecutable("bun") ? "bun (node-compatible execution)" : "node-compatible (bun not installed)";
  }
  if (backendId === "shell") return "posix-shell";
  return "node";
}

/** executeLocal — spawn a thin child process and capture verifiable
 *  evidence (exit code + output digest). Byte-exact port of
 *  src/execution-backend.ts:547-626. */
export function executeLocal(
  descriptor: BackendDescriptor,
  request: ExecutionRequest,
  label: string,
  attestation: SandboxAttestation,
  spawnStyle: LocalSpawnStyle | undefined
): ExecutionResultEnvelope {
  const command = String(request.command);
  const args = (request.args || []).map(String);
  const env = buildChildEnv(request.sandboxPolicy);
  const options = {
    cwd: request.cwd,
    env,
    encoding: "utf8" as const,
    // An unset timeoutMs must not mean "no timeout" — spawnSync would then
    // block forever on a hung child with no kill path. 600000 matches the
    // agent backend's own default fallback (execution-backend/agent.ts).
    timeout: request.timeoutMs || 600000,
    maxBuffer: 32 * 1024 * 1024,
  };

  if (spawnStyle === "shell") {
    checkShellGuard(command, args);
  }

  const isTTY = Boolean(process.stderr.isTTY);
  const shortLabel = command.split("/").pop() || command;
  if (isTTY) process.stderr.write(`● Running ${shortLabel}...\n`);
  const startedAt = process.hrtime.bigint();
  const result =
    spawnStyle === "shell"
      ? spawnSync([command, ...args].join(" "), { ...options, shell: true })
      : spawnSync(command, args, { ...options, shell: false });
  const elapsedMs = Number((process.hrtime.bigint() - startedAt) / 1000000n);
  if (isTTY) process.stderr.write(`✓ Done (${elapsedMs}ms)\n`);

  const exitCode = typeof result.status === "number" ? result.status : null;
  const spawnError = result.error ? messageOf(result.error) : undefined;
  const stdout = String(result.stdout || "");
  const digest = sha256(stdout);
  const status: ExecutionResultEnvelope["status"] = spawnError ? "failed" : exitCode === 0 ? "completed" : "failed";

  const evidence = [`command:${[command, ...args].join(" ")}`, `exitCode:${exitCode === null ? "null" : exitCode}`, `stdoutSha256:${digest}`];
  const summary =
    status === "completed"
      ? `${label}: completed (exit 0)`
      : spawnError
        ? `${label}: failed (${spawnError})`
        : `${label}: failed (exit ${exitCode})`;
  const resultEnvelope: ResultEnvelope = { summary, findings: [], evidence };

  const notes = [`runtime: ${runtimeNoteFor(descriptor.id)}`];
  if (spawnError) notes.push(`spawn-error: ${spawnError}`);

  return {
    schemaVersion: 1,
    status,
    result: resultEnvelope,
    evidence,
    provenance: {
      schemaVersion: 1,
      backendId: descriptor.id,
      locality: descriptor.locality,
      kind: descriptor.kind,
      attestation: { ...attestation, status: attestation.status, notes },
    },
  };
}
