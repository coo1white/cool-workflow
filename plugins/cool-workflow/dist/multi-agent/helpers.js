"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MULTI_AGENT_SCHEMA_VERSION = void 0;
exports.indexRow = indexRow;
exports.assertNoRecordPathCollisions = assertNoRecordPathCollisions;
exports.pluralKind = pluralKind;
exports.statusToNodeStatus = statusToNodeStatus;
exports.assertLifecycleTransition = assertLifecycleTransition;
exports.lifecycleEvent = lifecycleEvent;
exports.isMembershipReported = isMembershipReported;
exports.touch = touch;
exports.createId = createId;
exports.compact = compact;
exports.unique = unique;
exports.countBy = countBy;
exports.uniqueEdges = uniqueEdges;
const state_1 = require("../state");
exports.MULTI_AGENT_SCHEMA_VERSION = 1;
function indexRow(record) {
    return { id: record.id, status: record.status, updatedAt: record.updatedAt };
}
function assertNoRecordPathCollisions(label, records) {
    const seen = new Map();
    for (const record of records) {
        const safe = (0, state_1.safeFileName)(record.id);
        const existing = seen.get(safe);
        if (existing && existing !== record.id) {
            throw new Error(`${label} ids ${existing} and ${record.id} collide on safe file name ${safe}`);
        }
        seen.set(safe, record.id);
    }
}
function pluralKind(kind) {
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
function statusToNodeStatus(status) {
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
function assertLifecycleTransition(from, to) {
    const allowed = {
        planned: ["forming", "running", "failed", "cancelled"],
        forming: ["running", "failed", "cancelled"],
        running: ["collecting", "completed", "failed", "cancelled"],
        collecting: ["verifying", "completed", "failed", "cancelled"],
        verifying: ["completed", "failed", "cancelled"],
        completed: [],
        failed: [],
        cancelled: []
    };
    if (from === to)
        return;
    if (!allowed[from].includes(to))
        throw new Error(`Invalid MultiAgentRun lifecycle transition: ${from} -> ${to}`);
}
function lifecycleEvent(from, to, reason, actor = "cw", metadata) {
    return {
        at: new Date().toISOString(),
        from,
        to,
        actor,
        reason,
        metadata: compact(metadata)
    };
}
function isMembershipReported(membership) {
    return (membership.status === "reported" || membership.status === "verified") && membership.evidenceRefs.length > 0;
}
function touch(record) {
    record.updatedAt = new Date().toISOString();
    return record;
}
// Deterministic record id (FreeBSD-audit L12/L13): the record's POSITION in its
// per-run collection, threaded from the call site. No wall-clock stamp, no PRNG
// suffix — re-running the same multi-agent topology mints byte-identical ids, so
// snapshot/replay digests match. Each call site already asserts the minted id is
// unique within its collection, and these collections only ever append.
function createId(prefix, seq) {
    return `${prefix}-${String(seq).padStart(4, "0")}`;
}
function compact(value) {
    if (!value)
        return undefined;
    const entries = Object.entries(value).filter(([, entry]) => entry !== undefined);
    return entries.length ? Object.fromEntries(entries) : undefined;
}
function unique(values) {
    return Array.from(new Set(values.filter(Boolean))).sort();
}
function countBy(items, key) {
    const counts = {};
    for (const item of items) {
        const value = key(item);
        counts[value] = (counts[value] || 0) + 1;
    }
    return counts;
}
function uniqueEdges(edges) {
    const seen = new Set();
    const result = [];
    for (const edge of edges) {
        const key = `${edge.from}\0${edge.to}\0${edge.label || ""}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        result.push(edge);
    }
    return result;
}
