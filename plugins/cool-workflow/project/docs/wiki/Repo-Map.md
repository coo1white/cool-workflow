# Repo Map

What every top-level folder and file is for, one line each — most are fixed
by a tool, a test, or the release chain.

| Place | What it is |
|---|---|
| [`plugins/cool-workflow/`](https://github.com/coo1white/cool-workflow/blob/main/plugins/cool-workflow/) | The product itself: TypeScript source (`src/`), committed build (`dist/`), tests, scripts, man-page docs, manifests |
| [`plugins/cool-workflow/project/docs/`](https://github.com/coo1white/cool-workflow/blob/main/plugins/cool-workflow/project/docs/) | Repo-level docs: wiki source, audits, benchmark notes, the v2 rebuild SPEC, architecture plans. Outside the npm `files` allowlist and the man-page index — never shipped |
| [`v2/conformance/`](https://github.com/coo1white/cool-workflow/blob/main/v2/conformance/) | Black-box conformance suite — pins the shipping CLI's observable behavior byte for byte; CI runs it on every PR. Stays at the repo root deliberately: an arm's-length judge of `plugins/cool-workflow/`, not a part of it |
| [`plugins/cool-workflow/project/examples/`](https://github.com/coo1white/cool-workflow/blob/main/plugins/cool-workflow/project/examples/) | Worked examples, e.g. a real published self-audit with line-cited findings |
| [`plugins/cool-workflow/scripts/bench/`](https://github.com/coo1white/cool-workflow/blob/main/plugins/cool-workflow/scripts/bench/) | The benchmark runner (see [docs/benchmark.md](https://github.com/coo1white/cool-workflow/blob/main/plugins/cool-workflow/project/docs/benchmark.md)) |
| [`Formula/`](https://github.com/coo1white/cool-workflow/blob/main/Formula/) | Homebrew formula — `brew` only finds it at this exact path |
| `.cw-release/` | Append-only release trust records: gate markers, signed reviewer verdicts. Never edit or delete by hand |
| `.github/` | CI workflows: build/test matrix, conformance, CodeQL, gitleaks, release gate, npm publish |
| `.claude-plugin/`, `.agents/plugins/` | Plugin/marketplace manifests so LLM clients can discover CW |
| [`AGENTS.md`](https://github.com/coo1white/cool-workflow/blob/main/AGENTS.md) | The binding rules for coding agents working ON this repo; the one source of truth (also carries product direction/moat, long-term build memory, and the release runbook merged in from the former `DIRECTION.md`, `CLAUDE.md`, `PROJECT_MEMORY.md`, and `RELEASE.md`) |
