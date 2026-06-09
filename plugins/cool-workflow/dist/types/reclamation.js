"use strict";
// Run Retention & Provable Reclamation (v0.1.39) — type contracts.
//
// Reclamation frees disk WITHOUT violating the audit/replay moat. It is a
// VERIFIABLE, append-only state transition: freeing bytes leaves behind a
// hash-chained tombstone proving what was freed is reconstructable-or-worthless
// and that the audit-essential subset is sealed. See docs/run-retention-reclamation.7.md.
Object.defineProperty(exports, "__esModule", { value: true });
