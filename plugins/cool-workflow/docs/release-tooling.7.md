# Release Tooling

CW v0.1.33 adds Release Tooling: the mechanical, do-it-again part of cutting a tag
becomes three deterministic scripts plus a de-duplicated release gate. Before
v0.1.33 a release meant changing the version by hand across ~17 surfaces and making
the same doc/test/CHANGELOG shapes by hand — slow, and the cause of stale-version
gate failures. This release leaves the kernel runtime untouched and moves the hard
work into tooling, so an author gives time to the feature, not the boilerplate.

The way of working is the same base-system separation used in other places: there is one
source of truth, and the mechanical surfaces are DERIVED from it, fail-closed.

## bump:version

```text
node scripts/bump-version.js <new-version>
npm run bump:version -- 0.1.33
```

One command rewrites every STRUCTURED version surface from a single source
(`package.json`): `package.json`, `package-lock.json`, `src/version.ts`,
`manifest/plugin.manifest.json` (then `gen:manifests` sends it on to the vendor
manifests), every `apps/*/app.json` (top-level `version` only, never
`compatibility.minVersion`), and the scripts/tests that fix the current
version in code as a current-version reference. The version string is changed with a
TARGETED `old -> new` replace, so older references (a past `minVersion`, a
`pre-vX` note, a fixed demo version) are kept. It then builds `dist/` again, runs
`version:sync`, and reports the prose-doc surfaces that are left.

`version-sync-check.js` reads the looked-for version from `package.json`, so the
checker can never get out of step with the bump source.

## new:feature

```text
node scripts/new-feature.js <slug> "<Title>" ["summary"]
```

Builds the per-tag boilerplate frame: the `docs/<slug>.7.md` skeleton, a runnable
`test/<slug>-smoke.js` stub, and a `CHANGELOG` entry, then PRINTS the exact
gate-file edits (capability registry, `version:sync` assertions, the `docs presence`
list, the `npm test` chain). Gate files are printed, never changed on their own, so a
new frame can never quietly break a release gate.

## forward-ref

```text
node scripts/forward-ref-docs.js "<Title>" "<summary>"
```

Adds a `## <Title> (vX)` forward-reference section at the end of every doc `version:sync`
needs to carry the current version (the repo's per-release documentation
pattern). APPEND-ONLY and idempotent: it never rewrites an older version label
and running it again for the same version does nothing.

## De-duplicated release:check

`release:check` before this ran `npm test` AND then ran ~15 of those same smoke
tests again one by one (plus extra `eval:replay`/`fixture-compat` re-runs). Every
single step is already covered by `npm test`, so they were taken out — the gate
keeps full coverage while cutting the doubled wall time. The steps that stay
are the ones NOT covered by `npm test`: build, type check, `npm test`,
canonical-apps, golden-path, parity, vendor-manifest drift, and `version:sync`.

The drift gates `index:check` (`docs/project-index.md`) and `readme:check`
(`plugins/cool-workflow/README.md`) also run here. The npm package README is
GENERATED from the repo-root `README.md` by `scripts/sync-readme.js` — it changes
only the relative image/link URLs npm cannot render (`docs/assets/*` to
`raw.githubusercontent.com`, `](LICENSE)`/`](plugins/...)` to `.../blob/main/...`),
so the npm page and the GitHub page stay identical. Edit the GitHub `README.md`,
then run `npm run sync:readme`; `readme:check` fails the gate if they drift. The
teeth live in `test/readme-sync-smoke.js`.

For timing work, the smoke runner can write a JSON timing report without changing
the normal output:

```text
npm run test:ci -- --json-summary /tmp/cw-test-summary.json
```

The file lists wall time, total child time, and the slowest smokes. Use it to
pick one speed cycle at a time; it is diagnostic, not a hard release threshold.

The dogfood release smoke and the architecture-review dogfood smoke are separate
test files. The split keeps the same release and agent-drive proof, but lets
`test:ci` schedule the two long checks in parallel.

## Boundary

Release Tooling touches only the build/release surfaces. It adds no runtime
capability, no CLI/MCP verb, and no run-state schema change; the kernel is
unchanged. Older releases cut by hand are still good — the scripts only make
the mechanical surfaces a tag must update the same each time.

## See Also

cli-mcp-parity(7), release-and-migration(7), dogfood-one-real-repo(7)

## Real Execution Backend Integrations (v0.1.34)

container/remote/ci backends really run (docker/podman run, remote/CI POST-and-poll) under the sandbox contract, with byte-stable evidence next to node and fail-closed refusal when a runtime/endpoint is not there. See real-execution-backends(7).

## Node Snapshot / Diff / Replay (v0.1.35)

per-node snapshot, structural diff, and isolated deterministic replay over StateNode, reusing the v0.1.23 eval harness; fail-closed on source drift (valid|stale|absent). See node-snapshot-diff-replay(7).

## Contract Migration Tooling (v0.1.36)

first-class declared migration registry (run-state + workflow-app) with per-edge compatibility proofs, fail-closed reachability, and a round-trip/non-destruction prover. See contract-migration-tooling(7).

## Control-Plane Scheduling (v0.1.37)

priority + concurrency limits + lease lifecycle + retry/backoff + fail-closed park over the v0.1.28 Run Registry queue; policy-as-data, deterministic. See control-plane-scheduling(7).

## Agent Delegation Drive (v0.1.38)

spawn an external agent process per worker, capture result.md + attestation, auto-drive plan->dispatch->fulfill->accept->commit

## Run Retention & Provable Reclamation (v0.1.39)

tiered, append-only, cryptographically-verifiable run reclamation: seal the audit skeleton, free the reconstructable bulk, prove it

## Durable State & Locking (v0.1.40)

atomic temp->rename writes + fsync-durability for authoritative stores; portable stale-stealing file lock serializing the cross-process read-modify-write stores

## Self-Audit Hardening & Pure-Router Decomposition (v0.1.41)

evidence grounding + durable audit append + symlink-hardened containment + deterministic worker ids + recursive redaction; BackendRegistry self-describing drivers (no per-id switches); orchestrator god-object decomposed into per-domain operation modules (pure loadRun->delegate router)

## Robust Result Ingest (v0.1.42)

capture findings/evidence from any fair agent shape (alt keys + prose), CW works out grounded evidence itself, warn on empty capture — closes the v0.1.41 live-drive 'accepted with 0 captured' failure

## No-False-Green Gate & Launch Prep (v0.1.43)

Hard gate blocking empty-capture verifier-gated commits, plus quickstart and launch-prep docs.

## Release-Gate Determinism & Agents Vendor (v0.1.44)

Release-readiness checks now check the committed blob (`git show HEAD:<path>`) and not the changeable working tree — taking away false-red/false-green from working-tree writes at the same time (iCloud/Spotlight/editor). Adds the `agents` vendor manifest target: a generated `.agents/plugins/cool-workflow/` adapter giving any non-Claude AI agent one shared way in to CW.

## P1-P2 Fixes & CI Content Surfaces (v0.1.49)

Migration DAG with reversible edges (v0.1.45), capability auto-discovery (v0.1.46), vendor-adapter registry (v0.1.47), state auto-compaction and P2 fixes (v0.1.48), plus CI content-surface determinism hardening (v0.1.49).

## Multi-platform release flow (`scripts/release-flow.js`)

The gated release ritual — deterministic gate → independent reviewer → verdict →
(tag) — is now ONE zero-dependency Node orchestrator that runs the same under any
harness. It does not lean on a host's agent-orchestration primitive; the only
LLM step (the reviewer) is **delegated** through CW's agent backend, so whichever
model you set up does the review. CW starts the agent argv-style (`shell:false`),
takes on the agent's own credentials, and pulls in no model SDK — the red line.

```bash
# check only (gate + independent review, no mutation):
node plugins/cool-workflow/scripts/release-flow.js --check
# cut a tag once review is green (when --push, also creates the GitHub Release):
node plugins/cool-workflow/scripts/release-flow.js --cut --version 0.1.77 [--push] [--no-release]
# backfill / re-create the GitHub Release for an already-pushed tag (no gate/cut):
node plugins/cool-workflow/scripts/release-flow.js --release --version 0.1.77 [--soft]
```

The per-platform difference is config, not code — set the reviewer agent here:

| Platform | Reviewer config |
|---|---|
| Claude    | `CW_AGENT_COMMAND="claude -p --permission-mode acceptEdits {{input}}"` |
| Codex     | `CW_AGENT_COMMAND="codex exec {{input}}"` |
| Gemini    | `CW_AGENT_COMMAND="gemini -p {{input}}"` |
| OpenCode  | `CW_AGENT_COMMAND="opencode run -m <provider/model> {{input}}"` |
| DeepSeek  | via OpenCode (`-m deepseek/deepseek-chat`) or `CW_AGENT_ENDPOINT=<deepseek-compatible HTTP agent>` |

The reviewer's last act is to **write** the verdict file, so a headless agent
needs file-write permission. For `claude -p`, recent CLIs default to a mode that
silently denies `Write` (no prompt in headless mode), so the reviewer reaches a
verdict but cannot persist it and the flow fails closed at `[3/3] verify` with
`no verdict written`. The `--permission-mode acceptEdits` flag in the preset above
fixes this; Read/Bash (which the review itself needs) keep working. The reviewer
CLI must also be logged in (`claude auth login` / `claude auth status` →
`loggedIn: true`) — a fresh shell or CI runner is not.

`{{input}}` is put in place of the reviewer prompt file path. Gemini and OpenCode
also get generated MCP manifests (`.gemini-plugin/`, `.opencode-plugin/`) so the
`cw_*` tools are there as MCP tools in those hosts. The verdict path
(`.cw-release/review-<sha>.verdict`) and the tag-push CI backstop are unchanged.

### GitHub Release finishing step

A `--cut --push` ends by creating the **GitHub Release** for the tag, and
`--release --version x.y.z` creates-or-skips one for an already-pushed tag
(backfill). The notes body is put together from the `## x.y.z` CHANGELOG section as
shipped at the tag, the independent reviewer's one-line capability, and a
"Provenance & audit" footer linking the reviewed commit, the **committed** reviewer
verdict, the full diff, and the provenance-attested npm version.

This step is **distribution upside, not a correctness gate**: the load-bearing
artifacts (the tag and the provenance-attested npm publish) are there already when it
runs. So `gh` is **not** part of the node/git portability floor — it runs
ONLY in the human `--cut --push` / `--release` paths (never a gate or CI path) and
is **idempotent** (skips if the Release is there already).

Failure behavior is not the same by mode: in the **`--cut --push` finishing step** an
absent/unauthenticated/erroring `gh` **skips with a stderr note and never fails the
cut** (the tag and npm publish stand) — opt out fully with `--no-release`. In the
clear **`--release` backfill** it **fails closed** (exit 1) with guidance, since
the operator asked for it straight; add `--soft` to bring `--release` down to the same
best-effort skip-not-fail behavior.

Honesty: the notes claim the gated flow ("independent release-reviewer, verdict
above") **only when a committed `APPROVED` verdict is found at the tag**; backfilling
an ungated tag gives a plain caveat instead and warns on stderr — the notes never
claim a review that is not there. Test seam: `CW_RELEASE_FLOW_GH_CMD` puts a stub in place of the `gh`
binary (spawned `shell:false`) so the smoke runs it offline.

### npm publishing trust

The `npm-publish` GitHub Action uses npm Trusted Publishing. GitHub gives the
job a short OIDC token, npm checks that the request is from this repo and
workflow, and npm adds provenance for the package. The workflow does not use a
long-lived `NPM_TOKEN`, so no publish token with two-factor bypass is kept in
GitHub secrets.

0.1.51

0.1.76

0.1.78

0.1.79

## Fast Architecture Review (v0.1.80)

Adds the opt-in fast architecture-review lane: scoped JSONL source contexts, diff-aware exports, reusable Map and Assess results, measurable wrapper metrics, useful background full-review handoff, and userland model policy flags for routing fast/strong workers without changing the full review contract.

_No changes to the release-flow tooling in v0.1.81; this release was cut through the existing gate->review->tag flow._
_No changes to the release-tooling contract in v0.1.82._

## Hardening and Onboarding (v0.1.83)

Loaders fail closed on corrupt state; store writes are made safe under more than one writer; a new cw doctor checks your setup; help lists every command; and the docs are put into Basic English.

## Privacy Release (v0.1.84)

`release-flow` now writes reviewer input with repo-local paths, so local user home names do not enter the saved review prompt.

0.1.85

0.1.86

## 0.1.87 (v0.1.87)

npm test parallel, 4-vendor wrappers (Claude/Codex/Gemini/OpenCode), Homebrew-style CLI UX (colors/did-you-mean/categorized help/error tips/cw info/cw search/cw man/doctor --fix), post-success summaries, agent execution timing

## 0.1.88 (v0.1.88)

The release flow now captures the reviewer's verdict from agent stdout (`release-flow.js`), so the cut records the gate decision deterministically instead of relying on a hand-entered verdict; the kernel runtime stays untouched.

## 0.1.89 (v0.1.89)

_No behavioral change in v0.1.89 (CLI-surface golden-path + help-output fixes only; this subsystem is unchanged)._

0.1.90

0.1.91

0.1.93

0.1.94
