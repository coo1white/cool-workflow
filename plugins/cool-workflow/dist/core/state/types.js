// core/state/types.ts — the state-kernel's own type set.
//
// Scoped to what state-core.md's public surface needs: WorkflowRun and
// everything it carries, StateNode + its snapshot/replay/diff family, the
// pipeline contract shape, and the small persisted-record shapes
// validation.ts guards. Subsystems add their OWN richer types under their
// own module. Optional subsystem state (multiAgent, blackboard, topologies,
// collaboration, workers, etc.) is typed loosely here (its own
// schemaVersion + array keys only) since normalizeRunState only ever fills
// defaults/shape-checks those fields.
//
// Pure types — no runtime cost, no imports beyond each other.
/** Do not soften this string: it is the whole point of the app-code
 *  honesty label (docs/workflow-app-framework.7.md). */
export const APP_CODE_EXECUTION_MODE = "in-process-unsandboxed";
