"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleRun = handleRun;
const capability_core_1 = require("../../capability-core");
const run_registry_1 = require("../../run-registry");
const run_summary_1 = require("../run-summary");
const io_1 = require("../io");
/** `cw run <app> --drive [--once]` (Agent Delegation Drive) + the run-registry verbs
 *  (drive/search/list/show/resume/archive/rerun/export/import/verify-import/inspect-archive/restore). */
function handleRun(args, runner) {
    // Agent Delegation Drive (v0.1.38): `cw run <app> --drive [--once]` drives a
    // run end-to-end by delegating each worker to the agent backend. Distinct from
    // the run-REGISTRY verbs below. `--preview` (or the `run drive <run-id>` form)
    // is the read-only, deterministic next-step preview.
    //
    // A run-REGISTRY subcommand keyword (resume/show/...) must NOT be intercepted
    // here just because it carries a --drive flag of its own — e.g.
    // `run resume <id> --drive` is the resume verb's opt-in continuation, not
    // `run <app=resume> --drive`. Fall through to the switch for those keywords.
    const runRegistrySubcommand = new Set([
        "drive", "search", "list", "show", "resume", "archive", "rerun", "export", "import", "verify-import", "inspect-archive", "restore"
    ]);
    if (args.options.drive && !runRegistrySubcommand.has(String(args.positionals[0] || ""))) {
        const target = args.positionals[0];
        const runId = (0, io_1.optionalArg)(args.options.run) || (0, io_1.optionalArg)(args.options.runId);
        if (args.options.preview) {
            (0, io_1.printJson)((0, capability_core_1.runDrivePreview)(runner, { ...args.options, runId: runId || target }));
            return;
        }
        const driveArgs = { ...args.options };
        if (runId)
            driveArgs.runId = runId;
        else
            driveArgs.appId = target;
        const dr = (0, capability_core_1.runDrive)(runner, driveArgs);
        (0, io_1.printJson)(dr);
        if (!(0, io_1.wantsJson)(args.options)) {
            (0, run_summary_1.emitRunSummary)(runner, args.options, {
                runId: dr.runId,
                reportPath: dr.reportPath,
                status: dr.status,
                statePath: dr.statePath,
                completedWorkers: dr.completedWorkers,
                plannedWorkers: dr.plannedWorkers,
                agentConfigured: dr.agentConfigured
            });
        }
        return;
    }
    const registry = (0, capability_core_1.runRegistryFor)(args.options, runner);
    const [subcommand, id] = args.positionals;
    switch (subcommand) {
        case "drive": {
            // `run drive <run-id>` = read-only preview; `--step [--once]` = mutating drive.
            if (args.options.step) {
                const driveArgs = { ...args.options };
                if (id)
                    driveArgs.runId = id;
                const dr = (0, capability_core_1.runDrive)(runner, driveArgs);
                (0, io_1.printJson)(dr);
                if (!(0, io_1.wantsJson)(args.options)) {
                    (0, run_summary_1.emitRunSummary)(runner, args.options, {
                        runId: dr.runId,
                        reportPath: dr.reportPath,
                        status: dr.status,
                        statePath: dr.statePath,
                        completedWorkers: dr.completedWorkers,
                        plannedWorkers: dr.plannedWorkers,
                        agentConfigured: dr.agentConfigured
                    });
                }
                return;
            }
            (0, io_1.printJson)((0, capability_core_1.runDrivePreview)(runner, { ...args.options, runId: (0, io_1.required)(id, "run id") }));
            return;
        }
        case "search": {
            const result = (0, capability_core_1.runSearch)(registry, args.options);
            if ((0, io_1.wantsJson)(args.options))
                (0, io_1.printJson)(result);
            else
                process.stdout.write(`${(0, run_registry_1.formatRunSearch)(result)}\n`);
            return;
        }
        case "list": {
            const result = (0, capability_core_1.runList)(registry, args.options);
            if ((0, io_1.wantsJson)(args.options))
                (0, io_1.printJson)(result);
            else
                process.stdout.write(`${(0, run_registry_1.formatRunSearch)(result)}\n`);
            return;
        }
        case "show": {
            const result = (0, capability_core_1.runShow)(registry, (0, io_1.required)(id, "run id"), args.options);
            if ((0, io_1.wantsJson)(args.options))
                (0, io_1.printJson)(result);
            else
                process.stdout.write(`${(0, run_registry_1.formatRunShow)(result)}\n`);
            return;
        }
        case "resume": {
            const result = (0, capability_core_1.runResume)(registry, runner, (0, io_1.required)(id, "run id"), args.options);
            if ((0, io_1.wantsJson)(args.options))
                (0, io_1.printJson)(result);
            else
                process.stdout.write(`${(0, run_registry_1.formatResume)(result)}\n`);
            return;
        }
        case "archive":
            (0, io_1.printJson)((0, capability_core_1.runArchive)(registry, id, args.options));
            return;
        case "rerun":
            (0, io_1.printJson)((0, capability_core_1.runRerun)(registry, (0, io_1.required)(id, "run id"), args.options));
            return;
        case "export":
            (0, io_1.printJson)((0, capability_core_1.runExportArchive)(runner, (0, io_1.required)(id || (0, io_1.optionalArg)(args.options.runId || args.options.run), "run id"), args.options));
            return;
        case "import":
            (0, io_1.printJson)((0, capability_core_1.runImportArchive)(runner, { ...args.options, archive: id || args.options.archive || args.options.path }));
            return;
        case "verify-import": {
            const result = (0, capability_core_1.runVerifyImport)(runner, (0, io_1.required)(id || (0, io_1.optionalArg)(args.options.runId || args.options.run), "run id"), args.options);
            (0, io_1.printJson)(result);
            // Fail-closed ONLY behind --strict, so the default exit stays 0
            // (byte-identical). With --strict, any failed restore check — including
            // the new trust-audit row — exits 1 for `verify-import && restore`.
            if (Boolean(args.options.strict) && !result.ok)
                process.exitCode = 1;
            return;
        }
        case "inspect-archive": {
            const result = (0, capability_core_1.runInspectArchive)(runner, { ...args.options, archive: id || args.options.archive || args.options.path });
            (0, io_1.printJson)(result);
            // Read-only diagnostic: exit 1 when the archive fails any integrity check,
            // so `cw run inspect-archive <path> && restore` stops on a bad archive.
            if (!result.ok)
                process.exitCode = 1;
            return;
        }
        case "restore": {
            const result = (0, capability_core_1.runRestoreArchive)(runner, { ...args.options, archive: id || args.options.archive || args.options.path });
            (0, io_1.printJson)(result);
            // Fail-closed: exit 1 when inspect OR verify failed, so a tampered or
            // unverifiable archive never reports a made-up success (mirrors the
            // inspect-archive exit-1 pattern).
            if (!result.ok)
                process.exitCode = 1;
            return;
        }
        default:
            throw new Error("Usage: cw.js run search|list|show|resume|archive|rerun|drive|export|import|verify-import|inspect-archive|restore [run-id|archive] [--scope repo|home] [--json]  |  cw.js run <app> --drive [--once] [--incremental] [--repo R --question Q]");
    }
}
