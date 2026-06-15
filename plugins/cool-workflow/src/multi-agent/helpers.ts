// Pure, stateless helpers for the multi-agent kernel (god-module carve, FreeBSD
// router pattern — see run-registry/{format,derive,policy}.ts and
// orchestrator/*-operations.ts). BEHAVIOR-PRESERVING — pure code movement, zero
// logic change. Every function here is a function of its arguments only: it never
// touches a WorkflowRun, the multi-agent state, the filesystem, or any module
// state. multi-agent.ts re-exports the public members so importers stay byte-
// unchanged.
import {
  AgentMembership,
  MultiAgentLifecycleEvent,
  MultiAgentLifecycleStatus,
  StateNodeStatus
} from "../types";
import { safeFileName } from "../state";

export const MULTI_AGENT_SCHEMA_VERSION = 1;

/** A graph edge as produced by buildMultiAgentGraph (structurally identical to
 *  MultiAgentGraph["edges"][number]); declared here so the dedup helper carries
 *  no dependency back onto the god-module. */
type GraphEdge = { from: string; to: string; label?: string };

export function indexRow(record: { id: string; status?: string; updatedAt?: string }): Record<string, unknown> {
  return { id: record.id, status: record.status, updatedAt: record.updatedAt };
}

export function assertNoRecordPathCollisions(label: string, records: Array<{ id: string }>): void {
  const seen = new Map<string, string>();
  for (const record of records) {
    const safe = safeFileName(record.id);
    const existing = seen.get(safe);
    if (existing && existing !== record.id) {
      throw new Error(`${label} ids ${existing} and ${record.id} collide on safe file name ${safe}`);
    }
    seen.set(safe, record.id);
  }
}

export function pluralKind(kind: string): string {
  switch (kind) {
    case "multi-agent-run":
      return "runs";
    case "agent-role":
      return "roles";
    case "agent-group":
      return "groups";
    case "agent-membership":
      return "memberships";
    case "agent-fanout":
      return "fanouts";
    case "agent-fanin":
      return "fanins";
    default:
      return `${kind}s`;
  }
}

export function statusToNodeStatus(status: string): StateNodeStatus {
  switch (status) {
    case "completed":
    case "reported":
    case "ready":
      return "completed";
    case "running":
    case "forming":
    case "collecting":
    case "verifying":
    case "assigned":
    case "active":
    case "dispatched":
      return "running";
    case "blocked":
      return "blocked";
    case "failed":
      return "failed";
    case "cancelled":
    case "rejected":
      return "rejected";
    default:
      return "pending";
  }
}

export function assertLifecycleTransition(from: MultiAgentLifecycleStatus, to: MultiAgentLifecycleStatus): void {
  const allowed: Record<MultiAgentLifecycleStatus, MultiAgentLifecycleStatus[]> = {
    planned: ["forming", "running", "failed", "cancelled"],
    forming: ["running", "failed", "cancelled"],
    running: ["collecting", "completed", "failed", "cancelled"],
    collecting: ["verifying", "completed", "failed", "cancelled"],
    verifying: ["completed", "failed", "cancelled"],
    completed: [],
    failed: [],
    cancelled: []
  };
  if (from === to) return;
  if (!allowed[from].includes(to)) throw new Error(`Invalid MultiAgentRun lifecycle transition: ${from} -> ${to}`);
}

export function lifecycleEvent(
  from: string | undefined,
  to: string,
  reason?: string,
  actor = "cw",
  metadata?: Record<string, unknown>
): MultiAgentLifecycleEvent {
  return {
    at: new Date().toISOString(),
    from,
    to,
    actor,
    reason,
    metadata: compact(metadata)
  };
}

export function isMembershipReported(membership: AgentMembership): boolean {
  return (membership.status === "reported" || membership.status === "verified") && membership.evidenceRefs.length > 0;
}

export function touch<T extends { updatedAt: string }>(record: T): T {
  record.updatedAt = new Date().toISOString();
  return record;
}

// Deterministic record id — single source of truth in ./ids. Re-exported here so
// multi-agent.ts importers stay byte-unchanged (F10 dedup: the coordinator layer
// shares the exact same helper).
export { createId } from "./ids";

export function compact(value: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!value) return undefined;
  const entries = Object.entries(value).filter(([, entry]) => entry !== undefined);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

export function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

export function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const value = key(item);
    counts[value] = (counts[value] || 0) + 1;
  }
  return counts;
}

export function uniqueEdges(edges: GraphEdge[]): GraphEdge[] {
  const seen = new Set<string>();
  const result: GraphEdge[] = [];
  for (const edge of edges) {
    const key = `${edge.from}\0${edge.to}\0${edge.label || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(edge);
  }
  return result;
}
