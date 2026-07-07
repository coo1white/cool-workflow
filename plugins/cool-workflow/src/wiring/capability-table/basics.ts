// wiring/capability-table/basics.ts — MILESTONE 2's CLI bindings (version,
// list, status, sandbox.list). Split out of core/capability-table.ts,
// byte-for-byte (extracted with sed, not retyped).

import { attachCliBinding, addCliOnlyCapability, listBundledWorkflows, listBundledSandboxProfiles, statusPayload } from "./registry-core";

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

import { CURRENT_COOL_WORKFLOW_VERSION } from "../../core/version";

addCliOnlyCapability(
  "version",
  "Print the current cool-workflow version.",
  {
    path: ["version"],
    jsonMode: "default",
    handler: () => ({ text: `${CURRENT_COOL_WORKFLOW_VERSION}\n` }),
  },
  "version is a local, no-run-state print; the old build never gave it an MCP peer."
);

attachCliBinding("list", {
  path: ["list"],
  jsonMode: "default",
  handler: () => ({ json: listBundledWorkflows() }),
});

attachCliBinding("status", {
  path: ["status"],
  jsonMode: "flag",
  handler: (args) => ({ json: statusPayload(args.positionals[0]) }),
});

attachCliBinding("sandbox.list", {
  path: ["sandbox", "list"],
  jsonMode: "default",
  handler: () => ({ json: listBundledSandboxProfiles() }),
});

