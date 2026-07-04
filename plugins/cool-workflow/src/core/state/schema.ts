// core/state/schema.ts — the single field-list source for WorkflowRun.
//
// MILESTONE 3. Byte-exact port of the old build's src/run-state-schema.ts.
// Both migrations.ts's validation AND (eventually) a build gate derive
// their field knowledge from this module — a field added to WorkflowRun
// must be added here too.
//
// Evidence: SPEC/state-core.md "src/run-state-schema.ts — the single
// field-list source".

/** Top-level required keys of WorkflowRun — every key that must exist
 *  after migration. */
export const REQUIRED_TOP_LEVEL_KEYS: readonly string[] = [
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
export const REQUIRED_ARRAY_KEYS: readonly string[] = ["phases", "tasks", "dispatches", "commits"];

/** Top-level keys that must be objects (Record) after migration. */
export const REQUIRED_RECORD_KEYS: readonly string[] = ["workflow", "paths", "multiAgent", "blackboard", "topologies"];

/** Keys from the WorkflowRun type that are OPTIONAL (exist at type level
 *  but are not required by validateMigratedRunState). */
export const OPTIONAL_TOP_LEVEL_KEYS: readonly string[] = [
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
];
