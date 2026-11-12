#!/usr/bin/env node
// cli-args-spawnargv — the argv CW hands to spawn() with no shell. On
// Windows `npm`, `claude`, `codex` and most agent CLIs are npm .cmd shims,
// and Node refuses to start a .cmd/.bat without a shell (CVE-2024-27980),
// so `cw check -- npm test` and every builtin agent failed there with
// ENOENT/EINVAL. spawnArgv reads the shim and runs the script it names with
// node (or the .exe it names). Driven here with platform "win32" and a fake
// file system, so the Windows branch is proven on any host.

import assert from "node:assert/strict";
import { cmdShimTarget, findProgram, spawnArgv } from "../../../dist/core/util/cli-args.js";
import { hostSpawnArgv } from "../../../dist/shell/fs-atomic.js";

const NODE = "C:\\nodejs\\node.exe";
// Windows file names match in any case (npm.CMD is npm.cmd).
function io(files) {
  const key = (file) => Object.keys(files).find((k) => k.toLowerCase() === file.toLowerCase());
  return {
    isFile: (file) => key(file) !== undefined,
    readText: (file) => {
      if (key(file) === undefined) throw new Error(`ENOENT ${file}`);
      return files[key(file)];
    },
  };
}

// npm.cmd as Node's Windows installer ships it.
const NPM_CMD = [
  ":: Created by npm, please don't edit manually.",
  "@ECHO OFF",
  "SETLOCAL",
  'SET "NODE_EXE=%~dp0\\node.exe"',
  'IF NOT EXIST "%NODE_EXE%" (',
  '  SET "NODE_EXE=node"',
  ")",
  'SET "NPM_PREFIX_JS=%~dp0\\node_modules\\npm\\bin\\npm-prefix.js"',
  'SET "NPM_CLI_JS=%~dp0\\node_modules\\npm\\bin\\npm-cli.js"',
  'FOR /F "delims=" %%F IN (\'CALL "%NODE_EXE%" "%NPM_PREFIX_JS%"\') DO (',
  '  SET "NPM_PREFIX_NPM_CLI_JS=%%F\\node_modules\\npm\\bin\\npm-cli.js"',
  ")",
  'IF EXIST "%NPM_PREFIX_NPM_CLI_JS%" (',
  '  SET "NPM_CLI_JS=%NPM_PREFIX_NPM_CLI_JS%"',
  ")",
  '"%NODE_EXE%" "%NPM_CLI_JS%" %*',
].join("\r\n");

// A global bin as npm's cmd-shim writes it (claude.cmd, codex.cmd, ...).
const SHIM = (rel) => [
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
  `endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\${rel}" %*`,
].join("\r\n");

const files = {
  "C:\\nodejs\\node.exe": "",
  "C:\\nodejs\\npm.cmd": NPM_CMD,
  "C:\\nodejs\\node_modules\\npm\\bin\\npm-cli.js": "",
  "C:\\nodejs\\node_modules\\npm\\bin\\npm-prefix.js": "",
  "C:\\npm\\claude.cmd": SHIM("node_modules\\@anthropic-ai\\claude-code\\cli.js"),
  "C:\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js": "",
  "C:\\npm\\tool.cmd": [
    "@ECHO off",
    '"%~dp0\\node_modules\\tool\\bin\\tool.exe"   %*',
  ].join("\r\n"),
  "C:\\npm\\node_modules\\tool\\bin\\tool.exe": "",
  "C:\\npm\\plain.bat": "@echo hello %*\r\n",
  "C:\\git\\git.exe": "",
  "C:\\stub\\gh.cmd": SHIM("gh.js"),
  "C:\\stub\\gh.js": "",
};
const env = { PATH: "C:\\nodejs;C:\\npm;C:\\git", PATHEXT: ".COM;.EXE;.BAT;.CMD" };
const win = (binary, args, e = env) => spawnArgv(binary, args, e, "win32", NODE, io(files));

// npm.cmd -> node npm-cli.js (not npm-prefix.js, not node.exe).
assert.deepEqual(win("npm", ["test"]), { binary: NODE, args: ["C:\\nodejs\\node_modules\\npm\\bin\\npm-cli.js", "test"] });
assert.deepEqual(win("npm.cmd", ["test"]), win("npm", ["test"]), "a name that already has its suffix is tried as is");
// cmd-shim of a node CLI -> node <its script>, args kept in order.
assert.deepEqual(win("claude", ["-p", "--x"]), { binary: NODE, args: ["C:\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js", "-p", "--x"] });
// cmd-shim of a native binary -> that .exe.
assert.deepEqual(win("tool", ["a"]), { binary: "C:\\npm\\node_modules\\tool\\bin\\tool.exe", args: ["a"] });
// A real .exe on PATH -> its full path.
assert.deepEqual(win("git", ["status"]), { binary: "C:\\git\\git.EXE", args: ["status"] });
// A batch file that is no shim is given back as found: the spawn fails with its own error.
assert.deepEqual(win("plain", ["x"]), { binary: "C:\\npm\\plain.BAT", args: ["x"] });
// Not on PATH: as given (spawn reports ENOENT, as before).
assert.deepEqual(win("nope", ["x"]), { binary: "nope", args: ["x"] });
// A path with folders: the suffixes are tried on it.
assert.deepEqual(win("C:\\stub\\gh", ["api"]), { binary: NODE, args: ["C:\\stub\\gh.js", "api"] });
// A copied Windows env names the variable `Path`.
assert.deepEqual(win("npm", ["test"], { Path: "C:\\nodejs", PATHEXT: ".EXE;.CMD" }), { binary: NODE, args: ["C:\\nodejs\\node_modules\\npm\\bin\\npm-cli.js", "test"] });
assert.equal(findProgram("git", { Path: "C:\\git" }, "win32", io(files).isFile), "C:\\git\\git.EXE");
// An unreadable shim: as found.
assert.deepEqual(spawnArgv("npm", [], env, "win32", NODE, { isFile: io(files).isFile, readText: () => { throw new Error("EACCES"); } }), { binary: "C:\\nodejs\\npm.CMD", args: [] });
// The parser alone: a shim whose target is missing is no shim.
assert.equal(cmdShimTarget(SHIM("gone.js"), "C:\\npm\\gone.cmd", io(files).isFile), undefined);

// Off win32 nothing is looked up or changed.
for (const platform of ["linux", "darwin"]) {
  assert.deepEqual(spawnArgv("npm", ["test"], env, platform, NODE, io(files)), { binary: "npm", args: ["test"] });
}
if (process.platform !== "win32") assert.deepEqual(hostSpawnArgv("npm", ["test"], process.env), { binary: "npm", args: ["test"] });

process.stdout.write("cli-args-spawnargv: ok\n");
