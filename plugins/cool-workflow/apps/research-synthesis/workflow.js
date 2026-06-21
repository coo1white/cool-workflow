module.exports = ({ workflow, phase, agent, artifact, input }) => {
  const inputs = [
    input("question", {
      type: "string",
      required: true,
      description: "Research question to answer."
    }),
    input("source", {
      type: "string",
      repeated: true,
      description: "Preferred primary or official source, URL, citation, or local file."
    }),
    input("scope", {
      type: "string",
      description: "Optional boundary for the synthesis."
    }),
    input("freshness", {
      type: "string",
      description: "Optional freshness requirement or as-of date."
    })
  ];

  return workflow({
    id: "research-synthesis",
    title: "Research Synthesis",
    summary: "Split a research question into claims, investigate sources, cross-check evidence, verify claims, and synthesize a concise answer.",
    limits: {
      maxAgents: 12,
      maxConcurrentAgents: 4
    },
    inputs,
    sandboxProfiles: ["readonly", "locked-down"],
    phases: [
      phase("Scope", [
        agent(
          "scope:claims",
          "Break {{question}} into independently verifiable claims, source needs, scope boundaries {{scope}}, freshness requirement {{freshness}}, and likely stale assumptions. Use only the task input at this stage.",
          { sandboxProfileId: "locked-down" }
        )
      ]),
      phase("Investigate", [
        agent(
          "investigate:primary-sources",
          "Investigate primary or official sources first from {{source}} for {{question}}. The local files in your working directory are also possible primary sources: list them first, then read the ones that help and cite their paths. Return source titles, dates, authors or publishers, durable locators (a local file path with optional :line, or a URL), key claims, and uncertainty. Mark missing retrieval needs explicitly.",
          { sandboxProfileId: "readonly" }
        ),
        agent(
          "investigate:counterpoints",
          "Look for counterevidence, conflicting interpretations, stale claims, missing context, and scope violations for {{question}}. Prefer official or primary sources; label secondary-source-only claims.",
          { sandboxProfileId: "readonly" }
        )
      ]),
      phase("Cross-check", [
        agent(
          "cross-check:evidence",
          "Cross-check important claims across sources, dates, definitions, and uncertainty boundaries. Identify stale, unsupported, conditional, and conflicting claims with source locators.",
          { sandboxProfileId: "readonly" }
        )
      ]),
      phase("Verify", [
        agent(
          "verify:claims",
          "Verify each important claim against gathered evidence. Mark real, conditional, stale, unknown, or unsupported. The cw:result evidence array must cite durable source locators or local file paths.",
          { requiresEvidence: true, sandboxProfileId: "readonly" }
        )
      ]),
      phase("Synthesize", [
        artifact(
          "synthesis:report",
          "Write a concise synthesis for {{question}} with answer, evidence, caveats, stale or uncertain claims, and open questions. Use only verified evidence in the task input; the cw:result evidence array must support the synthesis.",
          { requiresEvidence: true, sandboxProfileId: "locked-down" }
        )
      ])
    ]
  });
};
