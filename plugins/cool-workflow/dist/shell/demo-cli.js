"use strict";
// shell/demo-cli.ts — CLI-reachable bodies for `cw demo tamper|bundle`.
// CLI-only per SPEC/ledger-trust.md ("`demo` is CLI-only").
//
// MILESTONE 8. Byte-exact port of the old build's capability-core module's
// `demoTamper`/`demoBundle` (both simply call the hermetic demo
// runners with no argument-derived behavior).
//
// Evidence: SPEC/ledger-trust.md "`cw demo tamper|bundle [--json]`".
Object.defineProperty(exports, "__esModule", { value: true });
exports.demoTamperCli = demoTamperCli;
exports.demoBundleCli = demoBundleCli;
const telemetry_demo_1 = require("./telemetry-demo");
function demoTamperCli() {
    return (0, telemetry_demo_1.runTamperDemo)();
}
function demoBundleCli() {
    return (0, telemetry_demo_1.runBundleDemo)();
}
