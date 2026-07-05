"use strict";
// core/state/types.ts — the state-kernel's own type set.
//
// MILESTONE 3 (docs/rebuild/PLAN.md build order, step 3). Scoped to exactly what
// state-core.md's public surface needs: WorkflowRun and everything it
// carries, StateNode + its snapshot/replay/diff family, the pipeline
// contract shape, and the small persisted-record shapes validation.ts
// guards. Later milestones (multi-agent, blackboard, topology, worker,
// candidate, trust) add their OWN richer types under their own module —
// this file only carries the FIELD SET this milestone's schema/migration/
// node-lifecycle/snapshot code actually reads or writes, ported from the
// old build's src/types/*.ts. Optional subsystem state (multiAgent,
// blackboard, topologies, collaboration, workers, etc.) is typed loosely
// here (its own schemaVersion + array keys only) since normalizeRunState
// only ever fills defaults/shape-checks those fields at this milestone;
// the richer per-record shapes land with their owning milestone.
//
// Pure types — no runtime cost, no imports beyond each other.
Object.defineProperty(exports, "__esModule", { value: true });
