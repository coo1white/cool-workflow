// shell/run-store.ts — a run's folder on disk: .cw/runs/<id>/state.json and
// its siblings. Only direct path lookup: there is no run registry.
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { RUN_STATE_SCHEMA_VERSION } from "../core/state/types.js";
import { assertSafeRunId, lockHolder, tryLock, unlock, writeJson } from "./fs-atomic.js";
export function runsDir(cwd) {
    return path.join(path.resolve(cwd), ".cw", "runs");
}
export function runPaths(runDir) {
    return {
        runDir,
        state: path.join(runDir, "state.json"),
        report: path.join(runDir, "report.md"),
        resultsDir: path.join(runDir, "results"),
        commitsDir: path.join(runDir, "commits"),
        workersDir: path.join(runDir, "workers"),
    };
}
export function newRunId(workflowId, now = new Date()) {
    const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
    const suffix = crypto.randomBytes(3).toString("hex");
    return `${workflowId}-${stamp}-${suffix}`;
}
export function saveRun(run) {
    run.updatedAt = new Date().toISOString();
    writeJson(run.paths.state, run, { durable: true });
}
export const OLD_RUN_REFUSAL = "was made by an older cw and cannot be read by this one; start a new run: cw -q \"<question>\"";
/** Load .cw/runs/<id>/state.json under `cwd`. Paths come from where the run
 *  sits on disk, never from the file. An older state format is refused. */
export function loadRun(runId, cwd) {
    assertSafeRunId(runId);
    const runDir = path.join(runsDir(cwd), runId);
    const file = path.join(runDir, "state.json");
    if (!fs.existsSync(file))
        throw new Error(`Run not found: ${runId} (no ${path.join(".cw", "runs", runId, "state.json")} under ${path.resolve(cwd)})`);
    let raw;
    try {
        raw = JSON.parse(fs.readFileSync(file, "utf8"));
    }
    catch (error) {
        throw new Error(`Run ${runId} has a state.json that is not valid JSON (${error.message}); refusing to use it`);
    }
    if (!raw || typeof raw !== "object" || raw.schemaVersion !== RUN_STATE_SCHEMA_VERSION)
        throw new Error(`Run ${runId} ${OLD_RUN_REFUSAL}`);
    if (raw.id !== runId || !Array.isArray(raw.tasks) || !Array.isArray(raw.phases))
        throw new Error(`Run ${runId} has a state.json for a different or broken run; refusing to use it`);
    const run = raw;
    // Keep the spelling the run was made under (macOS /var vs /private/var) when
    // it names this same folder; anything else is ignored.
    const made = typeof raw.cwd === "string" ? path.join(runsDir(raw.cwd), runId) : "";
    run.paths = runPaths(made && sameFolder(made, runDir) ? made : runDir);
    if (!Array.isArray(run.commits))
        run.commits = [];
    return run;
}
/** The newest run (by id, which starts with a time stamp) under `cwd`. */
function sameFolder(a, b) {
    try {
        return fs.realpathSync(a) === fs.realpathSync(b);
    }
    catch {
        return false;
    }
}
export function latestRunId(cwd) {
    const dir = runsDir(cwd);
    if (!fs.existsSync(dir))
        return undefined;
    const ids = fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(dir, entry.name, "state.json")))
        .map((entry) => entry.name)
        .sort((a, b) => fs.statSync(path.join(dir, a, "state.json")).mtimeMs - fs.statSync(path.join(dir, b, "state.json")).mtimeMs || (a < b ? -1 : 1));
    return ids.pop();
}
/** One drive per run at a time; a lock left by a dead process is taken over. */
export function acquireDriveLock(run) {
    const lock = path.join(run.paths.runDir, "drive.lock");
    if (!tryLock(lock)) {
        throw new Error(`Run ${run.id} is being driven by another cw process (pid ${lockHolder(lock) ?? "unknown"}); wait for it to finish`);
    }
    return () => unlock(lock);
}
