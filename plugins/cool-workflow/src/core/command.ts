// core/command.ts — the shape of one row in the CLI's command table
// (wiring/commands.ts). Pure types.

export interface CommandArgs {
  positionals: string[];
  options: Record<string, unknown>;
}

export interface CommandResult {
  text?: string;
  json?: unknown;
  exitCode?: number;
}

/** "default": prints JSON (a TTY gets humanRender when the row has one).
 *  "flag": prints text, or JSON under --json. "human": text only. */
export type JsonMode = "default" | "flag" | "human";

export interface CommandRow {
  /** The `cw <path...>` tokens; one or two long. */
  path: string[];
  summary: string;
  jsonMode: JsonMode;
  handler: (args: CommandArgs) => CommandResult | Promise<CommandResult>;
  humanRender?: (json: unknown) => string;
  /** Shown in `cw help <verb>` in place of `path`. */
  helpPath?: string[];
  flags?: Array<{ name: string; summary: string }>;
  hidden?: boolean;
}
