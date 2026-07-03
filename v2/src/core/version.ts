// core/version.ts — the one version string `cw version` prints.
//
// Pure. POLA: keep the exact same version marker the old build reports, so
// `cw version` output does not change bytes just because the code under it
// was rebuilt. See SPEC/cli-surface.md "Exact outputs > Version" and
// conformance/cases/version-basic.case.js (regex `/^\d+\.\d+\.\d+\n$/`).
export const CURRENT_COOL_WORKFLOW_VERSION = "0.1.98";
