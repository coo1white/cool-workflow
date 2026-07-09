"use strict";
// wiring/capability-table/basics.ts — MILESTONE 2's CLI bindings (version,
// list, status, sandbox.list). Split out of core/capability-table.ts,
// byte-for-byte (extracted with sed, not retyped).
Object.defineProperty(exports, "__esModule", { value: true });
const registry_core_1 = require("./registry-core");
// ---------------------------------------------------------------------
// CLI bindings wired at THIS milestone (version, list, status,
// sandbox.list). `version` is cli-only per SPEC/mcp.md's declared
// one-surface list (`help` is handled directly by cli/entry.ts's
// top-level flag redirect, same as milestone 1 — it is not itself a
// dispatchable command row); `list`/`status`/`sandbox.list` reuse the mcp
// row's capability id and get a cli binding layered on top. Every handler
// below returns a `CliHandlerResult`; core/ never touches process.stdout
// or process.exitCode directly (see docs/rebuild/PLAN.md's core/shell split) —
// cli/dispatch.ts's generic executor performs the actual write.
// ---------------------------------------------------------------------
const version_1 = require("../../core/version");
const help_1 = require("../../core/format/help");
// This whole module is required unconditionally at startup for EVERY
// command (see wiring/capability-table/index.ts) — a top-level import of
// `shell/workflow-app-loader` here means even `cw --version` pays its
// load cost, though only `search`'s handler ever calls it.
function loadWorkflowAppLoader() {
    return require("../../shell/workflow-app-loader");
}
(0, registry_core_1.addCliOnlyCapability)("version", "Print the current cool-workflow version.", {
    path: ["version"],
    jsonMode: "default",
    handler: () => ({ text: `${version_1.CURRENT_COOL_WORKFLOW_VERSION}\n` }),
}, "version is a local, no-run-state print; the old build never gave it an MCP peer.");
/** `cw search <keyword>` — filters the SAME real app discovery `cw list`
 *  shows, by id/title/summary (byte-behavior port of cli/dispatch.ts's
 *  milestone-1 carry-over `search` arm, moved here so the dispatchLegacy
 *  switch shrinks per its file header's rule). The old v0.1.98 CLI DID
 *  have its own `cw help search` row (`docs/rebuild/SPEC/cli-help/
 *  search.txt`: "cw search  Search workflow apps by keyword (title,
 *  description, id)."); `hiddenFromHelp` here was a rebuild regression
 *  that hid it, not a preserved old-build quirk — removed. */
(0, registry_core_1.addCliOnlyCapability)("search", "Search bundled workflows by id/title/summary keyword.", {
    path: ["search"],
    jsonMode: "flag",
    handler: (args) => {
        const keyword = args.positionals.join(" ");
        if (!keyword.trim()) {
            throw new Error('Missing search keyword.\n  Tip: cw search architecture to find workflows about architecture.');
        }
        const lower = keyword.toLowerCase();
        const results = loadWorkflowAppLoader().listWorkflowApps()
            .filter((a) => String(a.title).toLowerCase().includes(lower) ||
            String(a.summary).toLowerCase().includes(lower) ||
            String(a.id).toLowerCase().includes(lower))
            .map((a) => ({ id: String(a.id), title: String(a.title), summary: String(a.summary) }));
        return { json: results, text: (0, help_1.formatSearchResults)(keyword, results) };
    },
}, "CLI-only discovery helper over the same real app data cw list shows; no MCP client needs a free-text search tool alongside cw_list's structured output.");
(0, registry_core_1.attachCliBinding)("list", {
    path: ["list"],
    jsonMode: "default",
    handler: () => ({ json: (0, registry_core_1.listBundledWorkflows)() }),
});
(0, registry_core_1.attachCliBinding)("status", {
    path: ["status"],
    jsonMode: "flag",
    handler: (args) => ({ json: (0, registry_core_1.statusPayload)(args.positionals[0]) }),
});
(0, registry_core_1.attachCliBinding)("sandbox.list", {
    path: ["sandbox", "list"],
    jsonMode: "default",
    handler: () => ({ json: (0, registry_core_1.listBundledSandboxProfiles)() }),
});
