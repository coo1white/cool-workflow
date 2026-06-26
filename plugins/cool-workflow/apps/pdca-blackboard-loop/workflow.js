module.exports = ({ workflow, phase, agent, input }) => {
  const inputs = [
    input("goal", {
      type: "string",
      required: true,
      description: "Work goal for the PDCA loop."
    }),
    input("repo", {
      type: "string",
      description: "Optional repo or folder path."
    }),
    input("acceptance", {
      type: "string",
      description: "Optional checks that say the work is done."
    })
  ];

  return workflow({
    id: "pdca-blackboard-loop",
    title: "PDCA Blackboard Loop",
    summary: "Three agents use one blackboard to plan, build, check, and choose the next step.",
    limits: {
      maxAgents: 4,
      maxConcurrentAgents: 1
    },
    inputs,
    sandboxProfiles: ["readonly", "workspace-write"],
    phases: [
      phase("Plan", [
        agent(
          "planner:plan",
          "Plan the smallest work loop for {{goal}} in {{repo}}. Include acceptance notes: {{acceptance}}. Write the plan so the builder can use it.",
          { sandboxProfileId: "readonly" }
        )
      ]),
      phase("Do", [
        agent(
          "builder:build",
          "Use the planner output and do the smallest useful work for {{goal}} in {{repo}}. If the plan is missing or unsafe, report blocked instead of success.",
          { requiresEvidence: true, sandboxProfileId: "workspace-write" }
        )
      ]),
      phase("Check", [
        agent(
          "auditor:audit",
          "Check the builder output against {{acceptance}}. Cite the builder evidence. If evidence is missing, report blocked instead of success.",
          { requiresEvidence: true, sandboxProfileId: "readonly" }
        )
      ]),
      phase("Act", [
        agent(
          "planner:next",
          "Read the auditor verdict and record one next action for {{goal}}: accepted, revise, or blocked. Cite the audit evidence.",
          { requiresEvidence: true, sandboxProfileId: "readonly" }
        )
      ])
    ]
  });
};
