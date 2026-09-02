// core/pipeline/contract.ts — DEFAULT_PIPELINE_CONTRACT_ID,
// createDefaultPipelineContract.
//
// MILESTONE 6+7 (combined; see project/docs/rebuild/PLAN.md Open risk 10). Byte-exact port
// of the old build's pipeline-contract module. Pure data.
//
// Evidence: SPEC/pipeline-run.md "Default contract — src/pipeline-
// contract.ts", "Default contract stage table (byte facts a rebuild must
// keep)".

import { PipelineContract } from "../state/types";

export const DEFAULT_PIPELINE_CONTRACT_ID = "cw.pipeline.default";

/** The default `plan -> dispatch -> result -> verify -> commit -> report`
 *  contract. Stage accept rules are byte-exact to SPEC/pipeline-run.md's
 *  "Default contract stage table". */
export function createDefaultPipelineContract(): PipelineContract {
  return {
    schemaVersion: 1,
    id: DEFAULT_PIPELINE_CONTRACT_ID,
    title: "Cool Workflow Default Pipeline",
    stages: [
      {
        id: "plan",
        name: "Plan",
        acceptedInputKinds: ["input"],
        acceptedInputStatuses: ["pending", "completed"],
        producedOutputKind: "task",
        requiredArtifacts: ["state"],
      },
      {
        id: "dispatch",
        name: "Dispatch",
        acceptedInputKinds: ["task"],
        acceptedInputStatuses: ["pending"],
        producedOutputKind: "dispatch",
        requiredArtifacts: ["task"],
      },
      {
        id: "result",
        name: "Result",
        acceptedInputKinds: ["dispatch"],
        acceptedInputStatuses: ["running", "completed"],
        producedOutputKind: "result",
        requiredArtifacts: ["result"],
      },
      {
        id: "verify",
        name: "Verify",
        acceptedInputKinds: ["result", "verifier"],
        acceptedInputStatuses: ["completed", "verified"],
        producedOutputKind: "verifier",
        requiredEvidence: ["cw:result"],
      },
      {
        id: "commit",
        name: "Commit",
        acceptedInputKinds: ["verifier", "commit"],
        acceptedInputStatuses: ["verified"],
        producedOutputKind: "commit",
        verifierGate: { required: true, acceptedStatuses: ["verified"], requiredEvidence: true },
      },
      {
        id: "report",
        name: "Report",
        acceptedInputKinds: ["commit", "result", "verifier"],
        acceptedInputStatuses: ["committed", "completed", "verified"],
        producedOutputKind: "report",
        requiredArtifacts: ["report"],
      },
    ],
    artifactPolicy: { root: ".cw/runs/<run-id>", requireReadablePaths: true },
    // highPriorityRequiresEvidence is carried for byte-compat with the old
    // build's default contract (pinned by SPEC/pipeline-run.md) but is NOT
    // enforced anywhere — no gate reads it, and core has no task-priority
    // concept to key it on. The enforced contract-wide flag is
    // `requireEvidence` (state-node.ts assertRequiredEvidence, runner.ts
    // evidenceSatisfied). The per-stage `requiredEvidence` lists are what
    // actually gate evidence in the default contract.
    evidencePolicy: { highPriorityRequiresEvidence: true },
    failurePolicy: { preserveFailureNodes: true, retryableByDefault: false },
    commitPolicy: { requiresVerifierGate: true, acceptedVerifierStatuses: ["verified"] },
    compatibility: { minSchemaVersion: 1, maxSchemaVersion: 1 },
  };
}
