// shell/doctor.ts — `cw doctor` environment diagnostics, in the spirit of
// `brew doctor`.
//
// MILESTONE 5 (docs/rebuild/PLAN.md build order, step 5). Byte-exact port of
// plugins/cool-workflow/src/doctor.ts's checks this milestone needs
// (node/agent/agent-binary/git/home-registry/repo-state). The `--onramp`
// section (buildDoctorOnramp) is later-milestone (reporting) territory and
// is intentionally NOT wired here — no milestone-5 conformance case passes
// `--onramp`, and DoctorReport.onramp is optional so this is a strict
// subset, not a behavior change for any case this milestone must pass.
//
// Discipline (unchanged from the old build):
//  - READ-ONLY. Never creates .cw/ or $CW_HOME as a side effect.
//  - FAIL CLOSED. Any `fail` check => ok:false => the CLI exits non-zero.
//    A `warn` (e.g. no agent yet) does not fail.
//  - TWO RENDERINGS. Human text by default; a stable `--json` payload.
//
// Evidence: SPEC/execution-backend.md "Agent delegation config"; the doctor
// behavior itself is documented in the old build's src/doctor.ts (not yet a
// dedicated SPEC file — this milestone's conformance case,
// exec-doctor-agent-config.case.js, pins the exact text this file must
// produce).

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { resolveAgentConfig } from "./agent-config";
import { buildDoctorOnramp, DoctorOnramp, optionEnabled } from "./onramp";
import { bold, doctorGlyph, green, red } from "./term";

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
  onramp?: DoctorOnramp;
}

function whichBinary(bin: string, env: NodeJS.ProcessEnv): string | undefined {
  if (bin.includes("/") || bin.includes("\\")) {
    try {
      return fs.statSync(bin).isFile() ? bin : undefined;
    } catch {
      return undefined;
    }
  }
  const dirs = (env.PATH || "").split(path.delimiter).filter(Boolean);
  const exts = process.platform === "win32" ? (env.PATHEXT || ".EXE;.CMD;.BAT").split(";") : [""];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, bin + ext);
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch {
        /* keep looking */
      }
    }
  }
  return undefined;
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

export function runDoctor(
  args: Record<string, unknown> = {},
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd()
): DoctorReport {
  const checks: DoctorCheck[] = [];

  // 1. Node runtime — the one hard prerequisite (v18+).
  const major = Number((process.version.match(/^v(\d+)/) || [])[1]);
  checks.push(
    Number.isFinite(major) && major >= 18
      ? { name: "node", status: "ok", detail: `Node ${process.version} (>= 18).` }
      : {
          name: "node",
          status: "fail",
          detail: `Node ${process.version} is below the required v18.`,
          fix: "Install Node.js 18+ (e.g. `brew install node`, or https://nodejs.org).",
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
      detail: "No agent backend configured — `demo` and `--preview` work, but a real run reports status: blocked.",
      fix: 'Pass --agent-command "claude -p", set $CW_AGENT_COMMAND, or use --agent-command builtin:claude.',
    });
  } else {
    const binToken = cfg.command ? String(cfg.command).split(/\s+/)[0] : undefined;
    checks.push({
      name: "agent",
      status: "ok",
      detail: `Agent configured from ${cfg.source}${binToken ? `: ${binToken}` : cfg.endpoint ? " (HTTP endpoint)" : ""}.`,
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

  // 3. Sandbox enforcement boundary — a fixed architectural fact (see
  // docs/sandbox-profiles.7.md), not a host-specific problem to fix, so this
  // is "ok" (informational), never "warn": CW validates sandbox policy and
  // gates worker-output acceptance, but OS-level read/write/execute/network/
  // env isolation is the execution host's responsibility, which this doctor
  // run cannot itself verify. An "ok" check carries no `fix` line by
  // convention (see the node/git checks above), so the pointer to the docs
  // lives in `detail` instead.
  checks.push({
    name: "sandbox-enforceability",
    status: "ok",
    detail:
      "CW sandbox profiles validate policy and gate worker-output acceptance; OS-level read/write/execute/network/env isolation is the execution host's responsibility (see docs/sandbox-profiles.7.md's ENFORCEMENT section) — this doctor run cannot verify that host enforcement.",
  });

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

  // 5. Home registry — the cross-repo run index lives here; must be writable.
  const home = env.CW_HOME && String(env.CW_HOME).trim() ? path.resolve(String(env.CW_HOME)) : path.join(os.homedir(), ".local", "state", "cool-workflow");
  checks.push(
    dirWritable(home)
      ? { name: "home-registry", status: "ok", detail: `Home registry location is writable (${home}).` }
      : {
          name: "home-registry",
          status: "fail",
          detail: `Home registry location is not writable: ${home}`,
          fix: "Set $CW_HOME to a writable directory, or fix the permissions.",
        }
  );

  // 6. Working-dir state — per-repo runs land under <cwd>/.cw.
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
    // `--onramp` attaches the change-contract onramp block (byte-exact port
    // of the old build's src/doctor.ts wiring). `--changed-from REF` threads
    // the base ref through to resolveChangedFiles + evaluateOnrampContract.
    ...(optionEnabled(args.onramp)
      ? {
          onramp: buildDoctorOnramp({
            cwd,
            env,
            changedFrom: typeof args["changed-from"] === "string" ? (args["changed-from"] as string) : undefined,
          }),
        }
      : {}),
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
  if (report.onramp) {
    lines.push("");
    lines.push("Quick start (3 steps):");
    lines.push("  1. cw demo tamper        — prove trust checks work (30s)");
    lines.push("  2. cw demo bundle         — prove portable bundles (30s)");
    lines.push('  3. cw -q "what risks?"     — your first real report (needs an agent)');
    lines.push('     cw quickstart research-synthesis --repo <folder> --question "..."  — cited report over a docs/papers folder, not only code');
    lines.push("");
    lines.push("Onramp");
    lines.push(`  ${report.onramp.summary}`);
    if (report.onramp.recommendedChecks) {
      lines.push("");
      lines.push("  Recommended Checks");
      for (const command of report.onramp.recommendedChecks.commands) lines.push(`    - ${command}`);
    }
    if (report.onramp.contract && !report.onramp.contract.ok) {
      lines.push("");
      lines.push("  Contract Issues");
      for (const issue of report.onramp.contract.issues) {
        lines.push(`    - ${issue.code}: ${issue.detail}`);
        lines.push(`      fix: ${issue.fix}`);
      }
    }
    for (const section of report.onramp.sections) {
      lines.push("");
      lines.push(`  ${section.title}: ${section.summary}`);
      for (const action of section.actions) {
        lines.push(`    - ${action.command}`);
        lines.push(`      ${action.reason}`);
      }
    }
  }
  return lines.join("\n");
}

/** `--fix` rendering: consolidates all fix strings into an actionable block. */
export function formatDoctorFixes(report: DoctorReport): string {
  const fixes = report.checks.filter((c) => c.fix && c.status !== "ok").map((c) => c.fix as string);
  if (!fixes.length) return "No fixes needed.";
  return [bold("Fix Commands"), ...fixes.map((f, i) => `  ${i + 1}. ${f}`), ""].join("\n");
}
