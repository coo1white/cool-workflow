// core/state/run-paths.ts — pure RunPaths construction.
//
// `createRunPaths` is pure path math. The directory write mechanism lives in
// shell/run-store.ts.
//
// Evidence: SPEC/state-core.md "state module — persistence kernel" and "The
// full .cw/runs/<run-id>/ layout".
import * as path from "node:path";
/** The 16-key RunPaths object, all joined under `runDir`. */
export function createRunPaths(runDir) {
    return {
        runDir,
        state: path.join(runDir, "state.json"),
        report: path.join(runDir, "report.md"),
        tasksDir: path.join(runDir, "tasks"),
        resultsDir: path.join(runDir, "results"),
        dispatchesDir: path.join(runDir, "dispatches"),
        artifactsDir: path.join(runDir, "artifacts"),
        commitsDir: path.join(runDir, "commits"),
        stateNodesDir: path.join(runDir, "nodes"),
        feedbackDir: path.join(runDir, "feedback"),
        auditDir: path.join(runDir, "audit"),
        workersDir: path.join(runDir, "workers"),
        candidatesDir: path.join(runDir, "candidates"),
        multiAgentDir: path.join(runDir, "multi-agent"),
        blackboardDir: path.join(runDir, "blackboard"),
        topologiesDir: path.join(runDir, "topologies"),
    };
}
const AUDIT_FILES = [
    ["eventLogPath", "events.jsonl"],
    ["summaryPath", "summary.json"],
    ["indexPath", "index.json"],
];
/** The repo folder of a run folder in the `<repo>/.cw/runs/<run-id>`
 *  layout, else undefined. */
function repoOfRunDir(runDir, runId) {
    const runs = path.dirname(runDir);
    const cw = path.dirname(runs);
    return path.basename(runDir) === runId && path.basename(runs) === "runs" && path.basename(cw) === ".cw" ? path.dirname(cw) : undefined;
}
/** The refusal for a run folder copied by hand (for one, `cp -R`), or
 *  undefined when the folder is not such a copy. `foundRunDir` is the
 *  absolute folder the run's state.json was read from, `storedRunDir` the
 *  raw `paths.runDir` value in that state.json. It is a copy only when ALL
 *  of these hold, so a moved repo, a cloned repo, a symlinked path, an old
 *  state with no usable `paths.runDir`, and a run made by `cw run import`
 *  all go on as before:
 *  - the stored value is an absolute path in the `<repo>/.cw/runs/<run-id>`
 *    layout, for this same run id, and so is the found folder;
 *  - it is not the found folder (equal after `path.resolve`, or the same
 *    real place by `sameLocation`, for one macOS /var and /private/var);
 *  - `originHasRun(stored)` says the original folder still has this run's
 *    state.json (it is not the found file itself). A moved repo has none.
 *  Pure: the shell gives `sameLocation` and `originHasRun`. */
export function copiedRunRefusal(runId, foundRunDir, storedRunDir, sameLocation, originHasRun) {
    if (typeof storedRunDir !== "string" || !path.isAbsolute(storedRunDir))
        return undefined;
    const stored = path.resolve(storedRunDir);
    const found = path.resolve(foundRunDir);
    if (stored === found)
        return undefined;
    const originRepo = repoOfRunDir(stored, runId);
    const copyRepo = repoOfRunDir(found, runId);
    if (originRepo === undefined || copyRepo === undefined)
        return undefined;
    if (sameLocation(stored, found) || !originHasRun(stored))
        return undefined;
    const archive = path.join(copyRepo, `${runId}.cwrun.json`);
    return (`Refusing to load run ${runId}: the folder ${found} is a copy of ${stored}, made outside cw (for one, with cp -R), ` +
        `and its state still points at that original folder, which is still there. Using the copy could read or write the original, so cw stops here (fail closed). ` +
        `To move a run, take away this copy, then run: cw run export ${runId} --cwd ${originRepo} --output ${archive} ` +
        `and then: cw run import ${archive} --target ${copyRepo}`);
}
/** Make a loaded run's `paths` (and the audit paths under them) again from
 *  `runDir`, the folder the run's state.json was really found in. The
 *  stored values are never trusted as write targets: a state.json from a
 *  cloned repo can point them anywhere, and a repo that was moved keeps
 *  its old absolute paths. A stored value is kept, byte for byte, only when
 *  `sameLocation(stored, rebuilt)` says it names the same place as the
 *  rebuilt one (for one, the same folder seen through a symlink such as
 *  macOS /var -> /private/var); any other value is replaced. Keys keep
 *  their stored order, so a run whose stored paths were already right
 *  saves byte-identical; a stored key that is not one of createRunPaths'
 *  keys is dropped. Audit path keys are set only where the stored audit
 *  block has them. Changes `run` in place. */
export function rebindRunPaths(run, runDir, sameLocation = (a, b) => a === b) {
    const fresh = createRunPaths(runDir);
    const stored = (run.paths && typeof run.paths === "object" ? run.paths : {});
    const pick = (value, rebuilt) => typeof value === "string" && (value === rebuilt || sameLocation(value, rebuilt)) ? value : rebuilt;
    const paths = {};
    for (const key of Object.keys(stored)) {
        if (Object.prototype.hasOwnProperty.call(fresh, key))
            paths[key] = pick(stored[key], fresh[key]);
    }
    for (const key of Object.keys(fresh)) {
        if (!Object.prototype.hasOwnProperty.call(paths, key))
            paths[key] = fresh[key];
    }
    run.paths = paths;
    if (run.audit && typeof run.audit === "object") {
        for (const [key, file] of AUDIT_FILES) {
            if (Object.prototype.hasOwnProperty.call(run.audit, key))
                run.audit[key] = pick(run.audit[key], path.join(fresh.auditDir, file));
        }
    }
    return run;
}
