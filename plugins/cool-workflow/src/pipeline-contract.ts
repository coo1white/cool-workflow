import { PipelineContract } from "./types";

export const DEFAULT_PIPELINE_CONTRACT_ID = "cw.pipeline.default";

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
        requiredArtifacts: ["state"]
      },
      {
        id: "dispatch",
        name: "Dispatch",
        acceptedInputKinds: ["task"],
        acceptedInputStatuses: ["pending"],
        producedOutputKind: "dispatch",
        requiredArtifacts: ["task"]
      },
      {
        id: "result",
        name: "Result",
        acceptedInputKinds: ["dispatch"],
        acceptedInputStatuses: ["running", "completed"],
        producedOutputKind: "result",
        requiredArtifacts: ["result"]
      },
      {
        id: "verify",
        name: "Verify",
        acceptedInputKinds: ["result", "verifier"],
        acceptedInputStatuses: ["completed", "verified"],
        producedOutputKind: "verifier",
        requiredEvidence: ["cw:result"]
      },
      {
        id: "commit",
        name: "Commit",
        acceptedInputKinds: ["verifier", "commit"],
        acceptedInputStatuses: ["verified"],
        producedOutputKind: "commit",
        verifierGate: {
          required: true,
          acceptedStatuses: ["verified"],
          requiredEvidence: true
        }
      },
      {
        id: "report",
        name: "Report",
        acceptedInputKinds: ["commit", "result", "verifier"],
        acceptedInputStatuses: ["committed", "completed", "verified"],
        producedOutputKind: "report",
        requiredArtifacts: ["report"]
      }
    ],
    inputSchema: {
      type: "object"
    },
    outputSchema: {
      type: "object"
    },
    artifactPolicy: {
      root: ".cw/runs/<run-id>",
      requireReadablePaths: true
    },
    evidencePolicy: {
      highPriorityRequiresEvidence: true
    },
    failurePolicy: {
      preserveFailureNodes: true,
      retryableByDefault: false
    },
    commitPolicy: {
      requiresVerifierGate: true,
      acceptedVerifierStatuses: ["verified"]
    },
    compatibility: {
      minSchemaVersion: 1,
      maxSchemaVersion: 1,
      notes: "New optional fields may be added without breaking existing run state."
    }
  };
}
