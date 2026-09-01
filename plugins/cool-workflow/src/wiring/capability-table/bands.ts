// wiring/capability-table/bands.ts — CLI/MCP bindings for the `bands`
// capability family (`bands.check`, `bands.record`): the maintain-stage
// closed loop that turns a metric breach into a queued, reviewable work
// item. Handler bodies live in shell/bands-io.ts (impure — file IO);
// this table only wires argv/MCP-arg shape to those calls.
//
// Both rows are `hiddenFromHelp` (a brand-new top-level verb, same as a
// two-token row in wiring/capability-table/scheduling-registry.ts) so
// `cw help` text — byte-pinned by the conformance suite's root-help
// fixture — is untouched; see parity.ts's `declaredCliHelpTokens` for the
// matching `tokens.delete("bands")`. The command is real and reachable;
// it is documented in docs/control-bands.7.md.

import { attachCliBinding, REGISTRY_BY_CAPABILITY } from "./registry-core";
import { parseBoolFlag, required } from "../../core/util/cli-args";
import type { CapabilityCliArgs } from "../../core/capability-data";

function loadBandsIo(): typeof import("../../shell/bands-io") {
  return require("../../shell/bands-io") as typeof import("../../shell/bands-io");
}

function bandsOptions(args: CapabilityCliArgs) {
  return { config: args.options.config as string | undefined, input: args.options.input as string | undefined, cwd: args.options.cwd as string | undefined };
}

attachCliBinding("bands.check", {
  path: ["bands", "check"],
  jsonMode: "default",
  hiddenFromHelp: true,
  handler: (args) => ({ json: loadBandsIo().bandsCheck(bandsOptions(args)) }),
});
REGISTRY_BY_CAPABILITY.get("bands.check")!.mcp!.handler = (args) =>
  loadBandsIo().bandsCheck({ config: required(args.config as string | undefined, "config"), input: required(args.input as string | undefined, "input"), cwd: args.cwd as string | undefined });

attachCliBinding("bands.record", {
  path: ["bands", "record"],
  jsonMode: "default",
  hiddenFromHelp: true,
  handler: (args) => ({ json: loadBandsIo().bandsRecord({ ...bandsOptions(args), queue: parseBoolFlag(args.options.queue, "--queue") ?? false }, new Date().toISOString()) }),
});
REGISTRY_BY_CAPABILITY.get("bands.record")!.mcp!.handler = (args) =>
  loadBandsIo().bandsRecord(
    {
      config: required(args.config as string | undefined, "config"),
      input: required(args.input as string | undefined, "input"),
      cwd: args.cwd as string | undefined,
      queue: parseBoolFlag(args.queue, "queue") ?? false,
    },
    new Date().toISOString()
  );
