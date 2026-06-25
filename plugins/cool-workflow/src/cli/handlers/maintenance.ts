// `cw gc|telemetry|demo …` handlers — the maintenance family (run retention &
// provable reclamation, telemetry-ledger verification, and the tamper/bundle
// demos), carved out of the command-surface god-dispatch. Each inner case
// prints inline and returns (no shared tail; mirrors node.ts). FOUR fail-closed
// exits live here, copied verbatim: gc verify (reclaimed && !verified),
// telemetry verify (!verified), demo tamper (!proven), demo bundle (!proven).
// runRegistryFor stays in capability-core (the `metrics` case still uses it
// over in command-surface); it is consumed here only for the gc pre-switch.
import { CoolWorkflowRunner, parseArgv } from "../../orchestrator";
import { gcPlan, gcRun, gcVerify, runRegistryFor, telemetryVerify, demoTamper, demoBundle } from "../../capability-core";
import { formatGcPlan, formatGcRun, formatGcVerify } from "../../run-registry";
import { formatTelemetryVerify, formatTamperDemo, formatBundleDemo } from "../../telemetry-demo";
import { printJson, required, wantsJson } from "../io";

type ParsedArgs = ReturnType<typeof parseArgv>;

/** `cw gc plan|run|verify [run-id] …` — run retention & provable reclamation. */
export function handleGc(args: ParsedArgs, runner: CoolWorkflowRunner): void {
  // Run Retention & Provable Reclamation (v0.1.39). `plan` is a pure dry-run
  // (frees nothing); `run` executes the write-ahead reclamation transaction;
  // `verify` re-proves a reclaimed run. CW never reclaims by default.
  const registry = runRegistryFor(args.options, runner);
  const [subcommand, id] = args.positionals;
  switch (subcommand) {
    case "plan": {
      const result = gcPlan(registry, id, args.options);
      if (wantsJson(args.options)) printJson(result);
      else process.stdout.write(`${formatGcPlan(result)}\n`);
      return;
    }
    case "run": {
      const result = gcRun(registry, id, args.options);
      if (wantsJson(args.options)) printJson(result);
      else process.stdout.write(`${formatGcRun(result)}\n`);
      return;
    }
    case "verify": {
      const result = gcVerify(registry, required(id, "run id"), args.options);
      if (wantsJson(args.options)) printJson(result);
      else process.stdout.write(`${formatGcVerify(result)}\n`);
      // Fail closed ONLY on a real integrity failure: a run that WAS reclaimed
      // but no longer re-proves. A not-reclaimed run has nothing to verify
      // (reclaimed:false/verified:false) and must not be treated as a failure.
      // LIMIT (honest): a DELETED reclaimed.json reads as reclaimed:false, so
      // proof-deletion is indistinguishable from never-reclaimed here without
      // an independent witness (e.g. a trust-audit reclamation event) — a
      // follow-up. This guard is still strictly better than the prior exit-0.
      if (result.reclaimed && !result.verified) process.exitCode = 1;
      return;
    }
    default:
      throw new Error("Usage: cw.js gc plan|run|verify [run-id] [--reclaimAfterArchiveDays N] [--keep-scratch] [--keep-snapshots] [--limit N] [--json]");
  }
}

/** `cw telemetry verify <run-id> …` — verify the signed telemetry ledger. */
export function handleTelemetry(args: ParsedArgs, runner: CoolWorkflowRunner): void {
  const [subcommand, id] = args.positionals;
  switch (subcommand) {
    case "verify": {
      const result = telemetryVerify(runner, { ...args.options, runId: id || args.options.runId || args.options.run });
      if (wantsJson(args.options)) printJson(result);
      else process.stdout.write(`${formatTelemetryVerify(result)}\n`);
      // Fail closed: a forged/edited/corrupt ledger verifies false — report it
      // through the exit code so `cw telemetry verify <run> && deploy` cannot
      // pass on a lie. (Absent ledger = present:false/verified:true -> exit 0.)
      if (!result.verified) process.exitCode = 1;
      return;
    }
    default:
      throw new Error("Usage: cw.js telemetry verify <run-id> [--pubkey <pem-or-path>] [--json]");
  }
}

/** `cw demo tamper|bundle [--json]` — the tamper/bundle integrity demos. */
export function handleDemo(args: ParsedArgs, runner: CoolWorkflowRunner): void {
  const [subcommand] = args.positionals;
  switch (subcommand) {
    case "tamper": {
      const result = demoTamper(runner, args.options);
      if (wantsJson(args.options)) printJson(result);
      else process.stdout.write(`${formatTamperDemo(result)}\n`);
      // Fail closed: if the proof did not hold (a tamper went undetected),
      // exit nonzero so the demo can never green a broken guarantee.
      if (!result.proven) process.exitCode = 1;
      return;
    }
    case "bundle": {
      const result = demoBundle(runner, args.options);
      if (wantsJson(args.options)) printJson(result);
      else process.stdout.write(`${formatBundleDemo(result)}\n`);
      // Fail closed: a forged bundle that verified would be a regression in the
      // bundle guarantee — exit nonzero so the demo can never green it.
      if (!result.proven) process.exitCode = 1;
      return;
    }
    default:
      throw new Error("Usage: cw.js demo tamper|bundle [--json]");
  }
}
