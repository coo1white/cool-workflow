# Copilot Instructions

Before giving code, follow `AGENTS.md` and `AI_MEMORY.md`.

This project has two binding rules:

- FreeBSD engineering discipline inside the code: POLA, mechanism over
  policy, stdout as data, stderr as diagnostics, fail closed, zero
  runtime dependencies, documented surfaces, and gated releases.
- Homebrew-like tool spirit outside the code: few commands, strong
  checks, clear next steps, saved state inspectable, and boring
  recovery.

Keep operator work simple:

```text
ask simple -> run simple -> verify simple -> resume simple
```
