#!/usr/bin/env node
// local-child-env-windows — the env CW gives a child keeps what a Windows
// program needs. With PATH and HOME only, a child on Windows had no
// SystemRoot (DNS and crypto can fail), no TEMP (node's os.tmpdir() is
// "undefined\temp") and no USERPROFILE/APPDATA (a vendor CLI cannot find its
// login). A copied Windows env names PATH as `Path`; that must still pass.
// POSIX is unchanged: PATH and HOME only.

import assert from "node:assert/strict";
import { buildChildEnv, CW_NEVER_FORWARD_ENV, WINDOWS_SYSTEM_ENV } from "../../../dist/shell/execution-backend/local.js";

const winBase = {
  Path: "C:\\Windows\\system32;C:\\nodejs",
  SystemRoot: "C:\\Windows",
  windir: "C:\\Windows",
  USERPROFILE: "C:\\Users\\u",
  APPDATA: "C:\\Users\\u\\AppData\\Roaming",
  LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local",
  TEMP: "C:\\Users\\u\\AppData\\Local\\Temp",
  TMP: "C:\\Users\\u\\AppData\\Local\\Temp",
  PATHEXT: ".COM;.EXE;.BAT;.CMD",
  SECRET_THING: "nope",
  CW_CHECK_PRIVKEY: "C:\\keys\\check.key",
};

{
  const env = buildChildEnv(winBase, "win32");
  assert.equal(env.PATH, winBase.Path, "a `Path` key still gives the child its PATH");
  for (const name of ["SystemRoot", "windir", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP", "PATHEXT"]) {
    assert.equal(env[name], winBase[name], `${name} reaches the child on win32`);
  }
  assert.equal(env.SECRET_THING, undefined, "an unrelated var still stays out");
  assert.equal(env.CW_CHECK_PRIVKEY, undefined, "a CW secret never reaches the child");
  for (const name of WINDOWS_SYSTEM_ENV) assert.ok(!CW_NEVER_FORWARD_ENV.has(name));
}

{
  const env = buildChildEnv({ ...winBase, PATH: "/usr/bin", HOME: "/home/u" }, "linux");
  assert.deepEqual(Object.keys(env).sort(), ["HOME", "PATH"], "POSIX: PATH and HOME only, as before");
}

process.stdout.write("local-child-env-windows.test: ok\n");
