// shell/demo-cli.ts — CLI-reachable bodies for `cw demo tamper|bundle`.
// CLI-only per SPEC/ledger-trust.md ("`demo` is CLI-only").
//
// Both simply call the hermetic demo runners with no argument-derived
// behavior.
//
// Evidence: SPEC/ledger-trust.md "`cw demo tamper|bundle [--json]`".
import { runBundleDemo, runTamperDemo } from "./telemetry-demo.js";
export function demoTamperCli() {
    return runTamperDemo();
}
export function demoBundleCli() {
    return runBundleDemo();
}
