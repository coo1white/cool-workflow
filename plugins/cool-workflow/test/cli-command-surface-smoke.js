#!/usr/bin/env node
"use strict";

// v2 REWRITE (cutover audit) — outcome NO-EQUIVALENT, adapted to the v2
// equivalent where one exists.
//
// The old build factored the CLI into a `src/cli/command-surface.ts`
// module that owned a `runCli` with a big `switch (args.command)` and
// delegated each operational verb into `src/cli/handlers/*.ts` via
// `case "x": handleX(args, runner);`. The whole point of this smoke was a
// GUARD against regressing that carve-out back into one god-dispatch, plus
// a check that some dead imports stayed pruned from that surface file.
//
// v2 has NO `command-surface.ts` and NO `handlers/` dir. It reaches the
// SAME anti-god-dispatch goal a different (stronger) way:
//   - src/cli.ts is still the thin binary entrypoint, but it delegates to
//     src/cli/entry.ts (which exports `runCli` and does the parseArgv-based
//     parsing), not to a command-surface module.
//   - Verbs are rows in the CAPABILITY TABLE (core/capability-table.ts),
//     dispatched by the generic executor in src/cli/dispatch.ts. They are
//     NOT inline arms of any command switch. dispatch.ts keeps only a small
//     `dispatchLegacy` switch of milestone carry-over placeholders that is
//     documented as never hand-extended again.
// So every assertion below is repointed to the v2 module that carries the
// same intent.
//
// NO-EQUIVALENT (dropped, not weakened): the three "pruned import" guards
// (`../observability`, `runRegistryFor`, `formatCandidateSummary` gone from
// command-surface.ts) were dead-export guards tied to that one old file.
// v2 has no such file; there is no equivalent surface to guard. See the
// audit report for the gap note.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const srcEntrypoint = path.join(pluginRoot, "src", "cli.ts");
// v2: CLI command handling lives in cli/entry.ts (runCli + flag redirects)
// and cli/dispatch.ts (the generic capability-table executor), replacing
// the old cli/command-surface.ts.
const srcEntry = path.join(pluginRoot, "src", "cli", "entry.ts");
const srcDispatch = path.join(pluginRoot, "src", "cli", "dispatch.ts");

const entrypoint = fs.readFileSync(srcEntrypoint, "utf8");
const entrypointLines = entrypoint.trimEnd().split(/\r?\n/);

assert.ok(fs.existsSync(srcEntry), "CLI command handling must live under src/cli/ (entry.ts)");
assert.ok(fs.existsSync(srcDispatch), "CLI dispatch must live under src/cli/ (dispatch.ts)");
assert.ok(entrypointLines.length <= 80, `src/cli.ts must stay a thin entrypoint, got ${entrypointLines.length} lines`);
// v2: the thin entrypoint delegates to ./cli/entry (was ./cli/command-surface).
assert.match(entrypoint, /from "\.\/cli\/entry"/, "src/cli.ts must delegate to the cli/entry module");
assert.doesNotMatch(entrypoint, /\bswitch\s*\(/, "src/cli.ts must not own the command dispatcher");
assert.doesNotMatch(entrypoint, /case\s+"[^"]+":/, "src/cli.ts must not own command cases");

const entry = fs.readFileSync(srcEntry, "utf8");
assert.match(entry, /export async function runCli\b/, "cli/entry.ts must export runCli");
assert.match(entry, /parseArgv\(/, "cli/entry.ts must preserve parseArgv-based CLI parsing");

// The operational families (feedback/metrics/migration/sandbox/backend/
// contract/candidate) must NOT live as inline arms of a command switch —
// the same anti-god-dispatch guard the old smoke enforced. In v2 they are
// rows in the CAPABILITY TABLE, keyed by a `path: ["<verb>", ...]`, and
// dispatched generically by cli/dispatch.ts. So the v2-faithful form of
// "each verb delegates" is: each verb has at least one capability-table
// row AND is not a real god-dispatch handler.
//
// Checked against the LIVE, compiled REGISTRY (not source text of one
// file): the table's wiring is split across wiring/capability-table/*.ts
// domain slices, so no single source file's raw text names every verb —
// the compiled REGISTRY is the one place they are all guaranteed to show
// up, regardless of which slice a verb's row happens to live in.
const dispatch = fs.readFileSync(srcDispatch, "utf8");
const { REGISTRY } = require(path.join(pluginRoot, "dist", "core", "capability-table.js"));
for (const v of ["feedback", "metrics", "migration", "sandbox", "backend", "contract", "candidate"]) {
  assert.ok(
    REGISTRY.some((row) => row.cli && row.cli.path[0] === v),
    v + " is a capability-table row (not an inline god-dispatch arm)"
  );
}
// The legacy carry-over switch in dispatch.ts is documented (file header)
// as never hand-extended again; only milestone placeholders remain. The
// only one of the seven still present there is `migration`, and only as a
// missing-target refusal stub (milestone 3/4 carry-over), not a real
// operational handler. All the rest must be fully off the switch.
for (const v of ["feedback", "metrics", "sandbox", "backend", "contract", "candidate"]) {
  assert.doesNotMatch(
    dispatch,
    new RegExp('case "' + v + '":'),
    v + " must not be an inline arm of the legacy dispatch switch"
  );
}

process.stdout.write(`cli-command-surface-smoke: ok (${entrypointLines.length} entrypoint lines)\n`);
