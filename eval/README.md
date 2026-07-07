# eval/ — skill eval fixtures

The four files here (`ci-triage.jsonl`, `pr-review.jsonl`, `design-qa.jsonl`,
`deploy-check.jsonl`) are golden eval cases for the matching
`plugins/cool-workflow/skills/<name>/SKILL.md` skill definitions. Each line
is one case: `{workflow, id, input, expected}`, where `expected` is a
checklist of what a good run of that skill should show.

`plugins/cool-workflow/test/source-context-profile-smoke.js` reads every
file here and checks each line parses, names the right `workflow`, and
carries at least one `expected` criterion.

## Not the same thing as `cw eval`

The name here collides with a different, unrelated system: the runtime's
own multi-agent eval-replay harness (`src/core/multi-agent/eval-replay.ts`,
run via `npm run eval:replay`, driven by the `cw eval snapshot|replay|
compare|score|gate` capabilities). That harness snapshots and replays a
REAL run's state to prove determinism; these `.jsonl` files are static
checklists for a skill's expected behavior, checked only by the one smoke
above. If you are looking for run-replay/determinism testing, you want the
other one.
