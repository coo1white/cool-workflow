// shell/execution-backend/agent-sandbox.ts — CW_AGENT_SANDBOX=srt (0.3.3, opt-in): CW DELEGATES enforcement to
// the srt program (no dependency); fail closed.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { SRT_VERSION, agentSandboxMode, buildSrtSettings } from "../../core/trust/srt-settings.js";
import type { ResolvedSandboxPolicy } from "../../core/types/execution-backend.js";

export const SRT_INSTALL_HINT = `install it with \`npm i -g @anthropic-ai/sandbox-runtime@${SRT_VERSION}\` (on Linux and WSL also \`sudo apt-get install bubblewrap socat\`), or point CW_SRT_BIN at it`;

const resolved = new Map<string, { bin: string; version: string } | { error: string }>();

/** Find srt (CW_SRT_BIN, else `srt` on PATH) and check it is the pinned version. Cached per binary. */
export function resolveSrt(env: NodeJS.ProcessEnv = process.env): { bin: string; version: string } | { error: string } {
  const bin = String(env.CW_SRT_BIN || "").trim() || "srt";
  const hit = resolved.get(bin);
  if (hit) return hit;
  const r = spawnSync(bin, ["--version"], { encoding: "utf8", timeout: 15000, env, shell: false, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  const version = /\d+\.\d+\.\d+/.exec(`${r.stdout || ""} ${r.stderr || ""}`)?.[0];
  const result = r.error || r.status !== 0 || !version
    ? { error: `srt (${bin}) could not be run: ${r.error ? (r.error as NodeJS.ErrnoException).code || r.error.message : `exit ${r.status}`}; ${SRT_INSTALL_HINT}` }
    : version !== SRT_VERSION
      ? { error: `srt ${version} found (${bin}), CW needs ${SRT_VERSION}; ${SRT_INSTALL_HINT}` }
      : { bin, version };
  resolved.set(bin, result);
  return result;
}

export type AgentSandboxWrap = { binary: string; args: string[]; enforcedBy: string; settingsFile: string } | { refusal: string } | undefined;

let settingsCount = 0;

/** undefined when the sandbox is off (the old spawn, byte for byte); else the srt argv, or why not. */
export function wrapAgentForSandbox(
  binary: string,
  args: readonly string[],
  policy: Pick<ResolvedSandboxPolicy, "readPaths" | "writePaths">,
  vendor: { hosts: readonly string[]; write: readonly string[] },
  env: NodeJS.ProcessEnv = process.env
): AgentSandboxWrap {
  const mode = agentSandboxMode(env);
  if ("error" in mode) return { refusal: mode.error };
  if (mode.mode === "off") return undefined;
  const srt = resolveSrt(env);
  if ("error" in srt) return { refusal: `agent sandbox (CW_AGENT_SANDBOX=srt) is not usable: ${srt.error}` };
  const extraHosts = String(env.CW_AGENT_SANDBOX_HOSTS || "").split(",").map((h) => h.trim()).filter(Boolean);
  const settings = buildSrtSettings({
    home: os.homedir(),
    tmpDir: os.tmpdir(),
    writePaths: policy.writePaths || [],
    readPaths: policy.readPaths || [],
    vendorWrite: vendor.write,
    hosts: [...vendor.hosts, ...extraHosts],
  });
  const settingsFile = path.join(os.tmpdir(), `cw-srt-${process.pid}-${Date.now()}-${settingsCount++}.json`);
  fs.writeFileSync(settingsFile, `${JSON.stringify(settings, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  // "--" ends srt's own options: without it srt takes an agent arg such as "-s x" as its own (measured).
  return { binary: srt.bin, args: ["-s", settingsFile, "--", binary, ...args], enforcedBy: `srt ${srt.version}`, settingsFile };
}
