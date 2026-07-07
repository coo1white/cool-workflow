"use strict";
// core/capability-table.ts — re-export shim.
//
// The full capability table (the shared machinery + every domain slice)
// now lives under wiring/capability-table/ (see that directory's index.ts
// for the composition order — REGISTRY order is a pinned behavior). This
// file stays so every existing import site (cli/dispatch.ts,
// mcp/dispatch.ts, shell/workbench.ts, the captable-*.test.js unit tests,
// scripts/parity-check.js, scripts/gen-parity-doc.js) keeps working
// unchanged, whether they import a value (REGISTRY, findCapability,
// CAPABILITY_REGISTRY, ...) or a pure type (Capability, CliBinding, ...).
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CapabilityNotImplementedError = void 0;
__exportStar(require("../wiring/capability-table"), exports);
var capability_data_1 = require("./capability-data");
Object.defineProperty(exports, "CapabilityNotImplementedError", { enumerable: true, get: function () { return capability_data_1.CapabilityNotImplementedError; } });
