// test/helpers/program.mjs — a fake program on PATH (a vendor CLI, gh, a
// reviewer) that starts on every OS.
//
// Consumers: every test that imports it (grep for helpers/program.mjs).
//
// writeProgram(dir, name, source, { platform }) writes <dir>/<name>: the node
// `source` behind a `#!/usr/bin/env node` line (one already there is kept),
// mode 755, run as CommonJS. Windows starts no file without a suffix, so on
// win32 it also writes <dir>/<name>.cmd, the same npm-style shim npm writes
// for a global CLI; CW's spawnArgv (src/core/util/cli-args.ts) and the
// release scripts start that shim as `node <dir>/<name>`, as they do a real
// npm-installed claude.cmd. Gives back <dir>/<name>.
// cmdShim(target) is that shim's text, for a target path relative to it.

import fs from "node:fs";
import path from "node:path";

export function cmdShim(target) {
  return [
    "@ECHO off",
    "GOTO start",
    ":find_dp0",
    "SET dp0=%~dp0",
    "EXIT /b",
    ":start",
    "SETLOCAL",
    "CALL :find_dp0",
    "",
    'IF EXIST "%dp0%\\node.exe" (',
    '  SET "_prog=%dp0%\\node.exe"',
    ") ELSE (",
    '  SET "_prog=node"',
    "  SET PATHEXT=%PATHEXT:;.JS;=;%",
    ")",
    "",
    `endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\${target}" %*`,
    "",
  ].join("\r\n");
}

export function writeProgram(dir, name, source, { platform = process.platform } = {}) {
  const file = path.join(dir, name);
  const body = source.startsWith("#!") ? source : `#!/usr/bin/env node\n${source}`;
  fs.writeFileSync(file, body, { encoding: "utf8", mode: 0o755 });
  fs.chmodSync(file, 0o755);
  if (platform === "win32") fs.writeFileSync(`${file}.cmd`, cmdShim(name), "utf8");
  return file;
}
