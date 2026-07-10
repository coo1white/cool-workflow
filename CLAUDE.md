# CLAUDE.md

This project follows the same binding rules as `AGENTS.md`.
Read `AGENTS.md` before changing code, docs, tests, or release files.

## Project memory

CW has two joined ideas:

- FreeBSD engineering discipline inside the code: POLA, mechanism over
  policy, stdout as data, stderr as diagnostics, fail closed, zero
  runtime dependencies, documented surfaces, and gated releases.
- Homebrew-like tool spirit outside the code: few commands, strong
  checks, clear next steps, saved state that can be inspected, and
  boring recovery.

Keep this line true:

```text
ask simple -> run simple -> verify simple -> resume simple
```

CW is not a model SDK or an agent platform. It is a small control-plane
that keeps agent work, citations, state, and verification in order. When
work touches user or operator flows, prefer `cw doctor`,
`report verify`, clear blocked states, and resumable runs over hidden
magic or broad framework behavior.

## Working rule

If this file and `AGENTS.md` ever differ, `AGENTS.md` is the source of
truth. Update both files in the same PR when the project memory changes.

## Shipping a release (two steps)

Full rules in `AGENTS.md` ("Shipping a release") and `RELEASE.md`.
The short form:

1. **Agent prep**: write the `## X.Y.Z` CHANGELOG.md entry (short —
   it goes into the GitHub Release as-is), land the version bump as
   its OWN PR (`npm run bump:version -- X.Y.Z --content` + project
   index + ITERATION_LOG entry + clean rebuild).
2. **Operator command**: the operator runs `npm run release -- X.Y.Z`
   in their own terminal. The script fail-fasts on every known
   precondition first, then does the gated cut, a tag-only push, the
   GitHub Release, and waits for CI + npm confirmation. A re-run
   after a failure resumes.

Never `git tag` by hand. The verdict signing key
(`CW_RELEASE_VERDICT_PRIVKEY`) stays with the operator — an agent
must never read it. The tag commit's first parent must be exactly
the reviewed sha; recut instead of retagging or merge-fixing the
tag's line.

## Resolving merge conflicts

When the base branch has moved on and a rebase or merge hits a
conflict:

- Rebase the work branch onto the base branch; do not merge the base
  branch into the work branch. Force-push only the work branch itself,
  never the base branch.
- Simple, mechanical conflicts may be resolved without asking:
  changelog files (append-only — keep the entries from both sides),
  TODO or docs lists (keep both sides), lockfiles (take the base
  branch's copy, then run the build against it as a check; make a new
  one only if this branch changed the dependency set), and edits on
  near-by lines in unrelated code.
- A semantic conflict is a stop sign: the two sides changed the same
  function or logic, or the conflict touches security-sensitive code
  (wire formats, fail-closed checks, redaction, signing or release
  tooling). Put the two sides in front of the owner and ask; do not
  guess a resolution in that code.
- After any resolution the result is new code: run the project's
  checks again, wait for CI to be green on the new head, and only then
  merge.
- Never resolve a whole conflict with a blanket "ours" or "theirs".
