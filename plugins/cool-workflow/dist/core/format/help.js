// core/format/help.ts — the `cw help` front page and `cw help <verb>`.
// Pure text. Command rows use a 2-space indent; notes use 4 spaces.
/** The "More commands" line, in this order. */
export const MORE_COMMANDS_TOKENS = ["report", "check"];
export function formatHelp() {
    const lines = [
        "Cool Workflow",
        "",
        '  -q "question" [-<vendor>]                 Ask a question, get a report',
        "  version                                   Show version",
        "",
        "Flags",
        "  -q, --question TEXT    The task or question to answer",
        "  -r, --repo PATH        Target repository path (default: .)",
        "  -d, --dir PATH         Project folder to review (alias for --repo)",
        "  --verbose              Show full agent narration live (default: compact)",
        "  --no-color             Disable ANSI color (also honors NO_COLOR / FORCE_COLOR)",
        "  --json                 Print JSON for commands that support it",
        "  --quiet                Suppress [drive] progress lines (not agent output)",
        "  --resume --run <id>    Continue an interrupted run to completion",
        "",
        "Agents",
        "  -claude                Use Claude agent",
        "  -codex                 Use Codex agent",
        "  -gemini                Use Gemini (via opencode)",
        "  -opencode              Use OpenCode agent",
        "  -deepseek              Use DeepSeek (via opencode)",
        "  -muse                  Use Muse Code agent",
        "  -copilot               Use GitHub Copilot CLI agent",
        "  -antigravity           Use Antigravity agent",
        "  -grok                  Use Grok agent",
        "",
        "More commands",
        `  ${MORE_COMMANDS_TOKENS.join("|")}`,
        "",
        "    Run  cw help <command>  for one command's subcommands and descriptions.",
    ];
    return `${lines.join("\n")}\n`;
}
/** `cw help <verb>`: the verb's rows sorted and padded, then any flags. An
 *  unknown verb gets soft text, never a throw. */
export function formatCommandHelp(verb, suggestCommand, commands) {
    const rows = commands
        .filter((row) => row.path[0] === verb && !row.hidden)
        .map((row) => ({ command: `cw ${(row.helpPath ?? row.path).join(" ")}`, summary: row.summary, flags: row.flags }))
        .sort((a, b) => (a.command < b.command ? -1 : a.command > b.command ? 1 : 0));
    if (!rows.length) {
        const hint = suggestCommand(verb);
        return `${[`Unknown command: ${verb}`, ...(hint ? [`  Did you mean:  cw ${hint}`] : []), "  Try:  cw help   (list all commands)"].join("\n")}\n`;
    }
    const width = Math.min(40, Math.max(...rows.map((row) => row.command.length)));
    const lines = [`cw ${verb}`, "", ...rows.map((row) => `  ${row.command.padEnd(width, " ")}  ${row.summary}`)];
    const flagged = rows.filter((row) => row.flags && row.flags.length);
    for (const row of flagged) {
        const flagWidth = Math.min(40, Math.max(...row.flags.map((flag) => flag.name.length)));
        lines.push("", flagged.length === 1 ? "    Flags" : `    Flags (${row.command})`);
        for (const flag of row.flags)
            lines.push(`      ${flag.name.padEnd(flagWidth, " ")}  ${flag.summary}`);
    }
    return `${lines.join("\n")}\n`;
}
