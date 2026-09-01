"use strict";
// wiring/capability-table/index.ts — composes the capability table from
// registry-core (the shared machinery) plus every domain slice, in the
// EXACT original source order (REGISTRY array order is a pinned
// behavior: tools/list order, gen-parity-doc's byte-diff gate, cw help
// line order). Each slice is a plain module whose top-level
// attachCliBinding/addCliOnlyCapability/REGISTRY_BY_CAPABILITY calls run
// once, at first import — Node's module system guarantees that happens
// in exactly the order these imports are written below, the same
// guarantee the single original file relied on for its own top-to-bottom
// statement order.
//
// No slice imports another slice; every slice imports only from
// registry-core.ts, core/capability-data.ts, and shell/core as needed —
// so this file is the only place the full domain list is assembled, and
// there is no cross-slice circular dependency to reason about.
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
__exportStar(require("./registry-core"), exports);
require("./basics");
require("./state");
require("./exec-backend");
require("./pipeline");
require("./trust-ledger");
require("./multi-agent");
require("./scheduling-registry");
require("./reporting");
require("./workflow-apps");
require("./bands");
__exportStar(require("./parity"), exports);
