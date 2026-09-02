"use strict";
// core/state/schema.ts — the single field-list source for WorkflowRun.
//
// MILESTONE 3. Byte-exact port of the old build's run-state-schema module.
// Both migrations.ts's validation AND (eventually) a build gate derive
// their field knowledge from this module — a field added to WorkflowRun
// must be added here too.
//
// Evidence: SPEC/state-core.md "run-state-schema module — the single
// field-list source".
Object.defineProperty(exports, "__esModule", { value: true });
exports.OPTIONAL_TOP_LEVEL_KEYS = exports.REQUIRED_RECORD_KEYS = exports.REQUIRED_ARRAY_KEYS = exports.REQUIRED_TOP_LEVEL_KEYS = void 0;
/** Top-level required keys of WorkflowRun — every key that must exist
 *  after migration. */
exports.REQUIRED_TOP_LEVEL_KEYS = [
    "schemaVersion",
    "id",
    "createdAt",
    "updatedAt",
    "cwd",
    "workflow",
    "inputs",
    "loopStage",
    "phases",
    "tasks",
    "dispatches",
    "commits",
    "paths",
];
/** Top-level keys that must be arrays after migration. */
exports.REQUIRED_ARRAY_KEYS = ["phases", "tasks", "dispatches", "commits"];
/** Top-level keys that must be objects (Record) after migration. */
exports.REQUIRED_RECORD_KEYS = ["workflow", "paths", "multiAgent", "blackboard", "topologies"];
/** Keys from the WorkflowRun type that are OPTIONAL (exist at type level
 *  but are not required by validateMigratedRunState). */
exports.OPTIONAL_TOP_LEVEL_KEYS = [
    "nodes",
    "contracts",
    "feedback",
    "audit",
    "workers",
    "sandboxProfiles",
    "customSandboxProfiles",
    "candidates",
    "candidateSelections",
    "multiAgent",
    "blackboard",
    "topologies",
    "collaboration",
    "links",
    "appCode",
];
