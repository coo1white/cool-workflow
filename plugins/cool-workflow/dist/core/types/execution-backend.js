// core/types/execution-backend.ts — plain data shapes for the driver layer.
//
// Types only — no logic — so this file lives in core/
// (shell/execution-backend/types.ts re-exports it for its importers): the
// executor-boundary welds in core/types/boundary.ts need ResultEnvelope
// and ExecutionResultEnvelope, and neither can be cherry-picked out of
// this file alone without also carrying their whole dependency graph
// (ExecutionProvenance, SandboxAttestation, BackendLocality/BackendKind,
// BackendExecutionHandle, ...), so the file stays one piece.
//
// Evidence: SPEC/execution-backend.md.
export {};
