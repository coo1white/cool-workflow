module.exports = ({ workflow, phase, agent, artifact }) =>
  workflow({
    id: "research-synthesis",
    title: "Research Synthesis",
    summary:
      "Split a broad research question into scoped investigations, cross-check findings, and produce a concise synthesis.",
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
          "scope:claims",
          "Break the research question into independently verifiable claims, likely sources, and uncertainty boundaries."
        )
      ]),
      phase("Investigate", [
        agent(
          "investigate:primary-sources",
          "Investigate primary or official sources first. Return evidence, links, dates, and uncertainty."
        ),
        agent(
          "investigate:counterpoints",
          "Look for counterevidence, conflicting interpretations, missing context, and stale assumptions."
        )
      ]),
      phase("Verify", [
        agent(
          "verify:claims",
          "Verify each important claim against the gathered evidence. Mark real, conditional, stale, unknown, or unsupported.",
          { requiresEvidence: true }
        )
      ]),
      phase("Synthesize", [
        artifact(
          "synthesis:report",
          "Write a concise synthesis with answer, evidence, caveats, and open questions.",
          { requiresEvidence: true }
        )
      ])
    ]
  });
