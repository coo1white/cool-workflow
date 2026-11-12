// spawn-argv — spawnSync for the build and release scripts, with Windows'
// .cmd shims handled. A drop-in for node:child_process spawnSync.
//
// Node will not start npm.cmd, or a gh/npm/agent .cmd shim, with no shell
// (CVE-2024-27980), so on Windows `spawnSync("npm", ...)` failed at once and
// every script step that runs npm (build, version:sync, bump:version) or gh
// was reported as failed. On win32 the product's own resolver
// (dist/core/util/cli-args.js spawnArgv: PATH + PATHEXT, and an npm-style
// shim runs as `node <script>`) picks the argv. Off Windows, for a call with
// no argv array, or with `shell` set, the call is passed on unchanged.
// dist/ can be missing (a fresh clone, a test's fixture tree): then `npm`
// alone is found beside node, where Node's Windows installer puts it.

import { spawnSync as nodeSpawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Loaded on Windows only, once, before any script step runs.
const resolver = process.platform === "win32"
  ? await import(pathToFileURL(path.join(import.meta.dirname, "..", "dist", "core", "util", "cli-args.js")).href).then((m) => m.spawnArgv || null, () => null)
  : null;

function isFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/** The argv to start on `platform` (default this host); `resolve` is the
 *  product's spawnArgv (default: the one loaded on Windows). */
export function scriptArgv(binary, args, env = process.env, platform = process.platform, resolve = resolver) {
  if (platform !== "win32") return { binary, args };
  if (resolve) return resolve(binary, args, env, platform, process.execPath, { isFile, readText: (file) => fs.readFileSync(file, "utf8") });
  const npmCli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  if (binary === "npm" && isFile(npmCli)) return { binary: process.execPath, args: [npmCli, ...args] };
  return { binary, args };
}

export function spawnSync(binary, args, options) {
  if (process.platform !== "win32" || !Array.isArray(args) || (options && options.shell)) return nodeSpawnSync(binary, args, options);
  const start = scriptArgv(binary, args, (options && options.env) || process.env);
  return nodeSpawnSync(start.binary, start.args, options);
}
