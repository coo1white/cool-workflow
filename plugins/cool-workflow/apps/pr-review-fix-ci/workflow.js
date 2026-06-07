module.exports = ({ workflow, phase, agent, artifact, input }) => {
  const inputs = [
    input("repo", {
      type: "path",
      required: true,
      description: "Repository path to inspect."
    }),
    input("pr", {
      type: "string",
      description: "Pull request number or URL."
    }),
    input("branch", {
      type: "string",
      description: "Branch to review when no pull request is supplied."
    }),
    input("base", {
      type: "string",
      description: "Base branch or ref for comparison."
    }),
    input("ci", {
      type: "string",
      description: "CI system, check name, or log path to inspect."
    }),
    input("mode", {
      type: "string",
      description: "review for findings only, or fix when file edits are allowed."
    })
  ];

  return workflow({
    id: "pr-review-fix-ci",
    title: "PR Review Fix CI",
    summary: "Review a pull request or branch, inspect CI failures, diagnose actionable issues, optionally patch, verify, and summarize with evidence.",
    limits: {
      maxAgents: 12,
      maxConcurrentAgents: 4
    },
    inputs,
    sandboxProfiles: ["readonly", "workspace-write"],
    phases: [
      phase("Inspect PR", [
        agent(
          "inspect:change-scope",
          "Inspect {{repo}} for PR {{pr}} or branch {{branch}} against base {{base}}. Identify changed files, touched contracts, generated files, and reviewer-relevant context. Evidence should be exact file paths, refs, diffs, or commands.",
          { sandboxProfileId: "readonly" }
        ),
        agent(
          "inspect:review-surface",
          "Review changed behavior for correctness, regressions, missing tests, compatibility, security, and maintenance risk. Return only actionable findings with precise file paths and line-oriented evidence when available.",
          { sandboxProfileId: "readonly" }
        )
      ]),
      phase("Inspect CI", [
        agent(
          "inspect:ci-failures",
          "Inspect CI context {{ci}} for failing checks, logs, commands, flakes, skipped jobs, and local reproduction hints. Cite exact check names, command lines, log excerpts, or artifact paths as evidence.",
          { sandboxProfileId: "readonly" }
        )
      ]),
      phase("Diagnose", [
        agent(
          "diagnose:root-causes",
          "Diagnose the highest-value PR and CI issues. Classify each as real, conditional, non-issue, or unknown; include reproduction commands, file paths, logs, check names, and falsifiers. The cw:result evidence array must support P0/P1/P2 findings.",
          { requiresEvidence: true, sandboxProfileId: "readonly" }
        )
      ]),
      phase("Fix Plan or Patch", [
        agent(
          "patch:review-or-fix",
          "Mode is {{mode}}. In review mode, produce a minimal fix plan without editing files. In fix mode, implement the smallest coherent patch, avoid unrelated refactors, and report changed files, commands run, and risks. Workspace writes are allowed only for this task.",
          { sandboxProfileId: "workspace-write" }
        )
      ]),
      phase("Verify", [
        agent(
          "verify:outcomes",
          "Verify review conclusions or patches with deterministic commands. Include exact commands, exit status, failing check names, logs, changed files, and unresolved risks. The cw:result evidence array must cite durable local evidence.",
          { requiresEvidence: true, sandboxProfileId: "readonly" }
        )
      ]),
      phase("Summary", [
        artifact(
          "summary:review",
          "Write the final PR review and CI summary: blocking findings first, fixes made or proposed, verification evidence, residual risk, and next commands. The cw:result evidence array must support the summary.",
          { requiresEvidence: true, sandboxProfileId: "readonly" }
        )
      ])
    ]
  });
};
