"use strict";
// shell/execution-backend/types.ts — plain data shapes for the driver layer.
//
// MILESTONE 5 (v2/PLAN.md build order, step 5). Byte-exact port of the shapes
// in the old build's src/types/execution-backend.ts and the sandbox slice of
// src/types/sandbox.ts that this subsystem needs. Types only — no logic — so
// this file is safe to import from both shell/ (impure) and any future core/
// caller without violating the core/shell purity split.
//
// Evidence: SPEC/execution-backend.md.
Object.defineProperty(exports, "__esModule", { value: true });
