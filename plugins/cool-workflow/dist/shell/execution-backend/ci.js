"use strict";
// shell/execution-backend/ci.ts — the ci delegating driver.
//
// The ci driver shares its entire HTTP-delegation body with the remote
// driver (`runHttpDelegation`); this file just re-exports the ci handle
// builder + the shared delegation runner under the ci-specific name so the
// registry's driver table reads naturally (one module per driver id).
Object.defineProperty(exports, "__esModule", { value: true });
exports.runCiDelegation = exports.ciHandle = void 0;
var remote_1 = require("./remote");
Object.defineProperty(exports, "ciHandle", { enumerable: true, get: function () { return remote_1.ciHandle; } });
Object.defineProperty(exports, "runCiDelegation", { enumerable: true, get: function () { return remote_1.runHttpDelegation; } });
