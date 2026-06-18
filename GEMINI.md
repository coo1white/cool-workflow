# GEMINI.md

Read `AGENTS.md`, `CLAUDE.md`, and `AI_MEMORY.md` before changing this
repo. The same rules bind all AI coding agents.

Two ideas must guide all code and PR work:

- FreeBSD engineering discipline inside the code: POLA, mechanism over
  policy, stdout as data, stderr as diagnostics, fail closed, zero
  runtime dependencies, documented surfaces, and gated releases.
- Homebrew-like tool spirit outside the code: few commands, strong
  checks, clear next steps, saved state inspectable, and boring
  recovery.

Keep this line true:

```text
ask simple -> run simple -> verify simple -> resume simple
```
