"use strict";
// shell/exec-backend-cli.ts — CLI/MCP-reachable bodies for the execution-
// backend + sandbox-profile capability rows (backend.list|show|probe,
// backend.agent.config.show|set, sandbox.list|show|validate).
//
// MILESTONE 5. Byte-exact port of the old build's orchestrator methods
// (listSandboxProfiles/showSandboxProfile/
// validateSandboxProfile/listBackends/showBackend/probeBackend) plus
// cli operational-handler module's handleSandbox/handleBackend argv
// shape. Impure (fs/env) — this is the shell layer the capability-table's
// CLI/MCP handlers delegate to.
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
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.backendAgentConfigShow = exports.backendAgentConfigSet = void 0;
exports.listSandboxProfilesCli = listSandboxProfilesCli;
exports.showSandboxProfileCli = showSandboxProfileCli;
exports.validateSandboxProfileCli = validateSandboxProfileCli;
exports.listBackendsCli = listBackendsCli;
exports.showBackendCli = showBackendCli;
exports.probeBackendCli = probeBackendCli;
const path = __importStar(require("node:path"));
const registry_1 = require("./execution-backend/registry");
const sandbox_profile_1 = require("./sandbox-profile");
const agent_config_1 = require("./agent-config");
Object.defineProperty(exports, "backendAgentConfigSet", { enumerable: true, get: function () { return agent_config_1.backendAgentConfigSet; } });
Object.defineProperty(exports, "backendAgentConfigShow", { enumerable: true, get: function () { return agent_config_1.backendAgentConfigShow; } });
function resolveCwd(options) {
    return path.resolve(String(options.cwd || process.cwd()));
}
function resolveFromBase(target, options) {
    return path.resolve(resolveCwd(options), target);
}
// ---------------------------------------------------------------------
// sandbox.list | sandbox.show | sandbox.validate
// ---------------------------------------------------------------------
function listSandboxProfilesCli(options = {}) {
    return (0, sandbox_profile_1.listBundledSandboxProfiles)((0, sandbox_profile_1.sandboxContextForValidation)(resolveCwd(options)));
}
function showSandboxProfileCli(profileId, options = {}) {
    return (0, sandbox_profile_1.showBundledSandboxProfile)(profileId, (0, sandbox_profile_1.sandboxContextForValidation)(resolveCwd(options)));
}
function validateSandboxProfileCli(profileFile, options = {}) {
    return (0, sandbox_profile_1.validateSandboxProfileFile)(resolveFromBase(profileFile, options), (0, sandbox_profile_1.sandboxContextForValidation)(resolveCwd(options)));
}
// ---------------------------------------------------------------------
// backend.list | backend.show | backend.probe
// ---------------------------------------------------------------------
function listBackendsCli() {
    return (0, registry_1.backendListPayload)();
}
function showBackendCli(backendId) {
    return (0, registry_1.backendShowPayload)(backendId);
}
function probeBackendCli(backendId, options = {}) {
    return (0, registry_1.backendProbePayload)(backendId, { cwd: resolveCwd(options) });
}
