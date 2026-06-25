#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const srcEntrypoint = path.join(pluginRoot, "src", "cli.ts");
const srcCommandSurface = path.join(pluginRoot, "src", "cli", "command-surface.ts");

const entrypoint = fs.readFileSync(srcEntrypoint, "utf8");
const entrypointLines = entrypoint.trimEnd().split(/\r?\n/);

assert.ok(fs.existsSync(srcCommandSurface), "CLI command handling must live under src/cli/");
assert.ok(entrypointLines.length <= 80, `src/cli.ts must stay a thin entrypoint, got ${entrypointLines.length} lines`);
assert.match(entrypoint, /from "\.\/cli\/command-surface"/, "src/cli.ts must delegate to the command surface module");
assert.doesNotMatch(entrypoint, /\bswitch\s*\(/, "src/cli.ts must not own the command dispatcher");
assert.doesNotMatch(entrypoint, /case\s+"[^"]+":/, "src/cli.ts must not own command cases");

const commandSurface = fs.readFileSync(srcCommandSurface, "utf8");
assert.match(commandSurface, /export async function runCli\b/, "command surface must export runCli");
assert.match(commandSurface, /parseArgv\(/, "command surface must preserve parseArgv-based CLI parsing");

// The operational families (feedback/metrics/migration/sandbox/backend/contract)
// were carved into src/cli/handlers/operational.ts. Each verb must now be a thin
// delegation in the surface, not an inline switch — a guard against regressing the
// carve back into the god-dispatch.
// "candidate" (cycle 8) was the LAST inline command-family carved out, into
// src/cli/handlers/candidate.ts, so it joins the delegation-guard loop.
for (const v of ["feedback", "metrics", "migration", "sandbox", "backend", "contract", "candidate"]) {
  assert.match(commandSurface, new RegExp('case "' + v + '":\\s*\\n\\s*handle\\w+\\(args, runner\\);'), v + " delegates");
}
// The pruned imports must stay gone: ../observability had no surviving user, and
// runRegistryFor's last command-surface caller (metrics summary) moved with it.
assert.doesNotMatch(commandSurface, /from "\.\.\/observability"/, "observability import removed");
assert.doesNotMatch(commandSurface, /\brunRegistryFor\b/, "runRegistryFor no longer imported in command-surface");
// formatCandidateSummary moved with the candidate family — `candidate summary`
// was its last command-surface user, so its import must be gone from the surface.
assert.doesNotMatch(commandSurface, /\bformatCandidateSummary\b/, "formatCandidateSummary moved to handlers/candidate.ts");

process.stdout.write(`cli-command-surface-smoke: ok (${entrypointLines.length} entrypoint lines)\n`);
