---
description: Run the full gated release flow — deterministic gate, independent reviewer, then tag.
---

Execute the cool-workflow release flow for the current HEAD. Follow these
steps in order and stop at the first failure:

1. Run `bash plugins/cool-workflow/scripts/release-gate.sh`. If it fails,
   report its output and stop. Fix the findings in normal development
   cycles; do not retry the release in this session.

2. Invoke the `release-reviewer` subagent with this exact request:
   "Review the release candidate at current HEAD against the previous tag.
   Derive all facts yourself; no prior claims are provided."
   Pass NOTHING else — no summary of the work, no justification, no list of
   what was implemented. The reviewer must form its view from the repo alone.

3. Read `.cw-release/review-<HEAD-sha>.verdict`.
   - If REJECTED or missing: report the reviewer's findings verbatim and
     stop. Do not modify the verdict file. Do not re-invoke the reviewer
     in the same session after only cosmetic changes.
   - If APPROVED: proceed.

4. Compute the next version from the previous tag, update CHANGELOG.md with
   the four sections (Capability / Implementation / Tests / Risk), commit,
   then create the annotated tag. The tag message is the one-sentence
   capability line from the verdict file.

5. Push the branch and the tag. Report: version, capability sentence,
   test summary, and a link-ready `git diff <prev>..<new> --stat`.

Never write to `.cw-release/` yourself in any step. The gate script and the
reviewer agent are the only writers; forging markers is a hard violation
and CI will catch it.
