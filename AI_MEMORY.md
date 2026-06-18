# AI Coding Memory

This file is for Codex, Claude, Gemini, Copilot, Cursor, Windsurf,
Aider, and any other AI coding agent.

Two project rules are binding:

1. FreeBSD engineering discipline inside the code. Keep POLA, mechanism
   over policy, stdout as data, stderr as diagnostics, fail closed, zero
   runtime dependencies, documented surfaces, and gated releases.
2. Homebrew-like tool spirit outside the code. Keep commands few,
   checks strong, next steps clear, saved state inspectable, and
   recovery boring.

Keep this line true:

```text
ask simple -> run simple -> verify simple -> resume simple
```

CW is not a model SDK or an agent platform. It is a small control-plane
that keeps agent work, citations, state, and verification in order. When
work touches user or operator flows, prefer `cw doctor`, `report verify`,
clear blocked states, and resumable runs over hidden magic.

For any code or PR:

- Do not change existing output, file layout, exit code, or flag bytes
  without a versioned path.
- Keep policy in apps, configs, wrappers, and env, not in the core.
- Keep stdout as data and stderr as diagnostics.
- Do not add a runtime dependency.
- Keep docs and changelog in step with behavior.
