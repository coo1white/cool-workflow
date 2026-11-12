// shell/commands/demo-cli.ts — CLI-reachable body for `cw demo tamper`.
// CLI-only per SPEC/ledger-trust.md ("`demo` is CLI-only").
//
// It simply calls the hermetic demo runner with no argument-derived
// behavior.
//
// Evidence: SPEC/ledger-trust.md "`cw demo tamper [--json]`".

import { runTamperDemo } from "../tamper-demo.js";

export function demoTamperCli(): ReturnType<typeof runTamperDemo> {
  return runTamperDemo();
}
