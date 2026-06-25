"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleGc = handleGc;
exports.handleTelemetry = handleTelemetry;
exports.handleDemo = handleDemo;
const capability_core_1 = require("../../capability-core");
const run_registry_1 = require("../../run-registry");
const telemetry_demo_1 = require("../../telemetry-demo");
const io_1 = require("../io");
/** `cw gc plan|run|verify [run-id] …` — run retention & provable reclamation. */
function handleGc(args, runner) {
    // Run Retention & Provable Reclamation (v0.1.39). `plan` is a pure dry-run
    // (frees nothing); `run` executes the write-ahead reclamation transaction;
    // `verify` re-proves a reclaimed run. CW never reclaims by default.
    const registry = (0, capability_core_1.runRegistryFor)(args.options, runner);
    const [subcommand, id] = args.positionals;
    switch (subcommand) {
        case "plan": {
            const result = (0, capability_core_1.gcPlan)(registry, id, args.options);
            if ((0, io_1.wantsJson)(args.options))
                (0, io_1.printJson)(result);
            else
                process.stdout.write(`${(0, run_registry_1.formatGcPlan)(result)}\n`);
            return;
        }
        case "run": {
            const result = (0, capability_core_1.gcRun)(registry, id, args.options);
            if ((0, io_1.wantsJson)(args.options))
                (0, io_1.printJson)(result);
            else
                process.stdout.write(`${(0, run_registry_1.formatGcRun)(result)}\n`);
            return;
        }
        case "verify": {
            const result = (0, capability_core_1.gcVerify)(registry, (0, io_1.required)(id, "run id"), args.options);
            if ((0, io_1.wantsJson)(args.options))
                (0, io_1.printJson)(result);
            else
                process.stdout.write(`${(0, run_registry_1.formatGcVerify)(result)}\n`);
            // Fail closed ONLY on a real integrity failure: a run that WAS reclaimed
            // but no longer re-proves. A not-reclaimed run has nothing to verify
            // (reclaimed:false/verified:false) and must not be treated as a failure.
            // LIMIT (honest): a DELETED reclaimed.json reads as reclaimed:false, so
            // proof-deletion is indistinguishable from never-reclaimed here without
            // an independent witness (e.g. a trust-audit reclamation event) — a
            // follow-up. This guard is still strictly better than the prior exit-0.
            if (result.reclaimed && !result.verified)
                process.exitCode = 1;
            return;
        }
        default:
            throw new Error("Usage: cw.js gc plan|run|verify [run-id] [--reclaimAfterArchiveDays N] [--keep-scratch] [--keep-snapshots] [--limit N] [--json]");
    }
}
/** `cw telemetry verify <run-id> …` — verify the signed telemetry ledger. */
function handleTelemetry(args, runner) {
    const [subcommand, id] = args.positionals;
    switch (subcommand) {
        case "verify": {
            const result = (0, capability_core_1.telemetryVerify)(runner, { ...args.options, runId: id || args.options.runId || args.options.run });
            if ((0, io_1.wantsJson)(args.options))
                (0, io_1.printJson)(result);
            else
                process.stdout.write(`${(0, telemetry_demo_1.formatTelemetryVerify)(result)}\n`);
            // Fail closed: a forged/edited/corrupt ledger verifies false — report it
            // through the exit code so `cw telemetry verify <run> && deploy` cannot
            // pass on a lie. (Absent ledger = present:false/verified:true -> exit 0.)
            if (!result.verified)
                process.exitCode = 1;
            return;
        }
        default:
            throw new Error("Usage: cw.js telemetry verify <run-id> [--pubkey <pem-or-path>] [--json]");
    }
}
/** `cw demo tamper|bundle [--json]` — the tamper/bundle integrity demos. */
function handleDemo(args, runner) {
    const [subcommand] = args.positionals;
    switch (subcommand) {
        case "tamper": {
            const result = (0, capability_core_1.demoTamper)(runner, args.options);
            if ((0, io_1.wantsJson)(args.options))
                (0, io_1.printJson)(result);
            else
                process.stdout.write(`${(0, telemetry_demo_1.formatTamperDemo)(result)}\n`);
            // Fail closed: if the proof did not hold (a tamper went undetected),
            // exit nonzero so the demo can never green a broken guarantee.
            if (!result.proven)
                process.exitCode = 1;
            return;
        }
        case "bundle": {
            const result = (0, capability_core_1.demoBundle)(runner, args.options);
            if ((0, io_1.wantsJson)(args.options))
                (0, io_1.printJson)(result);
            else
                process.stdout.write(`${(0, telemetry_demo_1.formatBundleDemo)(result)}\n`);
            // Fail closed: a forged bundle that verified would be a regression in the
            // bundle guarantee — exit nonzero so the demo can never green it.
            if (!result.proven)
                process.exitCode = 1;
            return;
        }
        default:
            throw new Error("Usage: cw.js demo tamper|bundle [--json]");
    }
}
