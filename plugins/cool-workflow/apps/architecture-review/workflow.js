module.exports = ({ workflow, phase, agent, artifact, input }) => {
  const inputs = [
    input("repo", {
      type: "path",
      required: true,
      description: "Repository path to inspect."
    }),
    input("question", {
      type: "string",
      required: true,
      description: "Architecture question or decision to review."
    }),
    input("invariant", {
      type: "string",
      repeated: true,
      description: "Invariant that must remain true."
    }),
    input("focus", {
      type: "string",
      description: "Optional subsystem, risk area, or file path to emphasize."
    })
  ];

  return workflow({
    id: "architecture-review",
    title: "Architecture Review",
    summary: "Map a repository architecture, assess risks, verify important findings, and synthesize an evidence-backed verdict.",
    limits: {
      maxAgents: 40,
      maxConcurrentAgents: 6
    },
    inputs,
    sandboxProfiles: ["readonly"],
    phases: [
      phase("Map", [
        agent(
          "map:server-api",
          "Map server/API entrypoints, request flows, service boundaries, auth surfaces, and owned state in {{repo}} for {{question}}. Focus: {{focus}}. Invariants: {{invariant}}. Return inspected files, dependencies, invariants, and candidate risks.",
          { sandboxProfileId: "readonly" }
        ),
        agent(
          "map:web-client",
          "Map web/client/UI boundaries, local state, backend dependencies, build/runtime assumptions, and candidate risks in {{repo}}. Focus: {{focus}}. Return exact files and commands that informed the map.",
          { sandboxProfileId: "readonly" }
        ),
        agent(
          "map:db-security",
          "Map database, persistence, migrations, secrets, auth, permissions, and security-sensitive paths in {{repo}}. Return candidate risks with file paths, config names, and uncertainty boundaries.",
          { sandboxProfileId: "readonly" }
        ),
        agent(
          "map:deploy-config",
          "Map deployment, CI, package scripts, Docker or compose files, reverse proxies, environment config, supervision, and operational assumptions. Return concrete files and release or runtime risks.",
          { sandboxProfileId: "readonly" }
        ),
        agent(
          "map:jobs-operators",
          "Map background jobs, admin/operator surfaces, queues, scheduled work, generated files, state transitions, and failure recovery paths. Identify missing or non-applicable areas explicitly.",
          { sandboxProfileId: "readonly" }
        ),
        agent(
          "map:transport-core",
          "Map protocol, daemon, transport, rendering, networking, worker isolation, or core engine boundaries when present. If absent, explain why with inspected evidence.",
          { sandboxProfileId: "readonly" }
        )
      ]),
      phase("Assess", [
        agent(
          "assess:security",
          "Assess mapper findings through a security lens. Separate real, conditional, non-issue, and unknown risks with evidence, falsifiers, and exact files or config keys.",
          { sandboxProfileId: "readonly" }
        ),
        agent(
          "assess:data-correctness",
          "Assess data correctness, schema drift, persistence invariants, concurrency, transactions, cache behavior, and state corruption risks. Tie every important claim to inspected evidence.",
          { sandboxProfileId: "readonly" }
        ),
        agent(
          "assess:failure-modes",
          "Assess startup, shutdown, retries, partial failure, dependency outage, backup/restore, release rollback, and recovery behavior. Identify deterministic commands that could verify the claims.",
          { sandboxProfileId: "readonly" }
        ),
        agent(
          "assess:scale-ops",
          "Assess scale, operational complexity, observability, configuration, packaging, deployment, and maintenance risks. Include exact files, scripts, or missing controls.",
          { sandboxProfileId: "readonly" }
        ),
        agent(
          "assess:maintainability",
          "Assess module boundaries, ownership clarity, coupling, extensibility, testability, and future change risk. Distinguish architectural risks from style preferences.",
          { sandboxProfileId: "readonly" }
        ),
        agent(
          "assess:domain",
          "Assess domain-specific risks implied by {{question}}, {{focus}}, and the invariants {{invariant}}. Include abuse, misuse, or compatibility concerns only when supported by repository evidence.",
          { sandboxProfileId: "readonly" }
        )
      ]),
      phase("Verify", [
        agent(
          "verify:p0-p2-risks",
          "Re-open evidence for every candidate P0/P1/P2 risk. Confirm real risks, downgrade unsupported concerns, and list exact file paths, commands, logs, or unknowns. The cw:result evidence array must cite durable locators.",
          { requiresEvidence: true, sandboxProfileId: "readonly" }
        )
      ]),
      phase("Verdict", [
        artifact(
          "verdict:synthesis",
          "Synthesize the architecture verdict for {{question}}: short answer, architecture map, ranked risks, non-issues, recommended changes, and evidence links. The cw:result evidence array must support the final verdict.",
          { requiresEvidence: true, sandboxProfileId: "readonly" }
        )
      ])
    ]
  });
};
