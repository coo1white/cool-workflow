"use strict";
// cli/entry.ts — the real entry point (`cw` / `cool-workflow` binaries).
//
// Byte-exact port of the shape of src/cli.ts + the top-of-function part of
// src/cli/command-surface.ts's `runCli` in the old build: top-level flag
// redirects, then dispatch (see cli/dispatch.ts), then the top-level
// catch that turns any thrown error into the fixed `cw: <message>` /
// `  Try: <hint>` stderr shape.
//
// Color: MILESTONE 11 (reporting/observability) wires shell/term.ts's
// color primitives here — the "Cool Workflow" help header is bolded and
// the error path is styled (bold "cw:", red message, dim "Try:"), TTY/
// env-gated exactly as SPEC/reporting-ux.md's "Color rule" describes.
// Every conformance case still pipes with NO_COLOR=1 by default (lib.js),
// so byte content there is unaffected; cli-color-env.case.js exercises
// the FORCE_COLOR/NO_COLOR/CW_NO_COLOR branches explicitly.
Object.defineProperty(exports, "__esModule", { value: true });
exports.recoveryHint = recoveryHint;
exports.runCli = runCli;
exports.main = main;
const parseargv_1 = require("./parseargv");
const dispatch_1 = require("./dispatch");
const help_1 = require("../core/format/help");
const parseargv_2 = require("./parseargv");
const capability_table_1 = require("../core/capability-table");
const term_1 = require("../shell/term");
const io_1 = require("./io");
/** MILESTONE 2: `version` is now a pure projection of the capability
 *  table's `version` row — there is exactly one place its print text
 *  lives (core/capability-table.ts's cli handler), not a second
 *  hard-coded copy here. `help` has no row of its own (it is cli/
 *  entry.ts's own top-level redirect, same as milestone 1); its text
 *  comes from core/format/help.ts either way. */
function printVersion() {
    const row = (0, capability_table_1.findCapability)("version");
    // `version`'s own handler is a pure, synchronous projection (never one of
    // the live drive rows) -- safe to read `.text` straight off it rather than
    // route through the generic (possibly-async) dispatch path.
    const result = row?.cli?.handler({ positionals: [], options: {} });
    process.stdout.write(result?.text ?? "");
}
/** src/cli.ts:18-29 — map a top-level error message to ONE copy-pasteable
 *  recovery command. Content-based so it stays correct regardless of which
 *  call site threw; returns undefined rather than a wrong guess. */
function recoveryHint(message) {
    const m = message.toLowerCase();
    if (m.startsWith("unknown command"))
        return "cw help";
    if (m.includes("not configured") || m.includes("agent backend"))
        return "cw doctor";
    if (m.includes("missing") && m.includes("repo"))
        return 'cw -q "<question>" -dir <project-folder>';
    if (m.includes("app") && (m.includes("not found") || m.includes("not available")))
        return "cw app list";
    if (m.includes("run id") || m.includes("run not found"))
        return "cw run list";
    return undefined;
}
async function runCli(argv = process.argv.slice(2)) {
    const args = (0, parseargv_1.parseArgv)(argv);
    // Top-level flags: accept --version / -v / --help / -h before command lookup.
    // (src/cli/command-surface.ts:46-55)
    if (args.command?.startsWith("-") || !args.command) {
        if (args.command === "--version" || args.command === "-v" || args.options.v || args.options.version) {
            printVersion();
            return;
        }
        if (!args.command || args.command === "--help" || args.command === "-h" || args.options.h || args.options.help) {
            process.stdout.write((0, io_1.styledHelp)());
            return;
        }
    }
    // Vendor short flags -> --agent-command (src/cli/command-surface.ts:59-62).
    if (args.options.claude)
        args.options["agent-command"] = "builtin:claude";
    if (args.options.codex)
        args.options["agent-command"] = "builtin:codex";
    if (args.options.gemini)
        args.options["agent-command"] = "builtin:gemini";
    if (args.options.deepseek)
        args.options["agent-command"] = "builtin:deepseek";
    // -dir / --dir / -d is a second name for --repo; an explicit --repo wins
    // (src/cli/command-surface.ts:65).
    if (!args.options.repo && args.options.dir)
        args.options.repo = args.options.dir;
    // Presentation flags set env vars before any agent spawn
    // (src/cli/command-surface.ts:73-75).
    if (args.options.verbose)
        process.env.CW_VERBOSE = "1";
    if (args.options["no-color"])
        process.env.CW_NO_COLOR = "1";
    if (args.options.full)
        process.env.CW_OUTPUT = "full";
    // --quiet is a documented CLI spelling of the existing CW_DRIVE_PROGRESS=0
    // env var (shell/drive.ts's emitProgress) — it only silences the terse
    // "[drive] " progress lines, not the end-of-run summary or any other
    // Rule of Silence gate point (SPEC/reporting-ux.md's 3 gate points are
    // each independent; --verbose/--full don't touch them either). It also
    // does NOT reach two OTHER TTY-gated narration channels a user might
    // reasonably expect it to quiet: live raw agent stderr streaming
    // (shell/execution-backend/agent.ts's shouldStreamAgentStderr, gated by
    // CW_AGENT_STREAM/CW_NO_STREAM/isTTY) and the local backend's
    // "● Running…"/"✓ Done" lines (shell/execution-backend/local.ts, gated
    // by isTTY with no env override at all). Folding those in is a larger,
    // separate change — this flag's help text says "not agent output" on
    // purpose so the scope is clear without reading this comment.
    if (args.options.quiet)
        process.env.CW_DRIVE_PROGRESS = "0";
    // `cw <verb> --help` / `-h` -> per-command help
    // (src/cli/command-surface.ts:80-83).
    if ((args.options.help || args.options.h) && args.command && !args.command.startsWith("-")) {
        process.stdout.write((0, help_1.formatCommandHelp)(args.command, parseargv_2.suggestCommand));
        return;
    }
    // Bare -q / --question -> redirect to quickstart (src/cli/command-surface.ts:88-93).
    if (args.command === "-q" || args.command === "--question") {
        if (!args.options.question && args.positionals[0])
            args.options.question = args.positionals.shift();
        args.command = "quickstart";
    }
    else if (!args.command && typeof args.options.question === "string") {
        args.command = "quickstart";
    }
    await (0, dispatch_1.dispatch)(args);
}
/** Broken pipe (`cw ... --json | head`): when the reader at the other end
 *  of a pipe goes away early, a write to stdout gives an async 'error'
 *  event that no promise .catch can see — without a listener node comes
 *  down hard with a stack trace. Raw writes are all over the CLI (help,
 *  version, printJson, human text), so ONE process-level listener here
 *  covers every write point: EPIPE says "the reader has all it needs",
 *  so stop quietly with code 0. Any other stream error is thrown again
 *  and still comes up as an uncaughtException, same as before. */
function exitQuietOnEpipe(stream) {
    stream.on("error", (error) => {
        if (error && error.code === "EPIPE")
            process.exit(0);
        throw error;
    });
}
/** Top-level run wrapper matching src/cli.ts's catch shape byte-for-byte:
 *  `cw: <message>\n` then, only when a hint matches, `  Try: <hint>\n` on
 *  stderr; `process.exitCode = 1` (never a hard `process.exit`). */
function main(argv = process.argv.slice(2)) {
    exitQuietOnEpipe(process.stdout);
    exitQuietOnEpipe(process.stderr);
    return runCli(argv).catch((error) => {
        // On some platforms a broken-pipe write throws EPIPE in the write call
        // itself (not as a stream 'error' event) — same broken pipe, same quiet
        // exit 0, never a `cw: write EPIPE` line.
        if (error?.code === "EPIPE")
            return;
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`${(0, term_1.bold)("cw:", process.stderr)} ${(0, term_1.red)(message, process.stderr)}\n`);
        const hint = recoveryHint(message);
        if (hint)
            process.stderr.write(`  ${(0, term_1.dim)("Try:", process.stderr)} ${hint}\n`);
        process.exitCode = 1;
    });
}
