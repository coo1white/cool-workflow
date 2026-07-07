# workflows/ — legacy compatibility surface (pinned, do not remove)

`architecture-review.workflow.js` and `research-synthesis.workflow.js` are
the old, pre-`apps/` workflow-file format. The real, current homes for
these two workflows are `apps/architecture-review/` and
`apps/research-synthesis/` — these files exist ONLY so an id from before
the `apps/` format still resolves.

This is deliberate duplication, not drift to clean up: each file here
registers its OWN distinct id (`legacy-architecture-review`,
`legacy-research-synthesis`), pinned by
`v2/conformance/cases/multiagent-app-list.case.js` and
`plugins/cool-workflow/test/workflow-app-framework-smoke.js`. `cw list` /
`cw app list` show both the real app and its legacy id side by side
(`src/shell/workflow-app-loader.ts` discovers both roots).

Per this project's own POLA rule, removing or thinning either file would
change `cw list`'s output bytes — that is a breaking change, only doable
behind a major-version break, not a routine cleanup.
