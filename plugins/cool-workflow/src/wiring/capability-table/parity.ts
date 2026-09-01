// wiring/capability-table/parity.ts — CLI <-> MCP parity planning + report.
// Split out of core/capability-table.ts, byte-for-byte (extracted with
// sed, not retyped).

import { REGISTRY, declaredMcpTools, findCapabilityByMcpTool } from "./registry-core";
import type { Capability, CliBinding, McpBinding } from "../../core/capability-data";

// CLI <-> MCP parity planning + report. Ported from the old flat build's
// src/capability-registry.ts (its single source of parity data) onto this
// table's row shape. Same rule as that file's header: a capability marked
// `payloadIdentical` (the default for `surface: "both"`) MUST return a
// byte-for-byte equal JSON payload from `cw <cmd> --json` and from the
// `cw_<tool>` MCP result (whitespace aside); any divergence is drift. A
// capability reachable on one surface but absent on the other, or an
// undeclared payload divergence, is a release-blocking fail-closed error —
// see scripts/parity-check.js.
//
// `CAPABILITY_REGISTRY` is an alias so callers written against the old
// name (and the two smokes that import this module) find the same array
// under either name; `REGISTRY` stays the primary export other v2 modules
// already use.
export const CAPABILITY_REGISTRY: Capability[] = REGISTRY;

export type PayloadProbeKind = "global" | "run" | "scenario";

export interface PayloadProbeTarget {
  capability: string;
  kind: PayloadProbeKind;
}

export interface PayloadProbeDeferred {
  capability: string;
  reason: string;
}

export interface PayloadProbePlan {
  targets: PayloadProbeTarget[];
  deferred: PayloadProbeDeferred[];
  unclassified: string[];
  duplicateClassifications: string[];
  invalidClassifications: string[];
}

export interface ParityReport {
  ok: boolean;
  registrySize: number;
  /** Tools declared here but absent from the live MCP server. */
  missingMcpTools: string[];
  /** Live MCP tools not declared here (undeclared drift). */
  undeclaredMcpTools: string[];
  /** CLI case tokens declared here but absent from cli source. */
  missingCliTokens: string[];
  /** CLI case tokens in cli source not declared here (undeclared drift). */
  undeclaredCliTokens: string[];
  /** Top-level CLI commands declared here but absent from `cw help`. */
  helpMissingCliTokens: string[];
  /** Top-level CLI commands shown in `cw help` but absent from the registry. */
  helpUndeclaredCliTokens: string[];
  /** Descriptors that must carry a reason but do not. */
  reasonlessExceptions: string[];
  /** Payload-identical both-surface capabilities that are neither probed nor deferred. */
  payloadProbeUnclassified: string[];
  /** Capabilities named more than once in the payload probe classification. */
  payloadProbeDuplicateClassifications: string[];
  /** Payload probe classifications that do not name a payload-identical capability. */
  payloadProbeInvalidClassifications: string[];
  /** Internal registry lint failures (duplicate ids/tools, malformed bindings). */
  registryLint: string[];
}

/** Read-only, run-less global reads: safe with just `cwd`. */
const GLOBAL_PAYLOAD_PROBE_CAPABILITIES = [
  "list",
  "app.list",
  "topology.list",
  "sandbox.list",
  "backend.list",
  "backend.agent.config.show",
  "metrics.summary",
];

/** Read-only reads that need only a planned run id. */
const RUN_PAYLOAD_PROBE_CAPABILITIES = [
  "status",
  "operator.status",
  "operator.report",
  "graph",
  "report",
  "next",
  "state.check",
  "contract.show",
  "node.list",
  "node.graph",
  "worker.summary",
  "candidate.summary",
  "feedback.summary",
  "commit.summary",
  "audit.summary",
  "audit.head",
  "multi-agent.summary",
  "workbench.view",
  "metrics.show",
  "review.status",
  "comment.list",
  "run.drive",
  "gc.plan",
  "gc.verify",
];

/** Capabilities that need bespoke scenario setup (extra args, seeded state,
 *  a dispatched worker, ...) beyond a bare `cwd`/`runId` — see
 *  scripts/parity-check.js's `prepareScenarioCli`/`prepareScenarioMcp` and
 *  `runScenarioCli`/`runScenarioMcp` for the setup + invocation each one
 *  actually runs. */
const SCENARIO_PAYLOAD_PROBE_CAPABILITIES = [
  "plan",
  "app.show",
  "app.validate",
  "app.package",
  "topology.show",
  "topology.validate",
  "topology.apply",
  "topology.summary",
  "topology.graph",
  "summary.refresh",
  "summary.show",
  "sandbox.show",
  "sandbox.validate",
  "sandbox.choose",
  "sandbox.resolve",
  "approve",
  "reject",
  "comment.add",
  "handoff",
  "review.policy",
  "worker.list",
  "worker.show",
  "worker.manifest",
  "worker.output",
  "worker.fail",
  "worker.validate",
  "candidate.list",
  "candidate.show",
  "candidate.register",
  "candidate.score",
  "candidate.rank",
  "candidate.select",
  "candidate.reject",
  "feedback.list",
  "feedback.show",
  "feedback.collect",
  "feedback.task",
  "feedback.resolve",
  "node.show",
  "node.snapshot",
  "node.diff",
  "node.replay",
  "node.replay.verify",
];

/** Payload-identical, both-surface, dual-bound capabilities that are not
 *  yet safe for the deterministic bootstrap parity probe — each needs
 *  extra target ids/files, mutates durable state, depends on external
 *  state, or needs a dedicated fixture beyond cwd/runId. Every entry here
 *  must actually be a dual-bound (`cli` + `mcp`) row in `REGISTRY` without
 *  a declared opt-out, or it never reaches the candidate set this list is
 *  deferring — `buildPayloadProbePlan`'s `invalidClassifications` fails
 *  closed on a stale entry left behind after a row later grows a real
 *  probe target or an explicit opt-out. */
const PAYLOAD_PROBE_DEFERRED_GROUPS: Array<{ reason: string; capabilities: string[] }> = [
  {
    reason:
      "Not safe for the deterministic bootstrap parity probe yet: this capability needs extra target ids/files, mutates durable state, depends on external state, or needs a dedicated fixture beyond cwd/runId.",
    capabilities: [
      "dispatch",
      "result",
      "app.init",
      "migration.list",
      "migration.check",
      "migration.prove",
      "multi-agent.run",
      "multi-agent.status",
      "multi-agent.step",
      "multi-agent.blackboard",
      "multi-agent.score",
      "multi-agent.select",
      "multi-agent.summarize",
      "multi-agent.graph",
      "multi-agent.dependencies",
      "multi-agent.failures",
      "multi-agent.evidence",
      "multi-agent.reasoning",
      "multi-agent.run.create",
      "multi-agent.run.transition",
      "multi-agent.run.show",
      "multi-agent.group.create",
      "multi-agent.membership.create",
      "multi-agent.fanout.create",
      "multi-agent.fanin.collect",
      "eval.snapshot",
      "eval.replay",
      "eval.compare",
      "eval.score",
      "eval.gate",
      "eval.report",
      "blackboard.summary",
      "blackboard.summarize",
      "blackboard.graph",
      "blackboard.resolve",
      "blackboard.topic.create",
      "blackboard.message.post",
      "blackboard.message.list",
      "blackboard.context.put",
      "blackboard.artifact.add",
      "blackboard.artifact.list",
      "blackboard.snapshot",
      "coordinator.summary",
      "coordinator.decision",
      "audit.verify",
      "audit.repair",
      "audit.worker",
      "audit.provenance",
      "audit.multi-agent",
      "audit.policy",
      "audit.role",
      "audit.blackboard",
      "audit.judge",
      "audit.attest",
      "audit.decision",
      "backend.show",
      "backend.probe",
      "run.search",
      "run.list",
      "run.show",
      "run.resume",
      "run.archive",
      "run.rerun",
      "report.verify-bundle",
      "report.bundle",
      "telemetry.verify",
      "history",
    ],
  },
  {
    // Phase B: the CLI bindings just layered onto these previously
    // MCP-only rows make each a real both-surface dual-bound capability, so
    // the payload probe now sees them. Each needs a seeded fixture beyond a
    // bare cwd/runId — a scheduled task / routine trigger / durable queue
    // entry / lease / portable archive on disk, a target entity id
    // (role/group/membership/fanout/fanin/schedule/lease id), a workflow-app
    // id to scaffold or drive, or a registry index to refresh — so each is
    // deferred until a bootstrap fixture is added, exactly like the
    // scenario/deferred split the older batches use. `init` also folds into
    // app.init on both surfaces (scaffold), so it defers with the app family.
    reason:
      "Not safe for the deterministic bootstrap parity probe yet: this capability needs a seeded fixture beyond cwd/runId (a scheduled task / routine trigger / queue entry / lease / portable archive on disk, a target entity id, or a workflow-app id to scaffold or drive). Both surfaces route through the same shell fn; each defers until a bootstrap fixture seeds its state.",
    capabilities: [
      "app.run",
      "init",
      "registry.refresh",
      "registry.show",
      "queue.add",
      "queue.list",
      "queue.drain",
      "queue.show",
      "clones.list",
      "orphans.list",
      "schedule.create",
      "schedule.list",
      "schedule.delete",
      "schedule.due",
      "schedule.complete",
      "schedule.pause",
      "schedule.resume",
      "schedule.run-now",
      "schedule.history",
      "routine.create",
      "routine.list",
      "routine.delete",
      "routine.fire",
      "routine.events",
      "sched.plan",
      "sched.lease",
      "sched.release",
      "sched.complete",
      "sched.reclaim",
      "sched.reset",
      "sched.policy.show",
      "sched.policy.set",
      "run.export",
      "run.import",
      "run.verify-import",
      "run.inspect-archive",
      "run.restore",
      "run.link",
      "multi-agent.reasoning.refresh",
      "multi-agent.graph.compact",
      "multi-agent.role.create",
      "multi-agent.role.show",
      "multi-agent.group.show",
      "multi-agent.membership.show",
      "multi-agent.fanout.show",
      "multi-agent.fanin.show",
    ],
  },
];

/** The MCP tool names this registry declares. */
export function declaredMcpToolsList(): string[] {
  return declaredMcpTools();
}

/** Required MCP argument groups for a registry-declared tool. */
export function mcpRequiredArgsForTool(tool: string): string[] {
  return findCapabilityByMcpTool(tool)?.mcp?.requiredArgs ?? [];
}

/** The CLI `case` tokens this registry declares (deduped). */
export function declaredCliTokens(): string[] {
  const tokens = new Set<string>();
  for (const cap of REGISTRY) {
    if (!cap.cli) continue;
    for (const token of cap.cli.caseTokens ?? cap.cli.path) tokens.add(token);
  }
  return [...tokens].sort();
}

/** The top-level CLI commands that should be visible in `cw help`.
 *  Subcommands are collapsed to their first token; alias tokens (e.g.
 *  `audit-run`) stay visible alongside the verb they alias. */
export function declaredCliHelpTokens(): string[] {
  const tokens = new Set<string>();
  for (const cap of REGISTRY) {
    if (!cap.cli) continue;
    const subcommandTokens = new Set(cap.cli.path.slice(1));
    tokens.add(cap.cli.path[0]);
    for (const token of cap.cli.caseTokens || []) {
      if (!subcommandTokens.has(token)) tokens.add(token);
    }
  }
  tokens.delete("help");
  // `init` is a help-index-only token: v2 folds the standalone `init`
  // capability into `app.init` (its cli.path is ["init"] only so the
  // dispatcher can still run `cw init`, but `cw help` lists it in the
  // frozen "More commands" index line, never as its own per-command help
  // row). Mirrors the parity smoke's HELP_INDEX_ONLY_TOKENS set so the
  // help-token parity stays balanced.
  tokens.delete("init");
  // `search` is likewise help-index-only: its row is hiddenFromHelp (it
  // never had its own `cw help search` row — only the frozen "More
  // commands" index line, which this function does not build), and unlike
  // a family such as `clones` it has no visible sibling row sharing the
  // "search" first token to contribute it independently. Mirrors the
  // parity smoke's HELP_INDEX_ONLY_TOKENS set so the help-token parity
  // stays balanced.
  tokens.delete("search");
  return [...tokens].sort();
}

/** Whether a row MUST carry a reason (surface-specific or payload-divergent). */
export function requiresReason(cap: Capability): boolean {
  if (cap.surface !== "both") return true;
  if (cap.payloadIdentical === false) return true;
  return false;
}

/**
 * Whether a `surface:"both"` capability is DOCUMENTED out of the payload-identity
 * probe. The probe defaults capabilities IN (every both-surface, dual-bound verb —
 * including write/complex-arg verbs) and requires an EXPLICIT, REASONED opt-out to
 * fall out of scope. A capability escapes the probe only when it carries BOTH
 * `payloadIdentical: false` AND a non-empty `reason`. A bare `payloadIdentical:
 * false` with no recorded reason does NOT silently escape — it stays in the probe
 * set so the undocumented divergence trips the gate (FAIL CLOSED).
 */
export function isPayloadProbeOptOut(cap: Capability): boolean {
  return cap.payloadIdentical === false && !!(cap.reason && cap.reason.trim());
}

/** Rows for the payload-identity probe. Defaults to EVERY both-surface,
 *  dual-bound capability (read OR write); a row is excluded only by a
 *  documented opt-out (`payloadIdentical: false` + a non-empty `reason`) —
 *  see `isPayloadProbeOptOut`. Fail-closed: an undocumented `payloadIdentical:
 *  false` stays in scope so its divergence is caught, not silently excused. */
export function payloadIdenticalCapabilities(): Capability[] {
  return REGISTRY.filter((cap) => cap.surface === "both" && cap.cli && cap.mcp && !isPayloadProbeOptOut(cap));
}

export function payloadProbeTargets(): PayloadProbeTarget[] {
  return [
    ...GLOBAL_PAYLOAD_PROBE_CAPABILITIES.map((capability) => ({ capability, kind: "global" as const })),
    ...RUN_PAYLOAD_PROBE_CAPABILITIES.map((capability) => ({ capability, kind: "run" as const })),
    ...SCENARIO_PAYLOAD_PROBE_CAPABILITIES.map((capability) => ({ capability, kind: "scenario" as const })),
  ];
}

export function deferredPayloadProbeCapabilities(): PayloadProbeDeferred[] {
  return PAYLOAD_PROBE_DEFERRED_GROUPS.flatMap((group) =>
    group.capabilities.map((capability) => ({ capability, reason: group.reason }))
  );
}

export function buildPayloadProbePlan(
  targets: PayloadProbeTarget[],
  deferred: PayloadProbeDeferred[]
): PayloadProbePlan {
  const candidateIds = new Set(payloadIdenticalCapabilities().map((cap) => cap.capability));
  const counts = new Map<string, number>();
  const classified = [...targets.map((entry) => entry.capability), ...deferred.map((entry) => entry.capability)];
  for (const capability of classified) counts.set(capability, (counts.get(capability) || 0) + 1);
  const classifiedIds = new Set(classified);
  return {
    targets,
    deferred,
    unclassified: [...candidateIds].filter((capability) => !classifiedIds.has(capability)).sort(),
    duplicateClassifications: [...counts.entries()]
      .filter(([, count]) => count > 1)
      .map(([capability]) => capability)
      .sort(),
    invalidClassifications: [...classifiedIds].filter((capability) => !candidateIds.has(capability)).sort(),
  };
}

export function payloadProbePlan(): PayloadProbePlan {
  return buildPayloadProbePlan(payloadProbeTargets(), deferredPayloadProbeCapabilities());
}

function lintRegistry(): string[] {
  const issues: string[] = [];
  const seenCaps = new Set<string>();
  const seenTools = new Set<string>();
  for (const cap of REGISTRY) {
    if (seenCaps.has(cap.capability)) issues.push(`duplicate capability id: ${cap.capability}`);
    seenCaps.add(cap.capability);
    if (cap.mcp) {
      if (seenTools.has(cap.mcp.tool)) issues.push(`duplicate MCP tool: ${cap.mcp.tool}`);
      seenTools.add(cap.mcp.tool);
    }
    // NOTE (v2 build-order difference from the old flat registry): the old
    // build's registry was written all at once, so a "both" row ALWAYS had
    // both bindings the moment it was declared. This table is built up
    // MILESTONE BY MILESTONE (this file's header note): `REGISTRY` starts
    // from the full, literal 196-tool `mcp` surface (SPEC/mcp.md) and each
    // milestone LAYERS a `cli` binding onto the rows it wires next — so a
    // "both" row with an `mcp` binding but no `cli` binding YET is the
    // expected, honest mid-rollout state, not a lint error. `cli` bindings
    // are added without ever touching `surface`, so the lint only fails
    // closed on what is actually impossible: a `mcp` binding must always
    // exist for "both" (every row starts from `MCP_TOOL_DATA`), and
    // `cli-only`/`mcp-only` rows must carry exactly the one binding their
    // name promises.
    if (cap.surface === "both" && !cap.mcp) {
      issues.push(`${cap.capability}: surface "both" requires an mcp binding`);
    }
    if (cap.surface === "cli-only" && (cap.mcp || !cap.cli)) {
      issues.push(`${cap.capability}: surface "cli-only" requires a cli binding and no mcp binding`);
    }
    if (cap.surface === "mcp-only" && (cap.cli || !cap.mcp)) {
      issues.push(`${cap.capability}: surface "mcp-only" requires an mcp binding and no cli binding`);
    }
  }
  return issues;
}

/**
 * Compare the declared registry against the ACTUAL surfaces and report every
 * fail-closed gap. `mcpTools` is the live `tools/list` result. `cliTokens` is
 * optional test input for an independent token source; the table-driven live
 * gate leaves it out and probes dispatcher reachability instead.
 */
export function buildParityReport(input: { mcpTools: string[]; cliTokens?: string[]; helpTokens?: string[] }): ParityReport {
  const declaredTools = new Set(declaredMcpTools());
  const actualTools = new Set(input.mcpTools);
  const declaredTokens = new Set(declaredCliTokens());
  const actualTokens = new Set(input.cliTokens || []);
  const declaredHelpTokens = new Set(declaredCliHelpTokens());
  const actualHelpTokens = new Set(input.helpTokens || []);

  const missingMcpTools = [...declaredTools].filter((tool) => !actualTools.has(tool)).sort();
  const undeclaredMcpTools = [...actualTools].filter((tool) => !declaredTools.has(tool)).sort();
  const missingCliTokens = input.cliTokens
    ? [...declaredTokens].filter((token) => !actualTokens.has(token)).sort()
    : [];
  const undeclaredCliTokens = input.cliTokens
    ? [...actualTokens].filter((token) => !declaredTokens.has(token)).sort()
    : [];
  const helpMissingCliTokens = input.helpTokens
    ? [...declaredHelpTokens].filter((token) => !actualHelpTokens.has(token)).sort()
    : [];
  const helpUndeclaredCliTokens = input.helpTokens
    ? [...actualHelpTokens].filter((token) => !declaredHelpTokens.has(token)).sort()
    : [];

  const reasonlessExceptions = REGISTRY.filter((cap) => requiresReason(cap) && !(cap.reason && cap.reason.trim()))
    .map((cap) => cap.capability)
    .sort();

  const payloadPlan = payloadProbePlan();
  const registryLint = lintRegistry();

  const ok =
    missingMcpTools.length === 0 &&
    undeclaredMcpTools.length === 0 &&
    missingCliTokens.length === 0 &&
    undeclaredCliTokens.length === 0 &&
    helpMissingCliTokens.length === 0 &&
    helpUndeclaredCliTokens.length === 0 &&
    reasonlessExceptions.length === 0 &&
    payloadPlan.unclassified.length === 0 &&
    payloadPlan.duplicateClassifications.length === 0 &&
    payloadPlan.invalidClassifications.length === 0 &&
    registryLint.length === 0;

  return {
    ok,
    registrySize: REGISTRY.length,
    missingMcpTools,
    undeclaredMcpTools,
    missingCliTokens,
    undeclaredCliTokens,
    helpMissingCliTokens,
    helpUndeclaredCliTokens,
    reasonlessExceptions,
    payloadProbeUnclassified: payloadPlan.unclassified,
    payloadProbeDuplicateClassifications: payloadPlan.duplicateClassifications,
    payloadProbeInvalidClassifications: payloadPlan.invalidClassifications,
    registryLint,
  };
}

