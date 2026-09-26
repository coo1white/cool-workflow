"use strict";

// bench/perf-count-hook.js — a `node --require` preload that counts the
// costly things one CW process does, for scripts/bench/perf-counts.js (its
// one consumer; see the perf-ratchets intent). It changes no behaviour: every
// wrapped function calls the real one with the same arguments and returns
// its result. On exit it writes the counts as JSON to CW_PERF_COUNT_OUT.
//
// Counts are of THIS process only (a child such as an agent is not counted),
// and none depends on a byte size or a path length, so the same code gives
// the same numbers on every run and every machine.

const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const childProcess = require("node:child_process");

const OUT = process.env.CW_PERF_COUNT_OUT || "";
const PLUGIN_ROOT = path.resolve(__dirname, "..", "..");

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

const loadJs = Module._extensions[".js"];
Module._extensions[".js"] = function (module, filename) {
  if (filename.startsWith(PLUGIN_ROOT + path.sep) && !filename.includes(`${path.sep}node_modules${path.sep}`)) counts.modules++;
  return loadJs.call(this, module, filename);
};

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

process.on("exit", () => {
  if (OUT) fs.writeFileSync(OUT, `${stringify(counts)}\n`);
});
