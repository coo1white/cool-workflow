// bench/perf-count-hook.mjs — a `node --import` preload that counts the
// costly things one CW process does, for scripts/bench/perf-counts.mjs (its
// one consumer; see the perf-ratchets intent). It changes no behaviour: every
// wrapped function calls the real one with the same arguments and returns
// its result. On exit it writes the counts as JSON to CW_PERF_COUNT_OUT.
//
// Counts are of THIS process only (a child such as an agent is not counted),
// and none depends on a byte size or a path length, so the same code gives
// the same numbers on every run and every machine.

import fs from "node:fs";
import path from "node:path";
import Module from "node:module";
import childProcess from "node:child_process";
import { fileURLToPath } from "node:url";

const OUT = process.env.CW_PERF_COUNT_OUT || "";
const PLUGIN_ROOT = path.resolve(import.meta.dirname, "..", "..");

const counts = {
  modules: 0,
  stateReads: 0,
  stateRoundTrips: 0,
  fsyncs: 0,
  renames: 0,
  gitProcesses: 0,
};

const isStateFile = (file) => typeof file === "string" && /[\\/]\.cw[\\/]runs[\\/][^\\/]+[\\/]state\.json$/.test(file);

// A whole run state: the one object shape that carries all three keys.
const isRunState = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value) && "workflow" in value && "paths" in value && "nodes" in value;

// dist/ is ES modules, and an ES module graph never goes through
// Module._extensions, so a module is counted at the load step of
// module.registerHooks (Node 22.15+), which sees require() and import alike.
// On an older Node the count cannot be made, so it fails closed.
if (typeof Module.registerHooks !== "function") {
  throw new Error(`perf-count-hook: module.registerHooks is missing on Node ${process.versions.node}; the module count needs Node 22.15 or later`);
}
Module.registerHooks({
  load(url, context, nextLoad) {
    if (url.startsWith("file:")) {
      const filename = fileURLToPath(url);
      if (filename.endsWith(".js") && filename.startsWith(PLUGIN_ROOT + path.sep) && !filename.includes(`${path.sep}node_modules${path.sep}`)) counts.modules++;
    }
    return nextLoad(url, context);
  },
});

const readFileSync = fs.readFileSync;
fs.readFileSync = function (file, ...rest) {
  if (isStateFile(file)) counts.stateReads++;
  return readFileSync.call(this, file, ...rest);
};

const fsyncSync = fs.fsyncSync;
fs.fsyncSync = function (...args) {
  counts.fsyncs++;
  return fsyncSync.apply(this, args);
};

const renameSync = fs.renameSync;
fs.renameSync = function (...args) {
  counts.renames++;
  return renameSync.apply(this, args);
};

const parse = JSON.parse;
JSON.parse = function (...args) {
  const value = parse.apply(this, args);
  if (isRunState(value)) counts.stateRoundTrips++;
  return value;
};

const stringify = JSON.stringify;
JSON.stringify = function (value, ...rest) {
  if (isRunState(value)) counts.stateRoundTrips++;
  return stringify.call(this, value, ...rest);
};

for (const name of ["spawn", "spawnSync", "execFile", "execFileSync"]) {
  const real = childProcess[name];
  childProcess[name] = function (command, ...rest) {
    if (path.basename(String(command)).replace(/\.exe$/i, "") === "git") counts.gitProcesses++;
    return real.call(this, command, ...rest);
  };
}

// An ES module's named imports of a builtin are a copy made at its first
// import; this makes them see the counting wrappers above.
Module.syncBuiltinESMExports();

process.on("exit", () => {
  if (OUT) fs.writeFileSync(OUT, `${stringify(counts)}\n`);
});
