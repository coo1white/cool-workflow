module.exports = ({ workflow, phase, agent, artifact, input }) => {
  const inputs = [
    input("question", {
      type: "string",
      required: true,
      description: "Question or implementation task this app should plan."
    })
  ];

  return workflow({
    id: "workflow-app-framework-demo",
    title: "Workflow App framework Demo",
    summary: "Small framework app showing inputs, phases, evidence gates, and sandbox profile hints.",
    limits: {
      maxAgents: 6,
      maxConcurrentAgents: 2
    },
    inputs,
    sandboxProfiles: ["readonly", "workspace-write"],
    phases: [
      phase("Inspect", [
        agent(
          "inspect:contract",
          "Inspect the repository context for {{question}}. Return relevant files, current contracts, and unknowns.",
          { sandboxProfileId: "readonly" }
        )
      ]),
      phase("Implement", [
        agent(
          "implement:change",
          "Implement the smallest coherent change for {{question}} and report edited files and risks.",
          { sandboxProfileId: "workspace-write" }
        )
      ]),
      phase("Verify", [
        artifact(
          "verify:evidence",
          "Verify the implementation for {{question}} with commands, state evidence, and remaining risks.",
          { requiresEvidence: true, sandboxProfileId: "readonly" }
        )
      ])
    ]
  });
};
