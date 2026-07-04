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

import { RunTask } from "../core/state/types";
import { Finding, ResultEnvelope } from "../core/pipeline/result-normalize";
import { hasGroundedEvidence } from "../core/trust/evidence-grounding";
import { validateAgainstSchema, JsonSchema } from "../core/state/schema-validate";

export function taskRequiresEvidence(task: Pick<RunTask, "id" | "requiresEvidence">): boolean {
  return Boolean(task.requiresEvidence || /^verify[:/]/i.test(task.id) || /^verdict[:/]/i.test(task.id) || /^synthesis[:/]/i.test(task.id));
}

function validateFinding(task: RunTask, finding: Finding): void {
  if (!finding.id) throw new Error(`Task ${task.id} has a finding without id`);
  if (finding.classification && !["real", "conditional", "non-issue", "unknown"].includes(finding.classification)) {
    throw new Error(`Task ${task.id} finding ${finding.id} has invalid classification`);
  }
  if (["P0", "P1", "P2"].includes(finding.severity || "") && !hasGroundedEvidence(finding.evidence)) {
    throw new Error(`Task ${task.id} finding ${finding.id} severity ${finding.severity} requires grounded evidence (a path-like locator, URL, or namespace:value token)`);
  }
}

/** Validate an accepted result envelope against the task's declared contract:
 *  required grounded evidence, per-finding shape, and (opt-in) the task's
 *  declared output schema. Throws on violation (fail-closed — the drive parks
 *  the hop). Byte-behavior port of the old build's src/verifier.ts. */
export function validateResultEnvelope(task: RunTask, result: ResultEnvelope): void {
  if (taskRequiresEvidence(task) && !hasGroundedEvidence(result.evidence)) {
    throw new Error(`Task ${task.id} requires grounded cw:result evidence (a path-like locator, URL, or namespace:value token — not free text)`);
  }
  for (const finding of result.findings || []) {
    validateFinding(task, finding);
  }
  const schema = (task as { schema?: JsonSchema }).schema;
  if (schema) {
    const violations = validateAgainstSchema(result, schema);
    if (violations.length) {
      throw new Error(`Task ${task.id} result violates declared schema: ${violations.slice(0, 5).join("; ")}${violations.length > 5 ? ` (+${violations.length - 5} more)` : ""}`);
    }
  }
}
