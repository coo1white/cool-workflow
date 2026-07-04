"use strict";
// shell/verifier.ts — taskRequiresEvidence, the small task-level gate the
// worker-accept path and the commit gate both consult.
//
// MILESTONE 6+7 (combined). Byte-exact port of the old build's
// src/verifier.ts's `taskRequiresEvidence`. Pure logic; kept under
// shell/ only because its caller (worker-isolation.ts) is shell-side —
// the function itself takes no fs/clock/random input.
//
// Evidence: SPEC/pipeline-run.md "Commit gate" (verifierNodeRequiresEvidence
// reuses this exact predicate).
Object.defineProperty(exports, "__esModule", { value: true });
exports.taskRequiresEvidence = taskRequiresEvidence;
function taskRequiresEvidence(task) {
    return Boolean(task.requiresEvidence || /^verify[:/]/i.test(task.id) || /^verdict[:/]/i.test(task.id) || /^synthesis[:/]/i.test(task.id));
}
