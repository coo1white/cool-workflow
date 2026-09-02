// shell/demo-cli.ts — CLI-reachable bodies for `cw demo tamper|bundle`.
// CLI-only per SPEC/ledger-trust.md ("`demo` is CLI-only").
//
// MILESTONE 8. Byte-exact port of the old build's capability-core module's
// `demoTamper`/`demoBundle` (both simply call the hermetic demo
// runners with no argument-derived behavior).
//
// Evidence: SPEC/ledger-trust.md "`cw demo tamper|bundle [--json]`".

import { runBundleDemo, runTamperDemo } from "./telemetry-demo";

export function demoTamperCli(): ReturnType<typeof runTamperDemo> {
  return runTamperDemo();
}

export function demoBundleCli(): ReturnType<typeof runBundleDemo> {
  return runBundleDemo();
}
