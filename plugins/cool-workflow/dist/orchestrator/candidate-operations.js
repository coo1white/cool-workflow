"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.listCandidates = listCandidates;
exports.showCandidate = showCandidate;
exports.registerCandidate = registerCandidate;
exports.scoreCandidate = scoreCandidate;
exports.rankCandidates = rankCandidates;
exports.selectCandidate = selectCandidate;
exports.rejectCandidate = rejectCandidate;
// Candidate domain operations (v0.1.40 self-audit P3 router pattern).
// Carved out of CoolWorkflowRunner; each function takes a loaded run. Behavior is
// identical to the inline implementations — only the location changed.
const node_path_1 = __importDefault(require("node:path"));
const state_1 = require("../state");
const report_1 = require("./report");
const cli_options_1 = require("./cli-options");
const worker_isolation_1 = require("../worker-isolation");
const candidate_scoring_1 = require("../candidate-scoring");
function listCandidates(run, options = {}) {
    return (0, candidate_scoring_1.listCandidates)(run, {
        status: options.status ? String(options.status) : undefined,
        kind: options.kind ? String(options.kind) : undefined
    });
}
function showCandidate(run, candidateId) {
    const candidate = (0, candidate_scoring_1.getCandidate)(run, candidateId);
    if (!candidate)
        throw new Error(`Unknown candidate id for run ${run.id}: ${candidateId}`);
    return candidate;
}
function registerCandidate(run, options = {}) {
    const workerId = options.worker ? String(options.worker) : undefined;
    const worker = workerId ? (0, worker_isolation_1.getWorkerScope)(run, workerId) : undefined;
    if (workerId && !worker)
        throw new Error(`Unknown worker id for run ${run.id}: ${workerId}`);
    const task = worker ? run.tasks.find((candidate) => candidate.id === worker.taskId) : undefined;
    const resultNodeId = (0, cli_options_1.stringOption)(options.resultNode) || worker?.resultNodeId || task?.resultNodeId;
    const verifierNodeId = (0, cli_options_1.stringOption)(options.verifierNode) || worker?.output?.verifierNodeId || task?.verifierNodeId;
    const resultPath = (0, cli_options_1.stringOption)(options.resultPath) || worker?.output?.resultPath || task?.resultPath;
    const resultNode = resultNodeId ? run.nodes?.find((node) => node.id === resultNodeId) : undefined;
    const verifierNode = verifierNodeId ? run.nodes?.find((node) => node.id === verifierNodeId) : undefined;
    const candidate = (0, candidate_scoring_1.registerCandidate)(run, {
        id: (0, cli_options_1.stringOption)(options.id),
        kind: (0, cli_options_1.stringOption)(options.kind),
        workerId,
        taskId: (0, cli_options_1.stringOption)(options.task) || worker?.taskId,
        resultNodeId,
        verifierNodeId,
        resultPath,
        artifacts: [
            ...(resultPath ? [{ id: "result", kind: "markdown", path: node_path_1.default.resolve(resultPath) }] : []),
            ...(worker ? [{ id: "worker", kind: "json", path: node_path_1.default.join(worker.workerDir, "worker.json") }] : [])
        ],
        evidence: (0, cli_options_1.mergeEvidence)(resultNode?.evidence || [], verifierNode?.evidence || []),
        metadata: {
            source: worker ? "worker" : "manual",
            workerDir: worker?.workerDir
        }
    }, { persist: false });
    (0, report_1.writeReport)(run);
    (0, state_1.saveCheckpoint)(run);
    return candidate;
}
function scoreCandidate(run, candidateId, options = {}) {
    const score = (0, candidate_scoring_1.scoreCandidate)(run, candidateId, {
        id: (0, cli_options_1.stringOption)(options.id),
        scorer: (0, cli_options_1.stringOption)(options.scorer),
        criteria: (0, cli_options_1.parseCriteria)(options),
        maxTotal: (0, cli_options_1.numberOption)(options.maxTotal || options.max),
        verdict: (0, cli_options_1.stringOption)(options.verdict),
        evidence: (0, cli_options_1.parseEvidence)(options.evidence),
        notes: (0, cli_options_1.stringOption)(options.notes)
    }, { persist: false });
    (0, report_1.writeReport)(run);
    (0, state_1.saveCheckpoint)(run);
    return score;
}
function rankCandidates(run, options = {}) {
    const ranking = (0, candidate_scoring_1.rankCandidates)(run, {
        includeRejected: Boolean(options.includeRejected),
        policy: {
            minNormalized: (0, cli_options_1.numberOption)(options.minNormalized),
            requireEvidence: options.requireEvidence === undefined ? undefined : Boolean(options.requireEvidence),
            requireVerifierGate: options.requireVerifierGate === undefined ? undefined : Boolean(options.requireVerifierGate),
            tieBreaker: (0, cli_options_1.stringOption)(options.tieBreaker)
        }
    });
    (0, report_1.writeReport)(run);
    (0, state_1.saveCheckpoint)(run);
    return ranking;
}
function selectCandidate(run, candidateId, options = {}) {
    const selection = (0, candidate_scoring_1.selectCandidate)(run, candidateId, {
        selectedBy: (0, cli_options_1.stringOption)(options.by) || (0, cli_options_1.stringOption)(options.selectedBy),
        reason: (0, cli_options_1.stringOption)(options.reason),
        scoreId: (0, cli_options_1.stringOption)(options.score),
        allowUnverified: Boolean(options.allowUnverified)
    }, {
        persist: false,
        policy: {
            minNormalized: (0, cli_options_1.numberOption)(options.minNormalized),
            requireVerifierGate: options.requireVerifierGate === undefined ? undefined : Boolean(options.requireVerifierGate)
        }
    });
    (0, report_1.writeReport)(run);
    (0, state_1.saveCheckpoint)(run);
    return selection;
}
function rejectCandidate(run, candidateId, reason) {
    const candidate = (0, candidate_scoring_1.rejectCandidate)(run, candidateId, reason, { persist: false });
    (0, report_1.writeReport)(run);
    (0, state_1.saveCheckpoint)(run);
    return candidate;
}
