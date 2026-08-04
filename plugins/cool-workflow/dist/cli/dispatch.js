"use strict";
// cli/dispatch.ts — the generic CLI executor over core/capability-table.ts.
//
// MILESTONE 2 (plugins/cool-workflow/project/docs/rebuild/PLAN.md build order, step 2; see the Revision note there
// for why this lands here, right after CLI parsing, instead of late).
//
// `dispatch(args)` first tries the CAPABILITY TABLE: it looks up the row
// whose `cli.path` matches the parsed command (+ enough leading
// positionals to disambiguate a subcommand, e.g. `sandbox list`), calls
// its `cli.handler`, and prints the `CliHandlerResult` per the row's
// `jsonMode`. This is the ONLY code path future milestones touch when
// they add a capability — as a table row, never a new switch arm here.
//
// Everything below `dispatchLegacy` is the milestone-1 carry-over: a
// small, explicitly-scoped switch for verbs that conformance/cases/
// cli-argv-parsing.case.js and cli-exit-codes.case.js probe but that do
// not yet have a real subsystem behind them (see each case's own
// PLACEHOLDER comment for which future milestone owns it). Per the
// Revision note in plugins/cool-workflow/project/docs/rebuild/PLAN.md, THIS file is never hand-extended again —
// `dispatchLegacy`'s arms shrink to nothing as later milestones move each
// one into a real capability-table row; nothing new is ever added here.
Object.defineProperty(exports, "__esModule", { value: true });
exports.KNOWN_COMMANDS = void 0;
exports.shouldRenderHuman = shouldRenderHuman;
exports.dispatch = dispatch;
const help_1 = require("../core/format/help");
const capability_table_1 = require("../core/capability-table");
const parseargv_1 = require("./parseargv");
Object.defineProperty(exports, "KNOWN_COMMANDS", { enumerable: true, get: function () { return parseargv_1.KNOWN_COMMANDS; } });
const io_1 = require("./io");
const cli_args_1 = require("../core/util/cli-args");
const global_flags_1 = require("./global-flags");
function firstPositional(args, index = 0) {
    return args.positionals[index];
}
/** The one rendering-mode decision for a `jsonMode: "default"` row's
 *  OPTIONAL human projection (CliBinding.humanRender): true ONLY when the
 *  row is "default", the caller did NOT ask for JSON (`--json`/`--format
 *  json`), the row declares a humanRender, AND stdout is a real TTY.
 *  Every other combination — every pipe, every script, every conformance
 *  run — stays byte-identical JSON. Deliberately does NOT read
 *  FORCE_COLOR/NO_COLOR: color env vars style output, they never pick
 *  the output mode (cli-color-env pipes with FORCE_COLOR=1 and must stay
 *  JSON). Pure of the injectable `stream` (default process.stdout),
 *  following shell/workbench-host.ts's printServeHint pattern. */
function shouldRenderHuman(jsonMode, options, hasHumanRender, stream = process.stdout) {
    return jsonMode === "default" && !(0, cli_args_1.wantsJson)(options) && hasHumanRender && Boolean(stream.isTTY);
}
/** Writes a `CliHandlerResult` to stdout and applies its exit code, per
 *  the row's `jsonMode`:
 *   - `"default"` — always prints `result.json` as JSON (falls back to
 *     `result.text` when a row has no canonical JSON shape). On a real
 *     TTY, a row that declares `humanRender` prints that human text
 *     instead (see shouldRenderHuman above — piped bytes never change).
 *   - `"flag"` — prints `result.text` normally, `result.json` under
 *     `--json`/`--format json`.
 *   - `"human"` — always prints `result.text`; there is no JSON form. */
function renderCliResult(result, cli, options) {
    if (shouldRenderHuman(cli.jsonMode, options, Boolean(cli.humanRender)) && result.json !== undefined) {
        const human = cli.humanRender(result.json);
        process.stdout.write(human.endsWith("\n") ? human : `${human}\n`);
        if (result.exitCode !== undefined)
            process.exitCode = result.exitCode;
        return;
    }
    const useJson = cli.jsonMode === "default" || (cli.jsonMode === "flag" && (0, cli_args_1.wantsJson)(options));
    if (useJson && result.json !== undefined) {
        (0, io_1.printJson)(result.json);
    }
    else if (result.text !== undefined) {
        process.stdout.write(result.text.endsWith("\n") ? result.text : `${result.text}\n`);
    }
    else if (result.json !== undefined) {
        (0, io_1.printJson)(result.json);
    }
    if (result.exitCode !== undefined)
        process.exitCode = result.exitCode;
}
/** Tries the capability table for `args`. Matches the row whose
 *  `cli.path` is `[command]` or `[command, positionals[0]]` (the only two
 *  path lengths any milestone-2 row uses); returns true when a table row
 *  handled the command. `await`ing the handler's result is a no-op for
 *  the ~199 rows whose handler returns a plain CliHandlerResult (an
 *  `await` on a non-Promise value just resolves on the next microtask,
 *  invisible to any caller that itself awaits dispatch()) -- it only
 *  matters for the live drive rows, which return a real Promise so their
 *  round loop can actually stay interruptible (see shell/drive.ts's
 *  driveAsync). */
async function dispatchTable(args) {
    const candidates = [[args.command]];
    if (args.positionals.length > 0)
        candidates.push([args.command, args.positionals[0]]);
    for (const candidatePath of candidates.slice().reverse()) {
        const row = (0, capability_table_1.findCapabilityByCliPath)(candidatePath);
        if (!row || !row.cli)
            continue;
        const consumed = candidatePath.length - 1; // path[0] is the command itself, already consumed
        const cliArgs = {
            positionals: args.positionals.slice(consumed),
            options: args.options,
        };
        // Rows that declare a complete flag list get the TTY-only unknown-flag
        // warning (one stderr line; stdout and the exit code never change —
        // see cli/global-flags.ts).
        (0, global_flags_1.warnUnknownFlags)(row.cli, args.options);
        const result = await row.cli.handler(cliArgs);
        renderCliResult(result, row.cli, args.options);
        return true;
    }
    return false;
}
/** The milestone-1 carry-over switch. See file header: never extended
 *  again — each arm here is replaced by a capability-table row when its
 *  own build-order milestone lands, not edited in place. Only entry-level
 *  concerns live here now (bare help, and the two verbs a real
 *  capability-table row can never fully own): every other verb this
 *  switch used to carry is now a table row (see the NOTEs below) and
 *  dispatchTable() above always matches it first. */
function dispatchLegacy(args) {
    switch (args.command) {
        case "": {
            process.stdout.write((0, io_1.styledHelp)());
            return;
        }
        case "help": {
            const topic = firstPositional(args);
            if (topic) {
                process.stdout.write((0, help_1.formatCommandHelp)(topic, parseargv_1.suggestCommand));
            }
            else {
                process.stdout.write((0, io_1.styledHelp)());
            }
            return;
        }
        // NOTE: "version" is not an arm here — it is a real capability-table
        // row (core/capability-table.ts) that dispatchTable() above always
        // matches first, per the Revision note's "table rows, never a new
        // switch arm" rule. Same for "list", "status", "sandbox list", and
        // "search" (a cli-only row, hiddenFromHelp, so `cw help search` keeps
        // its existing "Unknown command" text).
        // NOTE: "plan" and "quickstart" are not arms here any more — both are
        // now real capability-table rows (core/capability-table.ts, milestone
        // 6+7) that dispatchTable() above always matches first.
        // NOTE: "next" is not an arm here any more — it is a real
        // capability-table row (core/capability-table.ts) that dispatchTable()
        // above always matches first.
        // MILESTONE 8 — `ledger propose|review|verify|apply|list` are now
        // real capability-table rows (core/capability-table.ts) that
        // dispatchTable() above always matches first; this arm is reached
        // only for an unrecognized subcommand (byte-exact to the old
        // build's handleLedger default case). NOTE: "ledger" is
        // intentionally absent from KNOWN_COMMANDS (see cli/parseargv.ts)
        // even though the dispatcher handles it here — a known, preserved
        // wart, not a bug.
        case "ledger": {
            throw new Error("Usage: cw ledger propose|review|verify|apply|list [options]");
        }
        // NOTE: "gc" is not an arm here any more — gc.plan/gc.run/gc.verify
        // are now real capability-table rows (core/capability-table.ts) that
        // dispatchTable() above always matches first.
        // NOTE: "run" is not an arm here any more — run.drive.step/run.drive
        // are now real capability-table rows (core/capability-table.ts,
        // milestone 6+7) that dispatchTable() above always matches first
        // (their handler reproduces the inspect-archive/restore placeholder
        // shapes this arm used to own), per the Revision note's "table rows,
        // never a new switch arm" rule.
        // NOTE: "sandbox" is not an arm here — sandbox.list/show/validate are
        // now real capability-table rows (core/capability-table.ts, milestone
        // 5) that dispatchTable() above always matches first, per the
        // Revision note's "table rows, never a new switch arm" rule.
        // NOTE: "topology" is not an arm here any more — topology.list/show/
        // validate/apply/summary/graph are now real capability-table rows
        // (core/capability-table.ts, milestone 9) that dispatchTable() above
        // always matches first, per the Revision note's "table rows, never a
        // new switch arm" rule.
        // NOTE: "migration" is not an arm here any more — migration.list/
        // check/prove are now real capability-table rows
        // (core/capability-table.ts) that dispatchTable() above always
        // matches first.
        // NOTE: "report" is not an arm here any more — report/report.bundle/
        // report.verify-bundle are now real capability-table rows
        // (core/capability-table.ts, milestones 8/11) that dispatchTable()
        // above always matches first, per the Revision note's "table rows,
        // never a new switch arm" rule.
        default: {
            const hint = (0, parseargv_1.suggestCommand)(args.command);
            const tail = hint ? `. Did you mean: ${hint}?` : "";
            throw new Error(`Unknown command: ${args.command}${tail}`);
        }
    }
}
/** Runs one parsed command. Throws on any recoverable failure (the entry
 *  point's top-level catch turns that into the `cw: <message>` stderr
 *  shape + exit 1); sets `process.exitCode = 1` directly for the
 *  fail-closed-but-clean-JSON verbs (never a hard `process.exit`).
 *
 *  Tries the capability table FIRST (real rows always win), then falls
 *  back to the milestone-1 legacy switch for verbs not yet migrated. */
async function dispatch(args) {
    if (await dispatchTable(args))
        return;
    dispatchLegacy(args);
}
