// cli/dispatch.ts — the generic CLI executor over core/capability-table.ts.
//
// `dispatch(args)` first tries the CAPABILITY TABLE: it looks up the row
// whose `cli.path` matches the parsed command (+ enough leading
// positionals to disambiguate a subcommand, e.g. `sandbox list`), calls
// its `cli.handler`, and prints the `CliHandlerResult` per the row's
// `jsonMode`. A new capability is a table row, never a new switch arm here.
//
// `dispatchLegacy` below is a small switch for the entry-level verbs no
// capability-table row can fully own (bare help, `help <topic>`, and
// `ledger`'s unknown-subcommand usage error). It is never extended.
import { formatCommandHelp } from "../core/format/help.js";
import { findCapabilityByCliPath, } from "../core/capability-table.js";
import { KNOWN_COMMANDS, suggestCommand } from "./parseargv.js";
import { printJson, styledHelp } from "./io.js";
import { wantsJson } from "../core/util/cli-args.js";
import { warnUnknownFlags } from "./global-flags.js";
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
export function shouldRenderHuman(jsonMode, options, hasHumanRender, stream = process.stdout) {
    return jsonMode === "default" && !wantsJson(options) && hasHumanRender && Boolean(stream.isTTY);
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
    const useJson = cli.jsonMode === "default" || (cli.jsonMode === "flag" && wantsJson(options));
    if (useJson && result.json !== undefined) {
        printJson(result.json);
    }
    else if (result.text !== undefined) {
        process.stdout.write(result.text.endsWith("\n") ? result.text : `${result.text}\n`);
    }
    else if (result.json !== undefined) {
        printJson(result.json);
    }
    if (result.exitCode !== undefined)
        process.exitCode = result.exitCode;
}
/** Tries the capability table for `args`. Matches the row whose
 *  `cli.path` is `[command]` or `[command, positionals[0]]` (the only two
 *  path lengths any row uses); returns true when a table row
 *  handled the command. `await`ing the handler's result is a no-op for
 *  the rows whose handler returns a plain CliHandlerResult (an
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
        const row = findCapabilityByCliPath(candidatePath);
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
        warnUnknownFlags(row.cli, args.options);
        const result = await row.cli.handler(cliArgs);
        renderCliResult(result, row.cli, args.options);
        return true;
    }
    return false;
}
/** The entry-level switch (see the file header): bare help, `help
 *  <topic>`, and `ledger`'s usage error. Every other verb is a table row
 *  that dispatchTable() above always matches first. */
function dispatchLegacy(args) {
    switch (args.command) {
        case "": {
            process.stdout.write(styledHelp());
            return;
        }
        case "help": {
            const topic = firstPositional(args);
            if (topic) {
                process.stdout.write(formatCommandHelp(topic, suggestCommand));
            }
            else {
                process.stdout.write(styledHelp());
            }
            return;
        }
        // `ledger propose|review|verify|apply|list` are capability-table rows
        // that dispatchTable() above always matches first; this arm is reached
        // only for an unrecognized subcommand. "ledger" is intentionally absent
        // from KNOWN_COMMANDS (see cli/parseargv.ts) even though the dispatcher
        // handles it here — a known, preserved wart, not a bug.
        case "ledger": {
            throw new Error("Usage: cw ledger propose|review|verify|apply|list [options]");
        }
        default: {
            const hint = suggestCommand(args.command);
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
 *  back to the entry-level switch. */
export async function dispatch(args) {
    if (await dispatchTable(args))
        return;
    dispatchLegacy(args);
}
/** Re-exported so cli/entry.ts (and tests) can check membership without a
 *  second import path. */
export { KNOWN_COMMANDS };
