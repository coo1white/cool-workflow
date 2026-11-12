// shell/commands/pipeline-cli.ts — `cw -q "question"` and `cw --resume --run
// <id>`: plan the architecture review over a repo, drive it to its end, and
// hand back the DriveResult (plus a TTY summary).
import * as fs from "node:fs";
import * as path from "node:path";
import * as readlinePromises from "node:readline/promises";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { cwdArg, flagOn, wantsJson } from "../../core/util/cli-args.js";
import { safeJsonStringify } from "../../core/format/safe-json.js";
import { planRun, resolveInputs, WORKFLOW_DSL } from "../../core/pipeline/plan.js";
import { drive } from "../drive.js";
import { loadRun, newRunId, runPaths, runsDir, saveRun } from "../run-store.js";
import { safeFileName } from "../fs-atomic.js";
import { writeReport } from "../report.js";
import { ensureAndOpenReportHtml } from "./report-view-cli.js";
import { formatQuickstartSummary } from "../reporter.js";
import { AGENT_FIX, resolveAgentConfig } from "../agent-config.js";
const APP_ID = "architecture-review";
const APP_DIR = path.resolve(import.meta.dirname, "..", "..", "..", "apps", APP_ID);
/** The bundled app's workflow.js, called with the DSL factories. */
export function loadWorkflow() {
    const factory = createRequire(import.meta.url)(path.join(APP_DIR, "workflow.js"));
    return factory(WORKFLOW_DSL);
}
function isGitWorkTree(dir) {
    try {
        return execFileSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 }).trim() === "true";
    }
    catch {
        return false;
    }
}
function sameRealLocation(a, b) {
    try {
        return fs.realpathSync(a) === fs.realpathSync(b);
    }
    catch {
        return false;
    }
}
/** Prompts `Question: ` on stderr; only called on a TTY. */
async function promptForQuestion() {
    const rl = readlinePromises.createInterface({ input: process.stdin, output: process.stderr });
    try {
        return (await rl.question("Question: ")).trim() || undefined;
    }
    finally {
        rl.close();
    }
}
function planFresh(args) {
    const repoFromCwd = !args.repo && !args.cwd;
    const repo = path.resolve(cwdArg(args), typeof args.repo === "string" && args.repo.trim() ? args.repo : ".");
    if (repoFromCwd && !isGitWorkTree(repo))
        throw new Error(`${repo} is not a git project. Run cw inside a project, or pass --repo <path>.`);
    if (!repoFromCwd) {
        const stat = fs.statSync(repo, { throwIfNoEntry: false });
        if (!stat)
            throw new Error(`${repo} is missing: there is no such folder. Pass --repo <path> to a project folder.`);
        if (!stat.isDirectory())
            throw new Error(`${repo} is not a folder. Pass --repo <path> to a project folder.`);
    }
    const def = loadWorkflow();
    const inputs = resolveInputs(def, { ...args, repo });
    const runId = newRunId(def.id);
    const run = planRun(def, inputs, { runId, cwd: repo, now: new Date().toISOString(), paths: runPaths(path.join(runsDir(repo), runId)) });
    saveRun(run);
    writeReport(run);
    return run;
}
/** `cw -q "question"` (fresh run) and `cw --resume --run <id>` (reopen parked
 *  tasks and drive on). Exit code 2 when the run stopped short. */
export async function askRun(args) {
    const existingRunId = typeof args.run === "string" ? args.run : typeof args.runId === "string" ? args.runId : "";
    const resume = flagOn(args.resume);
    if (resume && !existingRunId)
        throw new Error("--resume needs --run <run-id>: cw --resume --run <run-id>");
    if (process.stdin.isTTY && !existingRunId && !(typeof args.question === "string" && args.question.trim())) {
        const answer = await promptForQuestion();
        if (answer)
            args.question = answer;
    }
    let run;
    if (existingRunId) {
        const cwd = path.resolve(cwdArg(args), typeof args.repo === "string" ? args.repo : ".");
        run = loadRun(existingRunId, cwd);
        if (run.cwd !== cwd && !sameRealLocation(run.cwd, cwd)) {
            throw new Error(`Run ${existingRunId} was made for ${run.cwd}, not ${cwd}; refusing to resume it from here (fail closed). Pass --repo ${run.cwd}.`);
        }
    }
    else {
        run = planFresh(args);
    }
    const result = await drive(run.id, run.cwd, { agentConfig: resolveAgentConfig(args), reopenParked: resume });
    let hint;
    if (!result.agentConfigured) {
        hint = `agent backend not configured — ${AGENT_FIX} The one command DELEGATES worker execution to YOUR agent; it never executes a model itself.`;
    }
    else if (result.status === "parked") {
        const log = stopLog(result);
        hint = log
            ? `a worker failed and stopped after its retries. What the agent said is in ${log.shown} — fix the cause, then run: cw --resume --run ${result.runId}`
            : `a worker parked past its retry budget — see ${result.reportPath}; fix the cause, then: cw --resume --run ${result.runId}`;
    }
    else if (result.status === "blocked") {
        hint = `the drive is blocked — see ${result.reportPath}; then: cw --resume --run ${result.runId}`;
    }
    let reportOpened;
    if (Boolean(process.stdout.isTTY) && !wantsJson(args) && !flagOn(args["no-open"] ?? args.noOpen) && process.env.CW_NO_OPEN !== "1") {
        try {
            ensureAndOpenReportHtml(result.reportPath);
            reportOpened = true;
        }
        catch {
            /* opener missing or failed: the summary still shows */
        }
    }
    return { appId: APP_ID, ...result, hint, ...(existingRunId ? { resumedFrom: existingRunId } : {}), ...(reportOpened ? { reportOpened } : {}) };
}
function stopStep(r) {
    if (r.status !== "parked" && r.status !== "blocked")
        return undefined;
    const steps = Array.isArray(r.steps) ? r.steps : [];
    return [...steps].reverse().find((step) => step && (step.status === "parked" || step.status === "blocked"));
}
/** The stopped worker's logs/agent-stderr.log: its text, and its path as
 *  shown (relative when under the cwd). Reads only. */
function stopLog(r) {
    const rec = r;
    const stop = stopStep(rec);
    if (!stop || typeof stop.taskId !== "string" || typeof rec.statePath !== "string")
        return undefined;
    try {
        const file = path.join(path.dirname(rec.statePath), "workers", `worker-${safeFileName(stop.taskId)}-0001`, "logs", "agent-stderr.log");
        const rel = path.relative(process.cwd(), file);
        const text = fs.readFileSync(file, "utf8");
        return text.trim() ? { text, shown: rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? rel : file } : undefined;
    }
    catch {
        return undefined;
    }
}
function stopWhy(r) {
    const stop = stopStep(r);
    if (!stop)
        return undefined;
    const why = [];
    if (typeof stop.reason === "string" && stop.reason.trim())
        why.push(stop.reason.trim());
    const log = stopLog(r);
    const last = log?.text.split("\n").map((line) => line.trim()).filter(Boolean).pop();
    if (last)
        why.push(last.length > 200 ? `${last.slice(0, 199)}…` : last);
    if (log)
        why.push(`All of it: ${log.shown}`);
    return why.length ? why : undefined;
}
/** The TTY view of a `cw -q` result (never for --json or a pipe). */
export function formatQuickstartHuman(json) {
    const r = json;
    if (typeof r.runId !== "string" || typeof r.status !== "string" || typeof r.reportPath !== "string")
        return safeJsonStringify(json);
    return formatQuickstartSummary({
        runId: r.runId,
        reportPath: r.reportPath,
        status: r.status,
        completedWorkers: r.completedWorkers,
        plannedWorkers: r.plannedWorkers,
        agentConfigured: r.agentConfigured,
        why: stopWhy(r),
    }, Boolean(r.reportOpened));
}
