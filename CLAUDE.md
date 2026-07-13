# CLAUDE.md

**`AGENTS.md` is the one source of truth for this repo's rules. Read it
before changing code, docs, tests, or release files — its rules bind all
work here.**

This file used to keep a copy of key AGENTS.md sections, with a rule that
the two had to be updated together. That copy is gone on purpose
(2026-07-13): two copies of the same rules drift, and this repo has been
burned by doc drift before. One source, one place to update.

Quick pointers into `AGENTS.md` for the sections most often needed
mid-session:

- **Project memory** — what CW is and is not (FreeBSD discipline inside,
  Homebrew spirit outside; `ask simple -> run simple -> verify simple ->
  resume simple`).
- **HARD RULE** — never push to `main`; branch -> PR -> green CI -> merge.
- **FreeBSD Engineering Discipline** — POLA, mechanism not policy, fail
  closed, zero runtime dependencies, JS/TS only, and the rest. Binding,
  not aspirational.
- **Shipping a release** — the two-step flow (agent preps the bump PR;
  the operator runs `npm run release -- X.Y.Z`). Never `git tag` by hand;
  the verdict signing key stays with the operator.
- **Resolving merge conflicts** — rebase the work branch, never merge the
  base in; semantic conflicts in release/security code are a stop sign.
