module.exports = ({ workflow, phase, agent, artifact }) =>
  workflow({
    id: "legacy-research-synthesis",
    title: "Legacy Research Synthesis",
    summary:
      "Compatibility workflow-file wrapper for the canonical research-synthesis app.",
    limits: {
      maxAgents: 12,
      maxConcurrentAgents: 4
    },
    inputs: [
      { name: "question", required: true },
      { name: "source", repeated: true }
    ],
    phases: [
      phase("Scope", [
        agent(
          "legacy-scope:claims",
          "Break the research question into independently verifiable claims, likely sources, and uncertainty boundaries."
        )
      ]),
      phase("Investigate", [
        agent(
          "legacy-investigate:primary-sources",
          "Investigate primary or official sources first. Return evidence, links, dates, and uncertainty."
        ),
        agent(
          "legacy-investigate:counterpoints",
          "Look for counterevidence, conflicting interpretations, missing context, and stale assumptions."
        )
      ]),
      phase("Verify", [
        agent(
          "legacy-verify:claims",
          "Verify each important claim against the gathered evidence. Mark real, conditional, stale, unknown, or unsupported.",
          { requiresEvidence: true }
        )
      ]),
      phase("Synthesize", [
        artifact(
          "legacy-synthesis:report",
          "Write a concise synthesis with answer, evidence, caveats, and open questions.",
          { requiresEvidence: true }
        )
      ])
    ]
  });
