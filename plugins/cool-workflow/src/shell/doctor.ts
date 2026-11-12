// shell/doctor.ts — `cw doctor` environment diagnostics, in the spirit of
// `brew doctor`.
//
// Checks: node, agent, agent-binary, agent-runs, git,
// repo-state, run-state-integrity.
//
// Discipline:
//  - READ-ONLY. Never creates .cw/ or $CW_HOME as a side effect.
//  - FAIL CLOSED. Any `fail` check => ok:false => the CLI exits non-zero.
//    A `warn` (e.g. no agent yet) does not fail.
//  - TWO RENDERINGS. Human text by default; a stable `--json` payload.
//
// Evidence: SPEC/execution-backend.md "Agent delegation config";
// exec-doctor-agent-config.case.mjs pins the exact text this file must
// produce.

import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { AGENT_FIX, agentProbeTarget, AgentProbeTarget, resolveAgentConfig } from "./agent-config.js";
import { buildAgentChildEnv } from "./execution-backend/agent.js";
import { findProgram, splitAgentCommandLine } from "../core/util/cli-args.js";
import { loadRun } from "./run-store.js";
import { bold, doctorGlyph, green, red } from "./term.js";

export type DoctorStatus = "ok" | "warn" | "fail";

export interface DoctorCheck {
  name: string;
  status: DoctorStatus;
  detail: string;
  fix?: string;
}

export interface DoctorReport {
  schemaVersion: 1;
  ok: boolean;
  checks: DoctorCheck[];
  summary: string;
}

function whichBinary(bin: string, env: NodeJS.ProcessEnv): string | undefined {
  if (bin.includes("/") || bin.includes("\\")) {
    try {
      return fs.statSync(bin).isFile() ? bin : undefined;
    } catch {
      return undefined;
    }
  }
  return findProgram(bin, env, process.platform, (file) => { try { return fs.statSync(file).isFile(); } catch { return false; } });
}

/** True when `target` could be created/written: walk up to the nearest
 *  EXISTING ancestor and require it to be a writable DIRECTORY. Does NOT
 *  create anything — a diagnostic must not have side effects. */
function dirWritable(target: string): boolean {
  let dir = path.resolve(target);
  for (;;) {
    let stat: fs.Stats | undefined;
    try {
      stat = fs.statSync(dir);
    } catch {
      const parent = path.dirname(dir);
      if (parent === dir) return false;
      dir = parent;
      continue;
    }
    if (!stat.isDirectory()) return false;
    try {
      fs.accessSync(dir, fs.constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }
}

function probeAgent(target: Exclude<AgentProbeTarget, { skip: string }>, env: NodeJS.ProcessEnv, cwd: string): DoctorCheck {
  const shown = `${target.cli} --version`;
  const timeoutMs = Number(env.CW_DOCTOR_AGENT_PROBE_TIMEOUT_MS) > 0 ? Number(env.CW_DOCTOR_AGENT_PROBE_TIMEOUT_MS) : 15000;
  const childEnv = buildAgentChildEnv(env).env;
  const r = spawnSync(target.cli, ["--version"], { cwd, env: childEnv, encoding: "utf8", timeout: timeoutMs, killSignal: "SIGKILL", shell: false, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1024 * 1024, windowsHide: true });
  const lines = (text: string) => text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/[\x00-\x09\x0b\x0c\x0e-\x1f\x7f]/g, "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!r.error && r.status === 0) {
    const first = lines(`${r.stdout || ""}\n${r.stderr || ""}`)[0] || "(no output)";
    return { name: "agent-runs", status: "ok", detail: `${shown} → ${first.slice(0, 120)}` };
  }
  const code = (r.error as NodeJS.ErrnoException | undefined)?.code;
  const why = code === "ETIMEDOUT" ? `timed out after ${timeoutMs / 1000}s` : r.error ? `could not start (${code || r.error.message})` : r.signal ? `was stopped by ${r.signal}` : `exited ${r.status}`;
  const said = lines(`${r.stderr || ""}\n${r.stdout || ""}`).slice(0, 4).join(" | ").slice(0, 300);
  return {
    name: "agent-runs",
    status: "fail",
    detail: `${shown} ${why}${said ? `: ${said}` : "."}`,
    fix: `Make "${shown}" work by hand first (its own message says how, e.g. reinstall it), or pick another agent with --agent-command / $CW_AGENT_COMMAND.`,
  };
}

export function runDoctor(
  args: Record<string, unknown> = {},
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd()
): DoctorReport {
  const checks: DoctorCheck[] = [];

  // 1. Node runtime — the one hard prerequisite (v22.13+, as package.json
  // engines says: the first Node 22 that loads an ES module with require()
  // and no warning on stderr).
  const [major, minor] = (process.version.match(/^v(\d+)\.(\d+)/) || []).slice(1).map(Number);
  checks.push(
    Number.isFinite(major) && Number.isFinite(minor) && (major > 22 || (major === 22 && minor >= 13))
      ? { name: "node", status: "ok", detail: `Node ${process.version} (>= 22.13).` }
      : {
          name: "node",
          status: "fail",
          detail: `Node ${process.version} is below the required v22.13.`,
          fix: "Install Node.js 22.13+ (e.g. `brew install node`, or https://nodejs.org).",
        }
  );

  // 2. Agent backend — CW delegates execution; without one, real runs park.
  const cfg = resolveAgentConfig(args, env);
  if (cfg.source === "auto") {
    const vendor = cfg.model && cfg.model.startsWith("builtin:") ? cfg.model.slice("builtin:".length) : "auto";
    checks.push({
      name: "agent",
      status: "ok",
      detail: `Agent auto-detected: ${vendor}. Set CW_AGENT_COMMAND or --agent-command to override.`,
    });
  } else if (cfg.source === "none") {
    checks.push({
      name: "agent",
      status: "warn",
      detail: "No agent backend configured — `cw demo tamper` and `cw check` work, but a real run reports status: blocked.",
      fix: AGENT_FIX,
    });
  } else {
    const binToken = cfg.command ? splitAgentCommandLine(String(cfg.command))[0] : undefined;
    checks.push({
      name: "agent",
      status: "ok",
      detail: `Agent configured from ${cfg.source}${binToken ? `: ${binToken}` : ""}.`,
    });
    if (binToken) {
      const resolved = whichBinary(binToken, env);
      checks.push(
        resolved
          ? { name: "agent-binary", status: "ok", detail: `Agent binary "${binToken}" found at ${resolved}.` }
          : {
              name: "agent-binary",
              status: "warn",
              detail: `Configured agent binary "${binToken}" is not on $PATH.`,
              fix: `Install "${binToken}", or correct --agent-command / $CW_AGENT_COMMAND.`,
            }
      );
    }
  }

  const probe = agentProbeTarget(cfg.command, cfg.args);
  if (probe && !("skip" in probe)) checks.push(probeAgent(probe, env, cwd));
  // 4. git — only needed for commit provenance; a warn, not a hard fail.
  const git = spawnSync("git", ["--version"], { encoding: "utf8", timeout: 5000 });
  checks.push(
    !git.error && git.status === 0
      ? { name: "git", status: "ok", detail: `${String(git.stdout || "git").trim()}.` }
      : {
          name: "git",
          status: "warn",
          detail: "git is not available — commit provenance (git HEAD) is recorded as absent.",
          fix: "Install git (e.g. `brew install git`) if you want commit provenance.",
        }
  );

  // 5. Working-dir state — per-repo runs land under <cwd>/.cw.
  const cwState = path.join(path.resolve(cwd), ".cw");
  checks.push(
    dirWritable(cwState)
      ? { name: "repo-state", status: "ok", detail: `Run state location is writable (${cwState}).` }
      : {
          name: "repo-state",
          status: "warn",
          detail: `Cannot write run state under ${cwState}.`,
          fix: "Run from a writable working directory, or pass --cwd PATH.",
        }
  );

  // 6. Run-state integrity — every run under <cwd>/.cw/runs must have a
  //    LOADABLE state.json: not corrupt, not an unsupported schema, not
  //    an old run CW refuses). READ-ONLY: only loads each run's state, the
  //    way `cw report` would — never writes or repairs.
  const runsDir = path.join(path.resolve(cwd), ".cw", "runs");
  let runDirs: string[] = [];
  try {
    runDirs = fs.readdirSync(runsDir).filter((name) => !name.startsWith("."));
  } catch {
    runDirs = [];
  }
  const runStateProblems: string[] = [];
  let runsScanned = 0;
  for (const runId of runDirs) {
    if (!fs.existsSync(path.join(runsDir, runId, "state.json"))) continue;
    runsScanned += 1;
    try {
      loadRun(runId, cwd);
    } catch (error) {
      runStateProblems.push(`${runId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  checks.push(
    runStateProblems.length === 0
      ? {
          name: "run-state-integrity",
          status: "ok",
          detail: runsScanned > 0 ? `${runsScanned} run(s) under .cw/runs all have a loadable state.json.` : "No runs under .cw/runs yet.",
        }
      : {
          name: "run-state-integrity",
          status: "warn",
          detail: `${runStateProblems.length} of ${runsScanned} run(s) have a state.json problem: ${runStateProblems.slice(0, 3).join(" | ")}${runStateProblems.length > 3 ? ` (+${runStateProblems.length - 3} more)` : ""}`,
          fix: "Restore state.json from a backup, or remove the run directory and start a new run.",
        }
  );

  const fails = checks.filter((c) => c.status === "fail").length;
  const warns = checks.filter((c) => c.status === "warn").length;
  const ok = fails === 0;
  const summary = ok
    ? warns === 0
      ? "ready — all checks passed"
      : `ready, with ${warns} warning${warns === 1 ? "" : "s"}`
    : `${fails} blocking problem${fails === 1 ? "" : "s"} found`;
  return {
    schemaVersion: 1,
    ok,
    checks,
    summary,
  };
}

/** Human rendering (TTY/default). `--json` callers use the report object directly. */
export function formatDoctorReport(report: DoctorReport): string {
  const lines = [bold("cw doctor")];
  for (const check of report.checks) {
    lines.push(`  ${doctorGlyph(check.status)} ${check.name}: ${check.detail}`);
    if (check.fix && check.status !== "ok") lines.push(`      fix: ${check.fix}`);
  }
  lines.push("");
  const summaryGlyph = report.ok ? green("✓") : red("✗");
  lines.push(`${summaryGlyph} ${report.summary}`);
  lines.push("");
  lines.push("Quick start:");
  lines.push("  1. cw demo tamper          — see the trust checks catch an edit (no agent needed)");
  lines.push("  2. cw check -- npm test    — keep a receipt that your tests passed; a result can cite it");
  lines.push('  3. cw -q "what risks?"     — your first real report (needs an agent)');
  return lines.join("\n");
}

/** `--fix` rendering: consolidates all fix strings into an actionable block. */
export function formatDoctorFixes(report: DoctorReport): string {
  const fixes = report.checks.filter((c) => c.fix && c.status !== "ok").map((c) => c.fix as string);
  if (!fixes.length) return "No fixes needed.";
  return [bold("Fix Commands"), ...fixes.map((f, i) => `  ${i + 1}. ${f}`), ""].join("\n");
}
