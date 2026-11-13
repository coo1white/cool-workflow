#!/usr/bin/env node
// auto-receipt-hook.mjs — PreToolUse hook for the Bash tool: a test run
// becomes a CW receipt by itself (docs/reference.md, "Test runs in Claude
// Code"). Reads the hook input JSON on stdin. When the command is one plain
// test command (`npm test`, `pytest -x`, `go test ./...`, ...), it prints
// Claude Code's PreToolUse JSON with `updatedInput`, which runs
//   cw check --tee -- <the same command>
// instead. `--tee` passes the command's stdout, stderr and exit code through
// unchanged and adds one receipt line on stderr. Anything else: exit 0, no
// output, no change.
//
// It never decides a permission: no `permissionDecision` is printed, so
// Claude Code runs its normal permission check on the changed command
// (https://code.claude.com/docs/en/hooks, "PreToolUse decision control").
//
// Off: CW_AUTO_RECEIPT=off. Skipped when `cw` is not on PATH (the rewrite
// names `cw`, the command the user and their permission rules know; a path
// into the plugin's versioned cache would change on every update). On
// Windows `cw` is found as cw.cmd (or another PATHEXT name), and `cw check`
// starts npm.cmd and the like with no shell.
//
// The command string is reused only when it is ONE simple command: no
// pipe, `&`, `;`, redirect, subshell, backtick, `$` or newline. Then the
// shell splits `cw check --tee -- <cmd>` into the same words as `<cmd>`,
// after three fixed words. Nothing from the input is quoted or built into
// new syntax.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The first words of a test command, then a space or the end.
const TEST_RE = /^(?:(?:npm|pnpm|yarn|bun) (?:test|run test[\w:.-]*)|npx (?:vitest|jest)|pytest|go test|cargo test|make test)(?:\s|$)/;
// Shell syntax that makes more than one simple command, or changes where
// output goes. `$` covers `$(` and variables; a variable would still split
// the same way, but no test command needs one here.
const COMPOUND_RE = /[|&;<>()`$\n\r\\]/;

export function rewrite(input, env = process.env, platform = process.platform) {
  if (/^(?:off|0|false|no)$/i.test(String(env.CW_AUTO_RECEIPT || ""))) return null;
  const toolInput = input && input.tool_name === "Bash" && input.tool_input;
  if (!toolInput || typeof toolInput.command !== "string") return null;
  const command = toolInput.command.trim();
  if (!TEST_RE.test(command) || COMPOUND_RE.test(command)) return null;
  if (!onPath("cw", env, platform)) return null;
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      updatedInput: { ...toolInput, command: `cw check --tee -- ${command}` },
    },
  };
}

// Windows finds a program by PATHEXT (cw.cmd from an npm install), and its
// PATH is split on ";".
function onPath(name, env, platform) {
  const win = platform === "win32";
  const exts = win ? String(env.PATHEXT || ".COM;.EXE;.BAT;.CMD").toLowerCase().split(";").filter(Boolean) : [""];
  for (const dir of String(env.PATH || env.Path || "").split(win ? ";" : ":")) {
    if (!dir) continue;
    for (const ext of exts) {
      try {
        fs.accessSync(path.join(dir, name + ext), win ? fs.constants.F_OK : fs.constants.X_OK);
        return true;
      } catch {}
    }
  }
  return false;
}

function isMain() {
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

// Fail open: a hook fault must never stop a Bash call; the command then runs
// as it was, with no receipt. (Imported by its smoke, it reads no stdin.)
if (isMain()) {
  let stdin = "";
  process.stdin.on("data", (d) => {
    stdin += d;
  });
  process.stdin.on("end", () => {
    try {
      const out = rewrite(JSON.parse(stdin));
      if (out) process.stdout.write(`${JSON.stringify(out)}\n`);
    } catch {}
    process.exit(0);
  });
}
