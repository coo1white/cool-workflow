module.exports = ({ workflow, phase, agent, artifact }) =>
  workflow({
    id: "legacy-architecture-review",
    title: "Legacy Architecture Review",
    summary:
      "Compatibility workflow-file wrapper for the canonical architecture-review app.",
    limits: {
      maxAgents: 40,
      maxConcurrentAgents: 6
    },
    inputs: [
      { name: "repo", required: true },
      { name: "question", required: true },
      { name: "invariant", repeated: true }
    ],
    phases: [
      phase("Map", [
        agent(
          "legacy-map:server-api",
          "Map server/API entrypoints, request flows, service boundaries, auth surfaces, and owned state. Return inspected files, dependencies, invariants, and candidate risks."
        ),
        agent(
          "legacy-map:web-client",
          "Map web/client/UI boundaries, local state, backend dependencies, build/runtime assumptions, and candidate risks."
        ),
        agent(
          "legacy-map:db-security",
          "Map database, persistence, migrations, secrets, auth, permissions, and security-sensitive paths. Return candidate risks with evidence."
        ),
        agent(
          "legacy-map:deploy-config",
          "Map deployment, Docker/compose, CI, reverse proxies, environment config, supervision, and operational assumptions."
        ),
        agent(
          "legacy-map:jobs-operators",
          "Map background jobs, admin/operator surfaces, queues, scheduled work, and failure recovery paths."
        ),
        agent(
          "legacy-map:transport-core",
          "Map protocol, daemon, transport, rendering, networking, or core engine boundaries when present; otherwise explain why this scope is not applicable."
        )
      ]),
      phase("Assess", [
        agent(
          "legacy-assess:security",
          "Assess mapper findings through a security lens. Separate real, conditional, non-issue, and unknown risks with evidence and falsifiers."
        ),
        agent(
          "legacy-assess:data-correctness",
          "Assess data correctness, schema drift, persistence invariants, concurrency, transactions, and state corruption risks."
        ),
        agent(
          "legacy-assess:failure-modes",
          "Assess startup, shutdown, retries, partial failure, dependency outage, backup/restore, and recovery behavior."
        ),
        agent(
          "legacy-assess:scale-ops",
          "Assess scale, operational complexity, observability, configuration, deployment, and maintenance risks."
        ),
        agent(
          "legacy-assess:maintainability",
          "Assess module boundaries, ownership clarity, coupling, extensibility, testability, and future change risk."
        ),
        agent(
          "legacy-assess:domain",
          "Assess domain-specific risks implied by the repo and user invariants. If the domain includes networking/proxy/tunnel behavior, include anti-censorship and abuse-resistance concerns."
        )
      ]),
      phase("Verify", [
        agent(
          "legacy-verify:p0-p2-risks",
          "Re-open evidence for every candidate P0/P1/P2 risk. Confirm real risks, downgrade unsupported concerns, and list exact files or unknowns.",
          { requiresEvidence: true }
        )
      ]),
      phase("Verdict", [
        artifact(
          "legacy-verdict:synthesis",
          "Synthesize the architecture verdict: short answer, architecture map, ranked risks, non-issues, recommended changes, and evidence links.",
          { requiresEvidence: true }
        )
      ])
    ]
  });
