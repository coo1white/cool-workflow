#!/usr/bin/env node
// collate-stablecompare — pins stableCompare's ONE job: an ordering that is
// independent of the host's default locale, for anything whose order feeds
// a hash or a byte-pinned output.
//
// See the architecture-improvement plan's D-2 finding: a bare
// `a.localeCompare(b)` can order the SAME string set differently on two
// hosts with different LANG/LC_ALL, quietly moving a cache key or falsely
// flagging a replay regression. stableCompare pins the locale to "en".

const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { stableCompare } = require("../dist/core/util/collate");

// Basic ordering: ASCII case/punctuation-sensitive, task-id-shaped strings.
{
  const ids = ["map:web-client", "map:server-api", "map:db-security", "assess:domain"];
  const sorted = ids.slice().sort(stableCompare);
  assert.deepEqual(sorted, ["assess:domain", "map:db-security", "map:server-api", "map:web-client"]);
}

// stableCompare is a real comparator: symmetric sign, zero on equal inputs.
{
  assert.equal(stableCompare("a", "a"), 0);
  assert.ok(stableCompare("a", "b") < 0);
  assert.ok(stableCompare("b", "a") > 0);
}

// The whole point: stableCompare's result must NOT depend on the host's
// locale env, unlike a bare localeCompare(). ICU locale resolution happens
// at PROCESS STARTUP (mutating process.env.LANG mid-process has no effect —
// verified separately), so proving real divergence needs two separate child
// processes, one per locale.
const distCollatePath = path.join(__dirname, "..", "dist", "core", "util", "collate.js");
const EN_ENV = { LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8" };
const CZ_ENV = { LANG: "cs_CZ.UTF-8", LC_ALL: "cs_CZ.UTF-8" };

function sortInChildProcess(compareRequire, env) {
  const script = `const c=${compareRequire};console.log(JSON.stringify(["ch","h","i"].slice().sort(c)));`;
  const result = spawnSync(process.execPath, ["-e", script], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  assert.equal(result.status, 0, `child process failed: ${result.stderr}`);
  return JSON.parse(result.stdout.trim());
}

// Sanity check: a BARE localeCompare (no locale arg) really does diverge
// between these two locales — this is the bug being fixed, not a strawman.
{
  const underEn = sortInChildProcess("(a,b)=>a.localeCompare(b)", EN_ENV);
  const underCz = sortInChildProcess("(a,b)=>a.localeCompare(b)", CZ_ENV);
  assert.notDeepEqual(underCz, underEn, "sanity: a bare localeCompare DOES diverge between en_US and cs_CZ (the bug stableCompare prevents)");
}

// stableCompare gives the identical order in BOTH locales.
{
  const requireStableCompare = `require(${JSON.stringify(distCollatePath)}).stableCompare`;
  const underEn = sortInChildProcess(requireStableCompare, EN_ENV);
  const underCz = sortInChildProcess(requireStableCompare, CZ_ENV);
  assert.deepEqual(underCz, underEn, "stableCompare's order must not shift between host locales");
  assert.deepEqual(underCz, ["ch", "h", "i"], "stableCompare stays plain en-locale order even under cs_CZ.UTF-8");
}

process.stdout.write("collate-stablecompare: ok\n");
