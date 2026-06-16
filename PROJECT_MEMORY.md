# Project Memory

This is the repo-local memory for Cool Workflow agent runs. Keep it true to fact,
short, and simple to add to. Do not use it for guesses.

## Verified Facts

- Default context slimming has to use the `core` source profile.
- The `core` profile takes in:
  - `plugins/cool-workflow/src/**`
  - `plugins/cool-workflow/apps/**`
  - `plugins/cool-workflow/package.json`
  - `plugins/cool-workflow/tsconfig.json`
  - `plugins/cool-workflow/scripts/cw.js`
  - `plugins/cool-workflow/scripts/mcp-server.js`
  - `plugins/cool-workflow/scripts/agents/**`
- The `core` profile keeps out:
  - `plugins/cool-workflow/dist/**`
  - `plugins/cool-workflow/test/**`
  - `plugins/cool-workflow/docs/**`
  - `docs/assets/**`
  - `.cw-release/**`
  - `CHANGELOG.md`
  - `ITERATION_LOG.md`
- Keeping `dist/` out of the context pack is let through; deleting committed `dist/`
  is a separate release-contract decision.
- Context slimming is opt-in and must not change the CW command output we have now.
- `core` is still the default source context profile. Narrow opt-in profiles are there
  for scoped runs: `runtime`, `mcp`, `workflow-apps`, `release`, and
  `agent-wrappers`.
- `source-context --changed-from REF` is an opt-in diff-aware mode. It cuts the
  manifest/export down to changed current-ref files before profile inclusion, leaves out
  deleted files, keeps a note of the worked-out `changedFrom` base, and uses a separate
  cache key from full exports.
- Skill trigger metadata has to be in normal YAML frontmatter. Every
  `SKILL.md` needs `name` and a `description` full of triggers; the body is loaded
  only after a skill triggers and must not be the one place the trigger text comes from.
- Plan for making the runtime quicker:
  1. Add an opt-in fast architecture-review path that runs Map and Assess work
     as parallel phases in place of serial agent calls.
  2. Keep separate `fast` and `full` review modes so users can get a useful
     first result quickly while the deep review we have now is still there to use.
  3. Make one JSONL source context per run and give that fixed context to
     agent wrappers in place of making every worker go and find the repository again.
  4. Send cheap, fast models to mapping and summarization work, and keep the
     stronger models for verification and last verdict tasks.
  5. Cache source context and middle maps by git SHA plus profile digest,
     and fail closed when the digest does not match.
  6. Move long full reviews to routines/background runs so foreground user
     flows give back progress and a fast report in place of stopping for 40 minutes.
- `architecture-review-fast` is the opt-in fast/full split build. It
  keeps `architecture-review` the same, plans 6 workers in place of 14, runs Map
  and Assess as parallel phases, takes in possible `sourceContext` and
  `sourceContextDigest` inputs, and reads model hints from
  `CW_ARCHITECTURE_REVIEW_FAST_MODEL` and
  `CW_ARCHITECTURE_REVIEW_STRONG_MODEL`.
- For model routing in user workflows, it is better to use wrapper flags:
  `architecture-review-fast --fast-model <fast> --strong-model <strong>`. The
  flags set the same task-level hints as the env vars; the model attestation kept on record
  still comes only from the outside agent output.
- `source-context export --cache-dir DIR` caches JSONL by resolved git commit SHA
  plus source-profile digest; cache hits must be byte-identical JSONL and corrupt
  cache records fail closed.
- `scripts/architecture-review-fast.js` is the automated fast-review wrapper. It
  exports cached source context for a target repo, computes the JSONL digest,
  starts `architecture-review-fast`, and can schedule a one-shot background
  `architecture-review` run with `--schedule-full`.
- `architecture-review-fast --schedule-full` stores foreground handoff context in
  the schedule prompt: fast run id, fast report path, source-context digest and
  profile, plus an instruction to return the full review report path and digest.
- `scripts/architecture-review-fast.js --metrics` is opt-in. Default JSON output
  remains unchanged; the metrics payload reports elapsed milliseconds, source
  context bytes, fast-review step counts, agent-spawn counts, and result-cache
  hit counts.
- Live baseline on 2026-06-13 using the bundled Claude wrapper against this repo
  with the `core` profile: first `architecture-review-fast --once --metrics`
  completed the two Map workers in 190118ms with `agentSpawns=2` and
  `resultCacheHits=0`; the immediate second identical run completed in 703ms
  with `agentSpawns=0` and `resultCacheHits=2`.
- Continuing that same live run showed Assess at 209149ms, Verify at 133709ms,
  Verdict at 127522ms, and the final commit at 323ms. Assess is the largest
  remaining measured foreground phase.
- Task `resultCache` is explicit opt-in. `architecture-review-fast` Map workers
  cache accepted results by `sourceContextDigest` plus rendered prompt digest;
  Assess workers additionally include completed previous-phase result digests in
  the cache key. Cache hits copy the cached result into the worker-local result
  path and still pass through normal worker-output validation. Missing or
  invalid cache entries never fabricate success.

## Failed Attempts

- Do not treat `.jsonl` slimming, god-object refactors, and physical repository
  line-count reduction as the same task. They have different risk profiles.
- Do not silently omit files from an AI context pack. Omitted files need a
  manifest entry with reason, size, line count, and digest.
- Do not make live agent output default behavior on an existing wrapper or drive
  path. Default stdout/stderr bytes are a POLA contract; stream-json rendering
  must be explicit opt-in (`CW_AGENT_STREAM=1`), TTY-gated, and still silent when
  piped.

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
- Since Map caching is proven live, next acceleration target is to run or
  instrument the remaining Assess/Verify/Verdict phases, then add opt-in Assess
  caching only if those summaries dominate the foreground wait.
- After Assess caching, use narrow source profiles before inventing a more
  complex context mechanism: `mcp`, `workflow-apps`, `release`, and
  `agent-wrappers` are much smaller than `core`; `runtime` is still large because
  it intentionally carries the full `src/**` kernel.
- For incremental review, prefer `--changed-from origin/main` plus a narrow
  profile. Treat the changed JSONL as an overlay, not a replacement for a full
  audit when broad architectural context is required.
- When a repeated workflow improves, update the matching skill and add or revise
  `eval/<workflow>.jsonl`.
