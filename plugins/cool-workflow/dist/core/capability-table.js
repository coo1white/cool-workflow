// core/capability-table.ts — re-export shim.
//
// The full capability table (the shared machinery + every domain slice)
// now lives under wiring/capability-table/ (see that directory's index.ts
// for the composition order — REGISTRY order is a pinned behavior). This
// file stays so every existing import site (cli/dispatch.ts,
// mcp/dispatch.ts, shell/workbench.ts, the capability-table-*.test.js unit tests,
// scripts/parity-check.mjs, scripts/gen-parity-doc.mjs) keeps working
// unchanged, whether they import a value (REGISTRY, findCapability,
// CAPABILITY_REGISTRY, ...) or a pure type (Capability, CliBinding, ...).
export * from "../wiring/capability-table/index.js";
export { CapabilityNotImplementedError } from "./capability-data.js";
