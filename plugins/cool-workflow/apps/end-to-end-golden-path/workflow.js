module.exports = ({ workflow, phase, agent, input }) => {
  const inputs = [
    input("question", {
      type: "string",
      required: true,
      description: "Golden path assertion or release question to prove."
    })
  ];

  return workflow({
    id: "end-to-end-golden-path",
    title: "End-to-End Golden Path",
    summary: "Deterministic one-worker workflow app for proving the CW integration chain.",
    limits: {
      maxAgents: 1,
      maxConcurrentAgents: 1
    },
    inputs,
    sandboxProfiles: ["readonly"],
    phases: [
      phase("Golden Path", [
        agent(
          "golden:path",
          [
            "Prove the CW end-to-end golden path for {{question}}.",
            "Return a concise result with a cw:result block and durable file:line evidence."
          ].join(" "),
          { requiresEvidence: true, sandboxProfileId: "readonly" }
        )
      ])
    ]
  });
};
