---
description: Prepare a release (step 1 of 2) — version bump and PR. Cutting the tag is a separate operator-only step.
---

A release is TWO steps (see AGENTS.md's "Shipping a release" section). This
command does ONLY step 1, the agent-prep half. Step 2 — running the gate,
the independent reviewer, signing the verdict, creating the tag, and
publishing — is the OPERATOR's own command, `npm run release -- X.Y.Z`, run
in their own terminal where `CW_RELEASE_VERDICT_PRIVKEY` is set. Never run
`release-oneclick.js` or `release-flow.js --cut`, and never create a tag by
hand — those steps need the signing key, which an agent must never read or
hold.

Both `npm run` commands below run with cwd `plugins/cool-workflow/` (no
root package.json).

Steps, in order — stop at the first failure:

1. Ask the user (if not already given) for the target version `X.Y.Z` and
   a one-sentence description of the capability this release adds.

2. Run `npm run bump:version -- X.Y.Z --content` to stamp every version
   surface and auto-fill content placeholders (docs, README).

3. Run `npm run sync:project-index -- --repo-only` to regenerate the
   project index.

4. Run a full clean rebuild (`npm run build`) and confirm it is clean.

5. Commit the changes and open the version-bump PR onto `main`
   (branch name should describe the release, e.g. `release/X.Y.Z`).

Report: the PR link, the version, and the capability sentence. Then tell
the user the PR needs to merge before they run `npm run release -- X.Y.Z`
themselves to cut, sign, and publish the release — do not attempt that
step in this session.
