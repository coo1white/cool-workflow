# REVIEW.md — how a PR is reviewed here

Three passes, in this order, by a reviewer that did not write the
code (cw's own reviewer agent, or a person):

1. Bugs and logic: does the change do what its PR text says, on the
   happy path and the empty, missing and wrong-input paths?
2. Security: no secret in the tree, no new network call, no new
   runtime dependency in the CLI, no path built from run text, every
   run string escaped before HTML.
3. Compliance: the diff matches the program's `spec.md` and `plan.md`
   (`sdlc/` and `project/docs/intent/`); a departure updates the plan
   in the same commit; the PR pastes the gates the plan names.

Merge needs green CI and the reviewer's word. The agent that wrote the
code never approves it. Release is the operator's own command.
