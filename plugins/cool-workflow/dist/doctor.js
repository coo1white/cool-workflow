"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runDoctor = runDoctor;
exports.formatDoctorReport = formatDoctorReport;
// `cw doctor` — environment diagnostics, in the spirit of `brew doctor`.
//
// Homebrew's `doctor` turned "something is subtly wrong with your setup" into a
// proactive, named list of problems each paired with a concrete fix. We borrow
// that idea: instead of letting a missing agent / old Node / unwritable state
// surface as a confusing mid-run failure, `cw doctor` probes the host up front
// and prints WHAT is wrong and WHAT TO DO about it.
//
// Discipline:
//  - READ-ONLY. Probes versions, $PATH, and the WRITABILITY of the nearest
//    existing ancestor dir (via access(2)) — it never creates `.cw/` or $CW_HOME
//    as a side effect, so running `doctor` changes nothing on disk.
//  - FAIL CLOSED. Any `fail` check ⇒ `ok:false` ⇒ the CLI exits non-zero. A
//    `warn` (e.g. no agent yet — demo/preview still work) does not fail.
//  - TWO RENDERINGS. Human text by default; a stable `--json` payload for scripts.
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const node_child_process_1 = require("node:child_process");
const agent_config_1 = require("./agent-config");
const onramp_1 = require("./onramp");
/** Resolve a bare binary name against $PATH (or accept an explicit path). Returns
 *  the resolved path, or undefined when not found. No spawning. */
function whichBinary(bin, env) {
    if (bin.includes("/") || bin.includes("\\")) {
        try {
            return node_fs_1.default.statSync(bin).isFile() ? bin : undefined;
        }
        catch {
            return undefined;
        }
    }
    const dirs = (env.PATH || "").split(node_path_1.default.delimiter).filter(Boolean);
    const exts = process.platform === "win32" ? (env.PATHEXT || ".EXE;.CMD;.BAT").split(";") : [""];
    for (const dir of dirs) {
        for (const ext of exts) {
            const candidate = node_path_1.default.join(dir, bin + ext);
            try {
                if (node_fs_1.default.statSync(candidate).isFile())
                    return candidate;
            }
            catch { /* keep looking */ }
        }
    }
    return undefined;
}
/** True when `target` could be created/written: walk up to the nearest EXISTING
 *  ancestor and require it to be a writable DIRECTORY. (A file in the path is not
 *  writable-as-a-dir even though access(2) W_OK on the file itself would pass.)
 *  Does NOT create anything — a diagnostic must not have side effects. */
function dirWritable(target) {
    let dir = node_path_1.default.resolve(target);
    for (;;) {
        let stat;
        try {
            stat = node_fs_1.default.statSync(dir);
        }
        catch {
            const parent = node_path_1.default.dirname(dir);
            if (parent === dir)
                return false;
            dir = parent;
            continue;
        }
        if (!stat.isDirectory())
            return false; // an existing file blocks mkdir beneath it
        try {
            node_fs_1.default.accessSync(dir, node_fs_1.default.constants.W_OK);
            return true;
        }
        catch {
            return false;
        }
    }
}
function runDoctor(args = {}, env = process.env, cwd = process.cwd()) {
    const checks = [];
    // 1. Node runtime — the one hard prerequisite (README: v18+).
    const major = Number((process.version.match(/^v(\d+)/) || [])[1]);
    checks.push(Number.isFinite(major) && major >= 18
        ? { name: "node", status: "ok", detail: `Node ${process.version} (>= 18).` }
        : { name: "node", status: "fail", detail: `Node ${process.version} is below the required v18.`, fix: "Install Node.js 18+ (e.g. `brew install node`, or https://nodejs.org)." });
    // 2. Agent backend — CW delegates execution; without one, real runs park.
    const cfg = (0, agent_config_1.resolveAgentConfig)(args, env);
    if (cfg.source === "none") {
        checks.push({
            name: "agent",
            status: "warn",
            detail: "No agent backend configured — `demo` and `--preview` work, but a real run reports status: blocked.",
            fix: 'Pass --agent-command "claude -p", set $CW_AGENT_COMMAND, or use --agent-command builtin:claude.'
        });
    }
    else {
        const binToken = cfg.command ? String(cfg.command).split(/\s+/)[0] : undefined;
        checks.push({
            name: "agent",
            status: "ok",
            detail: `Agent configured from ${cfg.source}${binToken ? `: ${binToken}` : cfg.endpoint ? " (HTTP endpoint)" : ""}.`
        });
        // 2b. If it is a command agent, is the binary actually on PATH?
        if (binToken) {
            const resolved = whichBinary(binToken, env);
            checks.push(resolved
                ? { name: "agent-binary", status: "ok", detail: `Agent binary "${binToken}" found at ${resolved}.` }
                : { name: "agent-binary", status: "warn", detail: `Configured agent binary "${binToken}" is not on $PATH.`, fix: `Install "${binToken}", or correct --agent-command / $CW_AGENT_COMMAND.` });
        }
    }
    // 3. git — only needed for commit provenance (git HEAD); a warn, not a hard fail.
    const git = (0, node_child_process_1.spawnSync)("git", ["--version"], { encoding: "utf8", timeout: 5000 });
    checks.push(!git.error && git.status === 0
        ? { name: "git", status: "ok", detail: (String(git.stdout || "git").trim()) + "." }
        : { name: "git", status: "warn", detail: "git is not available — commit provenance (git HEAD) is recorded as absent.", fix: "Install git (e.g. `brew install git`) if you want commit provenance." });
    // 4. Home registry — the cross-repo run index lives here; must be writable.
    const home = env.CW_HOME && String(env.CW_HOME).trim()
        ? node_path_1.default.resolve(String(env.CW_HOME))
        : node_path_1.default.join(node_os_1.default.homedir(), ".local", "state", "cool-workflow");
    checks.push(dirWritable(home)
        ? { name: "home-registry", status: "ok", detail: `Home registry location is writable (${home}).` }
        : { name: "home-registry", status: "fail", detail: `Home registry location is not writable: ${home}`, fix: "Set $CW_HOME to a writable directory, or fix the permissions." });
    // 5. Working-dir state — per-repo runs land under <cwd>/.cw.
    const cwState = node_path_1.default.join(node_path_1.default.resolve(cwd), ".cw");
    checks.push(dirWritable(cwState)
        ? { name: "repo-state", status: "ok", detail: `Run state location is writable (${cwState}).` }
        : { name: "repo-state", status: "warn", detail: `Cannot write run state under ${cwState}.`, fix: "Run from a writable working directory, or pass --cwd PATH." });
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
        ...((0, onramp_1.optionEnabled)(args.onramp)
            ? { onramp: (0, onramp_1.buildDoctorOnramp)({ cwd, env, changedFrom: typeof args["changed-from"] === "string" ? args["changed-from"] : undefined }) }
            : {})
    };
}
/** Human rendering (TTY/default). `--json` callers use the report object directly. */
function formatDoctorReport(report) {
    const glyph = { ok: "✓", warn: "!", fail: "✗" };
    const lines = ["cw doctor"];
    for (const check of report.checks) {
        lines.push(`  ${glyph[check.status]} ${check.name}: ${check.detail}`);
        if (check.fix && check.status !== "ok")
            lines.push(`      fix: ${check.fix}`);
    }
    lines.push("");
    lines.push(`${report.ok ? "✓" : "✗"} ${report.summary}`);
    if (report.onramp) {
        lines.push("");
        lines.push("Onramp");
        lines.push(`  ${report.onramp.summary}`);
        if (report.onramp.recommendedChecks) {
            lines.push("");
            lines.push("  Recommended Checks");
            for (const command of report.onramp.recommendedChecks.commands)
                lines.push(`    - ${command}`);
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
