"use strict";
// shell/execution-backend/ci.ts — the ci delegating driver.
//
// MILESTONE 5 (PLAN.md (project/docs/rebuild) build order, step 5). The ci driver shares its
// entire HTTP-delegation body with the remote driver (byte-exact port of
// the old build's execution-backend module, which also shares
// `runHttpDelegation` between the two); this file just re-exports the ci
// handle builder + the shared delegation runner under the ci-specific name
// so the registry's driver table reads naturally (one module per driver id,
// per PLAN.md's target shape `container.ts, remote.ts, ci.ts`).
Object.defineProperty(exports, "__esModule", { value: true });
exports.runCiDelegation = exports.ciHandle = void 0;
var remote_1 = require("./remote");
Object.defineProperty(exports, "ciHandle", { enumerable: true, get: function () { return remote_1.ciHandle; } });
Object.defineProperty(exports, "runCiDelegation", { enumerable: true, get: function () { return remote_1.runHttpDelegation; } });
