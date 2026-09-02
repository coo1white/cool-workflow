"use strict";
// shell/verifier.ts — taskRequiresEvidence, the small task-level gate the
// worker-accept path and the commit gate both consult.
//
// MILESTONE 6+7 (combined). Byte-exact port of the old build's
// verifier module's `taskRequiresEvidence`. Pure logic; kept under
// shell/ only because its caller (worker-isolation.ts) is shell-side —
// the function itself takes no fs/clock/random input.
//
// Evidence: SPEC/pipeline-run.md "Commit gate" (verifierNodeRequiresEvidence
// reuses this exact predicate).
Object.defineProperty(exports, "__esModule", { value: true });
exports.taskRequiresEvidence = taskRequiresEvidence;
exports.validateResultEnvelope = validateResultEnvelope;
const evidence_grounding_1 = require("../core/trust/evidence-grounding");
const schema_validate_1 = require("../core/state/schema-validate");
function taskRequiresEvidence(task) {
    return Boolean(task.requiresEvidence || /^verify[:/]/i.test(task.id) || /^verdict[:/]/i.test(task.id) || /^synthesis[:/]/i.test(task.id));
}
function validateFinding(task, finding) {
    if (!finding.id)
        throw new Error(`Task ${task.id} has a finding without id`);
    if (finding.classification && !["real", "conditional", "non-issue", "unknown"].includes(finding.classification)) {
        throw new Error(`Task ${task.id} finding ${finding.id} has invalid classification`);
    }
    if (["P0", "P1", "P2"].includes(finding.severity || "") && !(0, evidence_grounding_1.hasGroundedEvidence)(finding.evidence)) {
        throw new Error(`Task ${task.id} finding ${finding.id} severity ${finding.severity} requires grounded evidence (a path-like locator, URL, or namespace:value token)`);
    }
}
/** Validate an accepted result envelope against the task's declared contract:
 *  required grounded evidence, per-finding shape, and (opt-in) the task's
 *  declared output schema. Throws on violation (fail-closed — the drive parks
 *  the hop). Byte-behavior port of the old build's verifier module. */
function validateResultEnvelope(task, result) {
    if (taskRequiresEvidence(task) && !(0, evidence_grounding_1.hasGroundedEvidence)(result.evidence)) {
        throw new Error(`Task ${task.id} requires grounded cw:result evidence (a path-like locator, URL, or namespace:value token — not free text)`);
    }
    for (const finding of result.findings || []) {
        validateFinding(task, finding);
    }
    const schema = task.schema;
    if (schema) {
        const violations = (0, schema_validate_1.validateAgainstSchema)(result, schema);
        if (violations.length) {
            throw new Error(`Task ${task.id} result violates declared schema: ${violations.slice(0, 5).join("; ")}${violations.length > 5 ? ` (+${violations.length - 5} more)` : ""}`);
        }
    }
}
