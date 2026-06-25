// `cw run …` handler — the run-registry + Agent Delegation Drive family, carved
// out of the command-surface god-dispatch. Two distinct surfaces under one verb:
//   - `cw run <app> --drive [--once]` drives a run end-to-end by delegating each
//     worker to the agent backend (`--preview` = the read-only next-step preview).
//   - the run-REGISTRY verbs: drive/search/list/show/resume/archive/rerun/export/
//     import/verify-import/inspect-archive over the saved run registry.
// A registry keyword carrying its own `--drive` flag (e.g. `run resume <id>
// --drive`) is NOT hijacked by the `<app> --drive` intercept — the guard Set
// below keeps that contract. Fail-closed exits preserved byte-for-byte:
// verify-import (only under --strict) and inspect-archive (unconditional).
import { CoolWorkflowRunner, parseArgv } from "../../orchestrator";
import { runArchive, runDrive, runDrivePreview, runExportArchive, runImportArchive, runInspectArchive, runList, runRegistryFor, runRerun, runResume, runSearch, runShow, runVerifyImport } from "../../capability-core";
import { formatResume, formatRunSearch, formatRunShow } from "../../run-registry";
import { emitRunSummary } from "../run-summary";
import { optionalArg, printJson, required, wantsJson } from "../io";

type ParsedArgs = ReturnType<typeof parseArgv>;

/** `cw run <app> --drive [--once]` (Agent Delegation Drive) + the run-registry verbs
 *  (drive/search/list/show/resume/archive/rerun/export/import/verify-import/inspect-archive). */
export function handleRun(args: ParsedArgs, runner: CoolWorkflowRunner): void {
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
    "drive", "search", "list", "show", "resume", "archive", "rerun", "export", "import", "verify-import", "inspect-archive"
  ]);
  if (args.options.drive && !runRegistrySubcommand.has(String(args.positionals[0] || ""))) {
    const target = args.positionals[0];
    const runId = optionalArg(args.options.run) || optionalArg(args.options.runId);
    if (args.options.preview) {
      printJson(runDrivePreview(runner, { ...args.options, runId: runId || target }));
      return;
    }
    const driveArgs = { ...args.options } as Record<string, unknown>;
    if (runId) driveArgs.runId = runId;
    else driveArgs.appId = target;
    const dr = runDrive(runner, driveArgs);
    printJson(dr);
    if (!wantsJson(args.options)) {
      emitRunSummary(runner, args.options, {
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
  const registry = runRegistryFor(args.options, runner);
  const [subcommand, id] = args.positionals;
  switch (subcommand) {
    case "drive": {
      // `run drive <run-id>` = read-only preview; `--step [--once]` = mutating drive.
      if (args.options.step) {
        const driveArgs = { ...args.options } as Record<string, unknown>;
        if (id) driveArgs.runId = id;
        const dr = runDrive(runner, driveArgs);
        printJson(dr);
        if (!wantsJson(args.options)) {
          emitRunSummary(runner, args.options, {
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
      printJson(runDrivePreview(runner, { ...args.options, runId: required(id, "run id") }));
      return;
    }
    case "search": {
      const result = runSearch(registry, args.options);
      if (wantsJson(args.options)) printJson(result);
      else process.stdout.write(`${formatRunSearch(result)}\n`);
      return;
    }
    case "list": {
      const result = runList(registry, args.options);
      if (wantsJson(args.options)) printJson(result);
      else process.stdout.write(`${formatRunSearch(result)}\n`);
      return;
    }
    case "show": {
      const result = runShow(registry, required(id, "run id"), args.options);
      if (wantsJson(args.options)) printJson(result);
      else process.stdout.write(`${formatRunShow(result)}\n`);
      return;
    }
    case "resume": {
      const result = runResume(registry, runner, required(id, "run id"), args.options);
      if (wantsJson(args.options)) printJson(result);
      else process.stdout.write(`${formatResume(result)}\n`);
      return;
    }
    case "archive":
      printJson(runArchive(registry, id, args.options));
      return;
    case "rerun":
      printJson(runRerun(registry, required(id, "run id"), args.options));
      return;
    case "export":
      printJson(runExportArchive(runner, required(id || optionalArg(args.options.runId || args.options.run), "run id"), args.options));
      return;
    case "import":
      printJson(runImportArchive(runner, { ...args.options, archive: id || args.options.archive || args.options.path }));
      return;
    case "verify-import": {
      const result = runVerifyImport(runner, required(id || optionalArg(args.options.runId || args.options.run), "run id"), args.options);
      printJson(result);
      // Fail-closed ONLY behind --strict, so the default exit stays 0
      // (byte-identical). With --strict, any failed restore check — including
      // the new trust-audit row — exits 1 for `verify-import && restore`.
      if (Boolean(args.options.strict) && !(result as { ok?: boolean }).ok) process.exitCode = 1;
      return;
    }
    case "inspect-archive": {
      const result = runInspectArchive(runner, { ...args.options, archive: id || args.options.archive || args.options.path });
      printJson(result);
      // Read-only diagnostic: exit 1 when the archive fails any integrity check,
      // so `cw run inspect-archive <path> && restore` stops on a bad archive.
      if (!(result as { ok?: boolean }).ok) process.exitCode = 1;
      return;
    }
    default:
      throw new Error("Usage: cw.js run search|list|show|resume|archive|rerun|drive|export|import|verify-import|inspect-archive [run-id|archive] [--scope repo|home] [--json]  |  cw.js run <app> --drive [--once] [--incremental] [--repo R --question Q]");
  }
}
