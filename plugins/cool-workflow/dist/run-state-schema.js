"use strict";
// Run-State Schema — the SINGLE source of truth for WorkflowRun field requirements.
//
// BSD discipline:
//  - ONE SOURCE. Both the TypeScript types AND the migration/validation functions
//    derive their field knowledge from this module. If a field is added to
//    WorkflowRun, it MUST be added here — the `validate-run-state-schema.js`
//    build gate enforces this, fail-closed.
//  - MECHANISM, NOT POLICY. This module declares WHAT fields exist. How they are
//    normalized/validated is policy in state-migrations.ts.
//  - FAIL CLOSED. A field in REQUIRED_TOP_LEVEL_KEYS that is not checked by
//    validateMigratedRunState() blocks the build. A field in WorkflowRun that
//    is not listed here blocks the build.
//
// From v0.1.53: replaces the hardcoded key arrays in state-migrations.ts.
Object.defineProperty(exports, "__esModule", { value: true });
exports.OPTIONAL_TOP_LEVEL_KEYS = exports.REQUIRED_RECORD_KEYS = exports.REQUIRED_ARRAY_KEYS = exports.REQUIRED_TOP_LEVEL_KEYS = void 0;
/** Top-level required keys of WorkflowRun — every key that must exist after
 *  migration, matched against the TypeScript interface by the build gate. */
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
    "paths"
];
/** Top-level keys that must be non-empty arrays after migration. */
exports.REQUIRED_ARRAY_KEYS = [
    "phases",
    "tasks",
    "dispatches",
    "commits"
];
/** Top-level keys that must be objects (Record) after migration. */
exports.REQUIRED_RECORD_KEYS = [
    "workflow",
    "paths",
    "multiAgent",
    "blackboard",
    "topologies"
];
/** Keys from the WorkflowRun type that are OPTIONAL (exist at type level but
 *  are not required by validateMigratedRunState). The build gate uses this
 *  to distinguish "required by type but missing from migration" vs "intentionally
 *  optional". */
exports.OPTIONAL_TOP_LEVEL_KEYS = [
    "nodes",
    "contracts",
    "feedback",
    "audit",
    "workers",
    "sandboxProfiles",
    "candidates",
    "candidateSelections",
    "multiAgent",
    "blackboard",
    "topologies",
    "collaboration"
];
