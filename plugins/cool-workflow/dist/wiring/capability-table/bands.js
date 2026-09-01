"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
const registry_core_1 = require("./registry-core");
const cli_args_1 = require("../../core/util/cli-args");
function loadBandsIo() {
    return require("../../shell/bands-io");
}
function bandsOptions(args) {
    return { config: args.options.config, input: args.options.input, cwd: args.options.cwd };
}
(0, registry_core_1.attachCliBinding)("bands.check", {
    path: ["bands", "check"],
    jsonMode: "default",
    hiddenFromHelp: true,
    handler: (args) => ({ json: loadBandsIo().bandsCheck(bandsOptions(args)) }),
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("bands.check").mcp.handler = (args) => loadBandsIo().bandsCheck({ config: (0, cli_args_1.required)(args.config, "config"), input: (0, cli_args_1.required)(args.input, "input"), cwd: args.cwd });
(0, registry_core_1.attachCliBinding)("bands.record", {
    path: ["bands", "record"],
    jsonMode: "default",
    hiddenFromHelp: true,
    handler: (args) => ({ json: loadBandsIo().bandsRecord({ ...bandsOptions(args), queue: (0, cli_args_1.parseBoolFlag)(args.options.queue, "--queue") ?? false }, new Date().toISOString()) }),
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("bands.record").mcp.handler = (args) => loadBandsIo().bandsRecord({
    config: (0, cli_args_1.required)(args.config, "config"),
    input: (0, cli_args_1.required)(args.input, "input"),
    cwd: args.cwd,
    queue: (0, cli_args_1.parseBoolFlag)(args.queue, "queue") ?? false,
}, new Date().toISOString());
