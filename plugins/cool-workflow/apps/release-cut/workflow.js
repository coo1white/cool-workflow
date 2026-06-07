module.exports = ({ workflow, phase, agent, artifact, input }) => {
  const inputs = [
    input("repo", {
      type: "path",
      required: true,
      description: "Repository path to prepare."
    }),
    input("version", {
      type: "string",
      required: true,
      description: "Release version to prepare."
    }),
    input("previousVersion", {
      type: "string",
      description: "Previous released version for changelog comparison."
    }),
    input("releaseBranch", {
      type: "string",
      description: "Release branch or target ref."
    }),
    input("dryRun", {
      type: "boolean",
      description: "When true, report intended release actions without publishing."
    })
  ];

  return workflow({
    id: "release-cut",
    title: "Release Cut",
    summary: "Prepare a release with checklist discipline: version checks, changelog, tests, packaging, release notes, and final verification.",
    limits: {
      maxAgents: 12,
      maxConcurrentAgents: 4
    },
    inputs,
    sandboxProfiles: ["readonly", "workspace-write"],
    phases: [
      phase("Preflight", [
        agent(
          "preflight:repo-state",
          "Inspect {{repo}} for release {{version}} on branch {{releaseBranch}}. Report git state, dependency state, required tools, dirty files, generated artifacts, and dryRun={{dryRun}} constraints with exact commands and paths.",
          { sandboxProfileId: "readonly" }
        )
      ]),
      phase("Version Audit", [
        agent(
          "audit:versions",
          "Audit all release metadata for target version {{version}} and previous version {{previousVersion}}. Check package manifests, plugin manifests, generated files, docs, changelog, and manually reported versions. Return exact file paths and mismatches.",
          { sandboxProfileId: "readonly" }
        )
      ]),
      phase("Changelog and Notes", [
        agent(
          "notes:update",
          "Prepare changelog and release notes for {{version}}. In dryRun={{dryRun}}, report the exact edits that would be made; otherwise update only release documentation and metadata files needed for the release.",
          { sandboxProfileId: "workspace-write" }
        )
      ]),
      phase("Package", [
        agent(
          "package:artifacts",
          "Prepare release package artifacts for {{version}} using deterministic commands only. In dryRun={{dryRun}}, do not publish; report artifact paths, generated files, checksums when available, and packaging commands.",
          { sandboxProfileId: "workspace-write" }
        )
      ]),
      phase("Verify", [
        agent(
          "verify:package",
          "Verify release package readiness with deterministic commands, test results, generated dist files, artifact paths, and release metadata. The cw:result evidence array must cite package artifacts, commands, or file locators.",
          { requiresEvidence: true, sandboxProfileId: "readonly" }
        )
      ]),
      phase("Release Verdict", [
        artifact(
          "verdict:release",
          "Write the release verdict for {{version}}: ship or hold, checklist status, artifacts, tests, release notes, dry-run limitations, and residual risks. The cw:result evidence array must support the final verdict.",
          { requiresEvidence: true, sandboxProfileId: "readonly" }
        )
      ])
    ]
  });
};
