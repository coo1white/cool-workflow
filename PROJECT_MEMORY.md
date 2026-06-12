# Project Memory

This is the repo-local memory for Cool Workflow agent runs. Keep it factual,
short, and append-friendly. Do not use it for speculation.

## Verified Facts

- Default context slimming must use the `core` source profile.
- The `core` profile includes:
  - `plugins/cool-workflow/src/**`
  - `plugins/cool-workflow/apps/**`
  - `plugins/cool-workflow/package.json`
  - `plugins/cool-workflow/tsconfig.json`
  - `plugins/cool-workflow/scripts/cw.js`
  - `plugins/cool-workflow/scripts/mcp-server.js`
  - `plugins/cool-workflow/scripts/agents/**`
- The `core` profile excludes:
  - `plugins/cool-workflow/dist/**`
  - `plugins/cool-workflow/test/**`
  - `plugins/cool-workflow/docs/**`
  - `docs/assets/**`
  - `.cw-release/**`
  - `CHANGELOG.md`
  - `ITERATION_LOG.md`
- Excluding `dist/` from the context pack is allowed; deleting committed `dist/`
  is a separate release-contract decision.
- Context slimming is opt-in and must not change existing CW command output.
- Skill trigger metadata must live in standard YAML frontmatter. Every
  `SKILL.md` needs `name` and a trigger-rich `description`; the body is loaded
  only after a skill triggers and must not be the sole source of trigger text.
- Runtime acceleration plan:
  1. Add an opt-in fast architecture-review path that runs Map and Assess work
     as parallel phases instead of serial agent calls.
  2. Keep separate `fast` and `full` review modes so users can get a useful
     first result quickly while the existing deep review remains available.
  3. Generate one JSONL source context per run and pass that stable context to
     agent wrappers instead of making every worker rediscover the repository.
  4. Route cheap, fast models to mapping and summarization work, and reserve
     stronger models for verification and final verdict tasks.
  5. Cache source context and intermediate maps by git SHA plus profile digest,
     and fail closed when the digest does not match.
  6. Move long full reviews to routines/background runs so foreground user
     flows return progress and a fast report instead of blocking for 40 minutes.
- `architecture-review-fast` is the opt-in fast/full split implementation. It
  keeps `architecture-review` unchanged, plans 6 workers instead of 14, runs Map
  and Assess as parallel phases, accepts optional `sourceContext` and
  `sourceContextDigest` inputs, and reads model hints from
  `CW_ARCHITECTURE_REVIEW_FAST_MODEL` and
  `CW_ARCHITECTURE_REVIEW_STRONG_MODEL`.
- `source-context export --cache-dir DIR` caches JSONL by resolved git commit SHA
  plus source-profile digest; cache hits must be byte-identical JSONL and corrupt
  cache records fail closed.
- `scripts/architecture-review-fast.js` is the automated fast-review wrapper. It
  exports cached source context for a target repo, computes the JSONL digest,
  starts `architecture-review-fast`, and can schedule a one-shot background
  `architecture-review` run with `--schedule-full`.
- `scripts/architecture-review-fast.js --metrics` is opt-in. Default JSON output
  remains unchanged; the metrics payload reports elapsed milliseconds, source
  context bytes, fast-review step counts, agent-spawn counts, and result-cache
  hit counts.
- Task `resultCache` is explicit opt-in. `architecture-review-fast` Map workers
  cache accepted results by `sourceContextDigest` plus rendered prompt digest;
  cache hits copy the cached result into the worker-local result path and still
  pass through normal worker-output validation. Missing or invalid cache entries
  never fabricate success.

## Failed Attempts

- Do not treat `.jsonl` slimming, god-object refactors, and physical repository
  line-count reduction as the same task. They have different risk profiles.
- Do not silently omit files from an AI context pack. Omitted files need a
  manifest entry with reason, size, line count, and digest.

## Last Session

- Added the opt-in `architecture-review-fast` app, source-context cache support,
  docs, project index updates, and smoke coverage. The full
  `architecture-review` app remains unchanged.
- Verification for the fast-review cycle: `npm run build`, `npm test` 74/74,
  `npm run gen:manifests -- --check`, `npm run index:check`,
  `node scripts/version-sync-check.js`, `git diff --check`, no new task markers,
  and a local 5-skill frontmatter check.
- Continued the runtime-acceleration cycle by adding opt-in worker result
  caching plus the automated `architecture-review-fast.js` launcher. Verification:
  `npm run build`, targeted fast/source-context/workflow smokes, canonical apps,
  version sync, manifests/index checks, `npm test` 75/75, `git diff --check`,
  and no new task markers.
- Merged PR #120, then added opt-in fast-review metrics for live duration and
  cache-hit measurement. Verification: targeted architecture-review-fast smokes,
  `npm run build`, manifest/index/version checks, `git diff --check`, no new
  task markers, and `npm test` 75/75.

## Next Run

- Use `node plugins/cool-workflow/scripts/architecture-review-fast.js --repo <repo> --profile core --once --metrics --schedule-full`
  for the automated 1→6 path on a CW-shaped repo. Use `--profile-file` for
  non-CW repositories.
- Next acceleration target: measure live fast-review duration and
  `metrics.fastReview.resultCacheHits` with a real agent, then consider opt-in
  caching for Assess summaries only if the validation trace proves Map caching
  is not enough.
- When a repeated workflow improves, update the matching skill and add or revise
  `eval/<workflow>.jsonl`.
