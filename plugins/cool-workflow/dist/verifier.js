"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertTaskCanComplete = assertTaskCanComplete;
exports.parseResultEnvelope = parseResultEnvelope;
exports.taskRequiresEvidence = taskRequiresEvidence;
exports.validateResultEnvelope = validateResultEnvelope;
exports.validateRunGates = validateRunGates;
const dispatch_1 = require("./dispatch");
const evidence_grounding_1 = require("./evidence-grounding");
function assertTaskCanComplete(run, task) {
    const runnablePhase = (0, dispatch_1.firstRunnablePhase)(run);
    if (!runnablePhase || runnablePhase.name !== task.phase) {
        throw new Error(`Phase gate blocked task ${task.id}; current runnable phase is ${runnablePhase?.name || "none"}`);
    }
    if (!["pending", "running"].includes(task.status)) {
        throw new Error(`Task ${task.id} cannot be completed from status ${task.status}`);
    }
}
function parseResultEnvelope(markdown) {
    const match = markdown.match(/```cw:result\s*([\s\S]*?)```/);
    if (!match) {
        return {
            summary: firstNonEmptyLine(markdown),
            findings: [],
            evidence: []
        };
    }
    try {
        const parsed = JSON.parse(match[1]);
        return {
            summary: parsed.summary || firstNonEmptyLine(markdown),
            findings: Array.isArray(parsed.findings) ? parsed.findings : [],
            evidence: Array.isArray(parsed.evidence) ? parsed.evidence : []
        };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Invalid cw:result JSON: ${message}`);
    }
}
/** Whether a task's result MUST carry evidence (verify/verdict/synthesis tasks
 *  and any task that opted in via requiresEvidence). The commit gate reuses this
 *  so its evidence-grounding check matches the acceptance-time policy exactly. */
function taskRequiresEvidence(task) {
    return Boolean(task.requiresEvidence ||
        /^verify[:/]/i.test(task.id) ||
        /^verdict[:/]/i.test(task.id) ||
        /^synthesis[:/]/i.test(task.id));
}
function validateResultEnvelope(task, result) {
    const mustHaveEvidence = taskRequiresEvidence(task);
    if (mustHaveEvidence && !(0, evidence_grounding_1.hasGroundedEvidence)(result.evidence)) {
        throw new Error(`Task ${task.id} requires grounded cw:result evidence (a path-like locator, URL, or namespace:value token — not free text)`);
    }
    for (const finding of result.findings || []) {
        validateFinding(task, finding);
    }
}
function validateRunGates(run) {
    const verdictTasks = run.tasks.filter((task) => /^verdict[:/]|^synthesis[:/]/i.test(task.id));
    for (const verdictTask of verdictTasks) {
        if (verdictTask.status !== "completed")
            continue;
        const verdictPhaseIndex = run.phases.findIndex((phase) => phase.name === verdictTask.phase);
        const earlierPhases = run.phases.slice(0, verdictPhaseIndex);
        const incompleteEarlier = earlierPhases.find((phase) => phase.status !== "completed");
        if (incompleteEarlier) {
            throw new Error(`Verdict gate blocked ${verdictTask.id}; phase ${incompleteEarlier.name} is not complete`);
        }
    }
}
function validateFinding(task, finding) {
    if (!finding.id)
        throw new Error(`Task ${task.id} has a finding without id`);
    if (finding.classification &&
        !["real", "conditional", "non-issue", "unknown"].includes(finding.classification)) {
        throw new Error(`Task ${task.id} finding ${finding.id} has invalid classification`);
    }
    if (["P0", "P1", "P2"].includes(finding.severity || "") && !(0, evidence_grounding_1.hasGroundedEvidence)(finding.evidence)) {
        throw new Error(`Task ${task.id} finding ${finding.id} severity ${finding.severity} requires grounded evidence (a path-like locator, URL, or namespace:value token)`);
    }
}
function firstNonEmptyLine(markdown) {
    return (markdown
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line && !line.startsWith("#")) || "");
}
