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
exports.listTopologies = listTopologies;
exports.showTopology = showTopology;
exports.validateTopology = validateTopology;
exports.applyTopology = applyTopology;
exports.showTopologyRun = showTopologyRun;
exports.topologySummary = topologySummary;
exports.topologyGraph = topologyGraph;
const state_1 = require("../state");
const report_1 = require("./report");
const cli_options_1 = require("./cli-options");
const topo = __importStar(require("../topology"));
function listTopologies() {
    return topo.listTopologyDefinitions();
}
function showTopology(topologyId) {
    const definition = topo.getTopologyDefinition(topologyId);
    if (!definition)
        throw new Error(`Unknown topology id: ${topologyId}`);
    return definition;
}
function validateTopology(topologyId) {
    return topo.validateTopologyDefinition(topologyId);
}
function applyTopology(run, topologyId, options = {}) {
    const record = topo.applyTopology(run, topologyId, {
        id: (0, cli_options_1.stringOption)(options.id),
        title: (0, cli_options_1.stringOption)(options.title),
        multiAgentRunId: (0, cli_options_1.stringOption)(options.multiAgentRun || options.multiAgentRunId || options["multi-agent-run"]),
        blackboardId: (0, cli_options_1.stringOption)(options.blackboard || options.blackboardId),
        taskIds: (0, cli_options_1.arrayOption)(options.task || options.taskId || options.tasks).map(String),
        mapperCount: (0, cli_options_1.numberOption)(options.mapperCount || options["mapper-count"] || options.mappers || options.mapper),
        judgeCount: (0, cli_options_1.numberOption)(options.judgeCount || options["judge-count"] || options.judges || options.judge),
        debateRounds: (0, cli_options_1.numberOption)(options.debateRounds || options["debate-rounds"] || options.rounds),
        collectInitialFanin: Boolean(options.collectInitialFanin || options["collect-initial-fanin"]),
        metadata: (0, cli_options_1.metadataOption)(options)
    });
    (0, report_1.writeReport)(run);
    (0, state_1.saveCheckpoint)(run);
    return record;
}
function showTopologyRun(run, topologyRunId) {
    return topo.showTopologyRun(run, topologyRunId);
}
function topologySummary(run) {
    return topo.summarizeTopologies(run);
}
function topologyGraph(run) {
    return topo.buildTopologyGraph(run);
}
