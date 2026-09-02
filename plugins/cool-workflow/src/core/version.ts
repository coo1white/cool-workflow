// core/version.ts — the one version string `cw version` prints.
//
// Pure. POLA: keep the exact same version marker the old build reports, so
// `cw version` output does not change bytes just because the code under it
// was rebuilt. See SPEC/cli-surface.md "Exact outputs > Version" and
// conformance/cases/version-basic.case.js (regex `/^\d+\.\d+\.\d+\n$/`).
export const CURRENT_COOL_WORKFLOW_VERSION = "0.2.7";

// State-kernel schema version constants (SPEC/state-core.md "Version
// constants"). Pinned to the old build's version module byte-for-byte.
export const WORKFLOW_APP_SCHEMA_VERSION = 1;
export const CURRENT_RUN_STATE_SCHEMA_VERSION = 1;
export const LEGACY_RUN_STATE_SCHEMA_VERSION = 0;
export const MIN_SUPPORTED_RUN_STATE_SCHEMA_VERSION = 0;
