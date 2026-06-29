// CLI option parsing & coercion utilities — extracted from orchestrator.ts.
//
// Pure functions that turn the raw parsed-argv option bag into typed values
// (strings, numbers, arrays, actors, blackboard scopes, sandbox choices, …).
// No run state, no I/O. The orchestrator imports the subset it uses.

import { SandboxProfileError } from "../sandbox-profile";
import { GRAPH_VIEWS, GraphView } from "../state-explosion";
import { WorkflowAppValidationError } from "../workflow-app-framework";
import {
  ActorAttestation,
  CollaborationTarget,
  CollaborationTargetKind,
  WorkflowAppValidationIssue
} from "../types";

export function isMissing(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

export function numberOption(value: unknown): number | undefined {
  if (value === undefined || value === null || value === true) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function stringOption(value: unknown): string | undefined {
  if (value === undefined || value === null || value === true) return undefined;
  return String(value);
}

export function requiredStringOption(value: unknown, label: string): string {
  const parsed = stringOption(value);
  if (!parsed) throw new Error(`Missing ${label}`);
  return parsed;
}

export const COLLABORATION_TARGET_KINDS: CollaborationTargetKind[] = ["run", "task", "candidate", "selection", "commit", "node"];

export function collaborationTarget(kind: string, id: string): CollaborationTarget {
  const normalizedKind = stringOption(kind);
  const normalizedId = stringOption(id);
  if (!normalizedKind || !(COLLABORATION_TARGET_KINDS as string[]).includes(normalizedKind)) {
    throw new Error(`Target kind must be one of ${COLLABORATION_TARGET_KINDS.join("|")}`);
  }
  if (!normalizedId) throw new Error("Missing target id");
  return { kind: normalizedKind as CollaborationTargetKind, id: normalizedId };
}

export function collaborationTargetMaybe(kind: string | undefined, id: string | undefined): CollaborationTarget | undefined {
  if (!kind && !id) return undefined;
  return collaborationTarget(String(kind || ""), String(id || ""));
}

export function actorInputFrom(options: Record<string, unknown>): {
  actor?: string;
  actorKind?: string;
  role?: string;
  displayName?: string;
  attested?: boolean;
  attestation?: ActorAttestation;
} {
  return {
    actor: stringOption(firstDefined(options, "actor", "by")),
    actorKind: stringOption(firstDefined(options, "actorKind", "actor-kind", "kind")),
    role: stringOption(firstDefined(options, "role", "roleId", "role-id")),
    displayName: stringOption(firstDefined(options, "displayName", "display-name", "name")),
    attested: Boolean(options.attested),
    attestation: stringOption(options.attestation) as ActorAttestation | undefined
  };
}

/** First option value present under any of the given keys (camelCase or dashed). */
export function firstDefined(options: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (options[key] !== undefined) return options[key];
  }
  return undefined;
}

export function graphViewOption(value: unknown): GraphView {
  const parsed = stringOption(value);
  if (!parsed) return "compact";
  if (!(GRAPH_VIEWS as string[]).includes(parsed)) {
    throw new Error(`Unknown graph view: ${parsed}. Valid views: ${GRAPH_VIEWS.join(", ")}`);
  }
  return parsed as GraphView;
}

export function graphViewsOption(options: Record<string, unknown>): GraphView[] | undefined {
  const raw = arrayOption(options.view || options.views).map(String);
  if (!raw.length) return undefined;
  for (const view of raw) {
    if (!(GRAPH_VIEWS as string[]).includes(view)) {
      throw new Error(`Unknown graph view: ${view}. Valid views: ${GRAPH_VIEWS.join(", ")}`);
    }
  }
  return raw as GraphView[];
}

export function metadataOption(options: Record<string, unknown>): Record<string, unknown> | undefined {
  const raw = options.metadata;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === "string") { try { return JSON.parse(raw) as Record<string, unknown>; } catch { throw new Error(`Invalid JSON in --metadata: ${String(raw).slice(0, 80)}`); } }
  return undefined;
}

export function withoutHostRunKeys(args: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...args };
  for (const key of [
    "app",
    "appId",
    "workflow",
    "workflowId",
    "inputs",
    "topology",
    "topologyId",
    "topologyRun",
    "topologyRunId",
    "multiAgentRun",
    "multiAgentRunId",
    "blackboard",
    "blackboardId",
    "mapperCount",
    "mappers",
    "mapper",
    "judgeCount",
    "judges",
    "judge",
    "debateRounds",
    "rounds",
    "collectInitialFanin",
    "collect-initial-fanin"
  ]) {
    delete copy[key];
  }
  return { ...copy, ...(optionsRecord(args.inputs) || {}) };
}

export function optionsRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return undefined;
}

export function parseBlackboardAuthor(options: Record<string, unknown>): { kind?: never; id?: string; displayName?: string } | undefined {
  const structured = options.author;
  if (structured && typeof structured === "object" && !Array.isArray(structured)) return structured as never;
  const id = stringOption(options.authorId || options.author || options.worker || options.workerId || options.role || options.roleId || options.group || options.groupId);
  const kind = stringOption(options.authorKind || options.sourceKind || options.source);
  const displayName = stringOption(options.authorName || options.displayName);
  if (!id && !kind && !displayName) return undefined;
  return { kind: kind as never, id, displayName };
}

export function parseBlackboardScope(options: Record<string, unknown>): { kind?: never; id?: string } | undefined {
  const structured = options.scope;
  if (structured && typeof structured === "object" && !Array.isArray(structured)) return structured as never;
  const kind = stringOption(options.scopeKind);
  const id = stringOption(options.scopeId);
  if (!kind && !id) return undefined;
  return { kind: kind as never, id };
}

export function parseBlackboardLinks(runId: string, options: Record<string, unknown>): Record<string, unknown> | undefined {
  const structured = options.provenance || options.links;
  if (structured && typeof structured === "object" && !Array.isArray(structured)) return structured as Record<string, unknown>;
  const links = {
    workflowRunId: runId,
    multiAgentRunId: stringOption(options.multiAgentRun || options.multiAgentRunId || options["multi-agent-run"]),
    agentGroupId: stringOption(options.group || options.groupId || options["multi-agent-group"]),
    agentRoleId: stringOption(options.role || options.roleId || options["multi-agent-role"]),
    agentMembershipId: stringOption(options.membership || options.membershipId || options["multi-agent-membership"]),
    agentFanoutId: stringOption(options.fanout || options.fanoutId || options["multi-agent-fanout"]),
    agentFaninId: stringOption(options.fanin || options.faninId || options["multi-agent-fanin"]),
    taskId: stringOption(options.task || options.taskId),
    workerId: stringOption(options.worker || options.workerId),
    candidateId: stringOption(options.candidate || options.candidateId),
    verifierNodeId: stringOption(options.verifier || options.verifierNode || options.verifierNodeId),
    commitId: stringOption(options.commit || options.commitId),
    auditEventIds: arrayOption(options.audit || options.auditEvent || options.auditEventId || options["audit-event"]).map(String),
    evidenceRefs: arrayOption(options.evidence || options.evidenceRef || options["evidence-ref"]).map(String)
  };
  const entries = Object.entries(links).filter(([, value]) => value !== undefined && (!Array.isArray(value) || value.length));
  return entries.length > 1 ? Object.fromEntries(entries) : undefined;
}

export function parseSandboxChoices(options: Record<string, unknown>): Record<string, string> | undefined {
  const choices: Record<string, string> = {};
  const structured = options.sandboxChoices || options.sandboxProfileChoices;
  if (structured && typeof structured === "object" && !Array.isArray(structured)) {
    for (const [key, value] of Object.entries(structured as Record<string, unknown>)) choices[key] = String(value);
  }
  for (const entry of arrayOption(options.sandboxChoice || options["sandbox-choice"])) {
    const [key, ...rest] = String(entry).split("=");
    if (key && rest.length) choices[key] = rest.join("=");
  }
  const sandbox = stringOption(options.sandbox || options.sandboxProfile || options.sandboxProfileId);
  if (sandbox && !Object.keys(choices).length) choices.default = sandbox;
  return Object.keys(choices).length ? choices : undefined;
}

export function parseCriteria(options: Record<string, unknown>): Record<string, number> {
  const criteria: Record<string, number> = {};
  const structured = options.criteria;
  if (structured && typeof structured === "object" && !Array.isArray(structured)) {
    for (const [key, value] of Object.entries(structured as Record<string, unknown>)) {
      const parsed = Number(value);
      if (key && Number.isFinite(parsed)) criteria[key] = parsed;
    }
  }
  const rawCriteria = options.criterion || (typeof structured === "object" && !Array.isArray(structured) ? undefined : structured) || options.score;
  for (const entry of arrayOption(rawCriteria)) {
    const [key, value] = String(entry).split("=");
    if (!key || value === undefined) continue;
    criteria[key] = Number(value);
  }
  if (!Object.keys(criteria).length && options.total !== undefined) {
    criteria.total = Number(options.total);
  }
  if (!Object.keys(criteria).length) throw new Error("Missing score criteria. Use --criterion name=value");
  return criteria;
}

export function parseEvidence(value: unknown) {
  return arrayOption(value).map((entry, index) => ({
    id: `score:${index + 1}`,
    source: "candidate-score",
    locator: String(entry),
    summary: String(entry)
  }));
}

export function mergeEvidence<T extends { id: string }>(left: T[], right: T[]): T[] {
  const merged = [...left];
  for (const item of right) {
    const index = merged.findIndex((entry) => entry.id === item.id);
    if (index >= 0) merged[index] = item;
    else merged.push(item);
  }
  return merged;
}

export function arrayOption(value: unknown): unknown[] {
  if (value === undefined || value === null || value === true) return [];
  return Array.isArray(value) ? value : [value];
}

export function valuesOption(value: unknown): string[] {
  return arrayOption(value).map((entry) => String(entry).split("=")[0]).filter(Boolean);
}

export function inferAuditDecisionKind(options: Record<string, unknown>): string {
  if (options.command) return "sandbox.command";
  if (options.network || options.networkTarget) return "sandbox.network";
  if (options.env || options.envVar) return "sandbox.env";
  return "sandbox.path";
}

export function isSandboxProfileError(error: unknown): error is SandboxProfileError {
  return error instanceof SandboxProfileError || Boolean(error && typeof error === "object" && "code" in error && String((error as { code?: unknown }).code).startsWith("sandbox-"));
}

export function validationIssuesFromError(error: unknown): WorkflowAppValidationIssue[] {
  if (error instanceof WorkflowAppValidationError) return error.issues;
  return [
    {
      code: "workflow-app-invalid",
      message: error instanceof Error ? error.message : String(error)
    }
  ];
}
