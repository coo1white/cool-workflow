// `cw workbench` handler — first of the per-group handler modules carved out of
// the command-surface god-dispatch (the deep audit's P1). The dispatcher routes
// `case "workbench"` here; this module owns the verb's parsing + rendering, using
// the shared cli/io + cli/format helpers extracted earlier.
import { CoolWorkflowRunner, parseArgv } from "../../orchestrator";
import { buildWorkbenchRunView, buildWorkbenchServeDescriptor } from "../../workbench";
import { WorkbenchHost } from "../../workbench-host";
import { formatWorkbenchView } from "../format";
import { printJson, required, wantsJson } from "../io";

type ParsedArgs = ReturnType<typeof parseArgv>;

/** `cw workbench serve [--port N] [--once] | view <run-id> [--json]` — the optional
 *  read-only, localhost-only workbench. Behaviour-identical to the former inline case. */
export async function handleWorkbench(args: ParsedArgs, runner: CoolWorkflowRunner): Promise<void> {
  const [subcommand, runId] = args.positionals;
  switch (subcommand) {
    case "view": {
      // Read-only five-panel view of one run. Same core entry as cw_workbench_view.
      const view = buildWorkbenchRunView(runner, required(runId, "run id"));
      if (wantsJson(args.options)) printJson(view);
      else process.stdout.write(`${formatWorkbenchView(view)}\n`);
      return;
    }
    case "serve": {
      // The OPTIONAL localhost host. `--once`/`--json` emit the descriptor only
      // (no server); the default starts the read-only, localhost-only host.
      if (args.options.once || wantsJson(args.options)) {
        printJson(buildWorkbenchServeDescriptor(runner, { ...args.options, once: true }));
        return;
      }
      const host = new WorkbenchHost({
        runner,
        cwd: String(args.options.cwd || process.cwd()),
        port: Number(args.options.port) || undefined,
        scope: args.options.scope === "repo" ? "repo" : "home"
      });
      await host.run();
      return;
    }
    default:
      throw new Error("Usage: cw.js workbench serve [--port N] [--once] | view <run-id> [--json]");
  }
}
