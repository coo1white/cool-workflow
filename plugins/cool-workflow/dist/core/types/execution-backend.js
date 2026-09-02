"use strict";
// core/types/execution-backend.ts — plain data shapes for the driver layer.
//
// MILESTONE 5 (PLAN.md (project/docs/rebuild) build order, step 5). Byte-exact port of the shapes
// in the old build's execution-backend types module and the sandbox slice of
// sandbox types module that this subsystem needs. Types only — no logic —
// so this file lives in core/ (moved here from shell/execution-backend/
// types.ts, which now re-exports it for its 7 existing importers): the
// executor-boundary welds in core/types/boundary.ts need ResultEnvelope
// and ExecutionResultEnvelope, and neither can be cherry-picked out of
// this file alone without also carrying their whole dependency graph
// (ExecutionProvenance, SandboxAttestation, BackendLocality/BackendKind,
// BackendExecutionHandle, ...) — so the file moves as one piece, matching
// its own original header's claim that it was "safe to import from both
// shell/ (impure) and any future core/ caller."
//
// Evidence: SPEC/execution-backend.md.
Object.defineProperty(exports, "__esModule", { value: true });
