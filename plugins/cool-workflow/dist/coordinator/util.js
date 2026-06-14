"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.checksumFile = checksumFile;
exports.assertUnique = assertUnique;
exports.assertNoRecordPathCollisions = assertNoRecordPathCollisions;
exports.indexRow = indexRow;
exports.compareRecords = compareRecords;
exports.uniqueEdges = uniqueEdges;
exports.createId = createId;
exports.touch = touch;
exports.timestamp = timestamp;
exports.unique = unique;
exports.sortTags = sortTags;
exports.truncate = truncate;
exports.compact = compact;
exports.scrub = scrub;
// Pure, self-contained primitive helpers for the coordinator/blackboard layer
// (FreeBSD-audit R-carve). Carved out of coordinator.ts so the module no longer
// bundles the generic id/string/redaction utilities alongside the stateful
// blackboard operations. Re-exported from coordinator.ts to keep the public
// surface byte-identical.
//
// BEHAVIOR-PRESERVING — pure code movement, zero logic change. Every function
// here is a function of its inputs only: no WorkflowRun, no blackboard state, no
// filesystem mutation. They depend on node:crypto / node:fs only for checksum +
// file read, and on ./compare + ./state for the byte comparator and safe file
// name (the same helpers the originals used).
const node_crypto_1 = __importDefault(require("node:crypto"));
const node_fs_1 = __importDefault(require("node:fs"));
const compare_1 = require("../compare");
const state_1 = require("../state");
function checksumFile(file) {
    return `sha256:${node_crypto_1.default.createHash("sha256").update(node_fs_1.default.readFileSync(file)).digest("hex")}`;
}
function assertUnique(items, id, label) {
    if (items.some((item) => item.id === id))
        throw new Error(`Duplicate ${label} id: ${id}`);
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
function indexRow(record) {
    return { id: record.id, blackboardId: record.blackboardId, topicId: record.topicId, status: record.status, updatedAt: record.updatedAt };
}
function compareRecords(left, right) {
    return (0, compare_1.compareBytes)(left.createdAt, right.createdAt) || (0, compare_1.compareBytes)(left.id, right.id);
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
// Deterministic record id (FreeBSD-audit L12/L13): the record's POSITION in its
// per-run blackboard collection, threaded from the call site. No wall-clock stamp,
// no PRNG suffix — replaying the same coordination mints byte-identical ids, so
// snapshot/replay digests match. Each call site already asserts the minted id is
// unique within its collection, and these collections only ever append.
function createId(prefix, seq) {
    return `${prefix}-${String(seq).padStart(4, "0")}`;
}
function touch(record) {
    record.updatedAt = timestamp();
    return record;
}
function timestamp() {
    return new Date().toISOString();
}
function unique(values) {
    return Array.from(new Set(values.filter(Boolean))).sort();
}
function sortTags(values) {
    return unique(values || []);
}
function truncate(value) {
    return value.length > 64 ? `${value.slice(0, 61)}...` : value;
}
function compact(value) {
    return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined && (!Array.isArray(entry) || entry.length > 0)));
}
// Recursive secret redaction (v0.1.40 self-audit P3): the previous scrub only
// inspected TOP-LEVEL keys, so a secret nested under an allowed key
// (e.g. `metadata.config.token`) leaked into the recorded coordinator decision.
// Now we recurse into nested objects and arrays so a secret-named key at any depth
// is dropped and an obvious credential value is redacted.
const SECRET_KEY_RE = /secret|token|password|credential|authorization|api[_-]?key|env/i;
const SECRET_VALUE_RE = /secret|token|password|credential/i;
function scrubValue(value) {
    if (Array.isArray(value))
        return value.map(scrubValue);
    if (value && typeof value === "object")
        return scrub(value);
    if (typeof value === "string" && SECRET_VALUE_RE.test(value))
        return "[redacted]";
    return value;
}
function scrub(value) {
    if (!value)
        return undefined;
    const result = {};
    for (const [key, entry] of Object.entries(value)) {
        if (entry === undefined)
            continue;
        if (SECRET_KEY_RE.test(key)) {
            result[key] = "[redacted]";
        }
        else {
            result[key] = scrubValue(entry);
        }
    }
    return Object.keys(result).length ? result : undefined;
}
