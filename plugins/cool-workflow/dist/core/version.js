"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MIN_SUPPORTED_RUN_STATE_SCHEMA_VERSION = exports.LEGACY_RUN_STATE_SCHEMA_VERSION = exports.CURRENT_RUN_STATE_SCHEMA_VERSION = exports.WORKFLOW_APP_SCHEMA_VERSION = exports.CURRENT_COOL_WORKFLOW_VERSION = void 0;
// core/version.ts — the one version string `cw version` prints.
//
// Pure. POLA: keep the exact same version marker the old build reports, so
// `cw version` output does not change bytes just because the code under it
// was rebuilt. See SPEC/cli-surface.md "Exact outputs > Version" and
// conformance/cases/version-basic.case.js (regex `/^\d+\.\d+\.\d+\n$/`).
exports.CURRENT_COOL_WORKFLOW_VERSION = "0.2.0";
// State-kernel schema version constants (SPEC/state-core.md "Version
// constants"). Pinned to the old build's src/version.ts byte-for-byte.
exports.WORKFLOW_APP_SCHEMA_VERSION = 1;
exports.CURRENT_RUN_STATE_SCHEMA_VERSION = 1;
exports.LEGACY_RUN_STATE_SCHEMA_VERSION = 0;
exports.MIN_SUPPORTED_RUN_STATE_SCHEMA_VERSION = 0;
