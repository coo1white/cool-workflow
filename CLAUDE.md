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
