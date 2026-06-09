"use strict";
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
exports.hostMultiAgentRun = hostMultiAgentRun;
exports.hostMultiAgentStatus = hostMultiAgentStatus;
exports.hostMultiAgentStep = hostMultiAgentStep;
exports.hostMultiAgentBlackboard = hostMultiAgentBlackboard;
exports.hostMultiAgentScore = hostMultiAgentScore;
exports.hostMultiAgentSelect = hostMultiAgentSelect;
const state_1 = require("../state");
const report_1 = require("./report");
const host = __importStar(require("../multi-agent-host"));
function hostMultiAgentRun(run, options = {}) {
    const response = host.hostRun(run, options);
    (0, report_1.writeReport)(run);
    (0, state_1.saveCheckpoint)(run);
    return response;
}
function hostMultiAgentStatus(run) {
    (0, report_1.writeReport)(run);
    return host.hostStatus(run);
}
function hostMultiAgentStep(run, options = {}) {
    const response = host.hostStep(run, options);
    (0, report_1.writeReport)(run);
    (0, state_1.saveCheckpoint)(run);
    return response;
}
function hostMultiAgentBlackboard(run, action, options = {}) {
    const response = host.hostBlackboard(run, action, options);
    (0, report_1.writeReport)(run);
    (0, state_1.saveCheckpoint)(run);
    return response;
}
function hostMultiAgentScore(run, options = {}) {
    const response = host.hostScore(run, options);
    (0, report_1.writeReport)(run);
    (0, state_1.saveCheckpoint)(run);
    return response;
}
function hostMultiAgentSelect(run, options = {}) {
    const response = host.hostSelect(run, options);
    (0, report_1.writeReport)(run);
    (0, state_1.saveCheckpoint)(run);
    return response;
}
