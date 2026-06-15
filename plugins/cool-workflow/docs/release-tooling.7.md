# Release Tooling

CW v0.1.33 adds Release Tooling: the mechanical, repetitive part of cutting a tag
becomes three deterministic scripts plus a de-duplicated release gate. Before
v0.1.33 a release meant hand-editing the version across ~17 surfaces and recreating
the same doc/test/CHANGELOG shapes by hand — slow, and the source of stale-version
gate failures. This release leaves the kernel runtime untouched and moves the toil
into tooling, so an author spends time on the feature, not the boilerplate.

The discipline is the same base-system separation used elsewhere: there is one
source of truth, and the mechanical surfaces are DERIVED from it, fail-closed.

## bump:version

```text
node scripts/bump-version.js <new-version>
npm run bump:version -- 0.1.33
```

One command rewrites every STRUCTURED version surface from a single source
(`package.json`): `package.json`, `package-lock.json`, `src/version.ts`,
`manifest/plugin.manifest.json` (then `gen:manifests` propagates to the vendor
manifests), every `apps/*/app.json` (top-level `version` only, never
`compatibility.minVersion`), and the scripts/tests that hard-code the current
version as a current-version reference. The version string is swapped with a
TARGETED `old -> new` replace, so historical references (a prior `minVersion`, a
`pre-vX` note, a fixed demo version) are preserved. It then rebuilds `dist/`, runs
`version:sync`, and reports the remaining prose-doc surfaces.

`version-sync-check.js` reads the expected version from `package.json`, so the
checker can never drift from the bump source.

## new:feature

```text
node scripts/new-feature.js <slug> "<Title>" ["summary"]
```

Scaffolds the per-tag boilerplate: the `docs/<slug>.7.md` skeleton, a runnable
`test/<slug>-smoke.js` stub, and a `CHANGELOG` entry, then PRINTS the exact
gate-file edits (capability registry, `version:sync` assertions, the `docs presence`
list, the `npm test` chain). Gate files are printed, never auto-edited, so a
scaffold can never silently break a release gate.

## forward-ref

```text
node scripts/forward-ref-docs.js "<Title>" "<summary>"
```

Appends a `## <Title> (vX)` forward-reference section to every doc `version:sync`
requires to carry the current version (the repo's per-release documentation
pattern). APPEND-ONLY and idempotent: it never rewrites a historical version label
and re-running for the same version is a no-op.

## De-duplicated release:check

`release:check` previously ran `npm test` AND then re-ran ~15 of those same smoke
tests individually (plus redundant `eval:replay`/`fixture-compat` re-runs). Every
individual step is already covered by `npm test`, so they were removed — the gate
keeps full coverage while dropping the duplicate wall time. The steps that remain
are the ones NOT covered by `npm test`: build, type check, `npm test`,
canonical-apps, golden-path, parity, vendor-manifest drift, and `version:sync`.

## Boundary

Release Tooling touches only the build/release surfaces. It adds no runtime
capability, no CLI/MCP verb, and no run-state schema change; the kernel is
unchanged. Older releases cut by hand remain valid — the scripts only standardize
the mechanical surfaces a tag must update.

## See Also

cli-mcp-parity(7), release-and-migration(7), dogfood-one-real-repo(7)

## Real Execution Backend Integrations (v0.1.34)

container/remote/ci backends really execute (docker/podman run, remote/CI POST-and-poll) under the sandbox contract, with byte-stable evidence vs node and fail-closed refusal when a runtime/endpoint is unavailable. See real-execution-backends(7).

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

capture findings/evidence from any reasonable agent shape (alt keys + prose), CW derives grounded evidence itself, warn on empty capture — closes the v0.1.41 live-drive 'accepted with 0 captured' failure

## No-False-Green Gate & Launch Prep (v0.1.43)

Hard gate blocking empty-capture verifier-gated commits, plus quickstart and launch-prep docs.

## Release-Gate Determinism & Agents Vendor (v0.1.44)

Release-readiness checks now validate the committed blob (`git show HEAD:<path>`) instead of the mutable working tree — eliminating false-red/false-green from concurrent working-tree writes (iCloud/Spotlight/editor). Adds the `agents` vendor manifest target: a generated `.agents/plugins/cool-workflow/` adapter giving any non-Claude AI agent one common interface to CW.

## P1-P2 Fixes & CI Content Surfaces (v0.1.49)

Migration DAG with reversible edges (v0.1.45), capability auto-discovery (v0.1.46), vendor-adapter registry (v0.1.47), state auto-compaction and P2 fixes (v0.1.48), plus CI content-surface determinism hardening (v0.1.49).

## Multi-platform release flow (`scripts/release-flow.js`)

The gated release ritual — deterministic gate → independent reviewer → verdict →
(tag) — is now ONE zero-dependency Node orchestrator that runs the same under any
harness. It does not depend on a host's agent-orchestration primitive; the only
LLM step (the reviewer) is **delegated** through CW's agent backend, so whichever
model you configure does the review. CW spawns the agent argv-style (`shell:false`),
inherits the agent's own credentials, and imports no model SDK — the red line.

```bash
# check only (gate + independent review, no mutation):
node plugins/cool-workflow/scripts/release-flow.js --check
# cut a tag once review is green (when --push, also creates the GitHub Release):
node plugins/cool-workflow/scripts/release-flow.js --cut --version 0.1.77 [--push] [--no-release]
# backfill / re-create the GitHub Release for an already-pushed tag (no gate/cut):
node plugins/cool-workflow/scripts/release-flow.js --release --version 0.1.77 [--soft]
```

The per-platform difference is config, not code — set the reviewer agent:

| Platform | Reviewer config |
|---|---|
| Claude    | `CW_AGENT_COMMAND="claude -p {{input}}"` |
| Codex     | `CW_AGENT_COMMAND="codex exec {{input}}"` |
| Gemini    | `CW_AGENT_COMMAND="gemini -p {{input}}"` |
| OpenCode  | `CW_AGENT_COMMAND="opencode run -m <provider/model> {{input}}"` |
| DeepSeek  | via OpenCode (`-m deepseek/deepseek-chat`) or `CW_AGENT_ENDPOINT=<deepseek-compatible HTTP agent>` |

`{{input}}` is substituted with the reviewer prompt file path. Gemini and OpenCode
also get generated MCP manifests (`.gemini-plugin/`, `.opencode-plugin/`) so the
`cw_*` tools are available as MCP tools in those hosts. The verdict path
(`.cw-release/review-<sha>.verdict`) and the tag-push CI backstop are unchanged.

### GitHub Release finishing step

A `--cut --push` finishes by creating the **GitHub Release** for the tag, and
`--release --version x.y.z` creates-or-skips one for an already-pushed tag
(backfill). The notes body is assembled from the `## x.y.z` CHANGELOG section as
shipped at the tag, the independent reviewer's one-line capability, and a
"Provenance & audit" footer linking the reviewed commit, the **committed** reviewer
verdict, the full diff, and the provenance-attested npm version.

This step is **distribution upside, not a correctness gate**: the load-bearing
artifacts (the tag and the provenance-attested npm publish) already exist when it
runs. Therefore `gh` is **not** part of the node/git portability floor — it runs
ONLY in the human `--cut --push` / `--release` paths (never a gate or CI path) and
is **idempotent** (skips if the Release already exists).

Failure semantics differ by mode: in the **`--cut --push` finishing step** an
absent/unauthenticated/erroring `gh` **skips with a stderr note and never fails the
cut** (the tag and npm publish stand) — opt out entirely with `--no-release`. In the
explicit **`--release` backfill** it **fails closed** (exit 1) with guidance, since
the operator asked for it directly; add `--soft` to downgrade `--release` to the same
best-effort skip-not-fail behavior.

Honesty: the notes claim the gated flow ("independent release-reviewer, verdict
above") **only when a committed `APPROVED` verdict is found at the tag**; backfilling
an ungated tag emits a neutral caveat instead and warns on stderr — the notes never
assert a review that isn't there. Test seam: `CW_RELEASE_FLOW_GH_CMD` swaps the `gh`
binary for a stub (spawned `shell:false`) so the smoke exercises it offline.

0.1.51

0.1.76

0.1.78

0.1.79

## Fast Architecture Review (v0.1.80)

Adds the opt-in fast architecture-review lane: scoped JSONL source contexts, diff-aware exports, reusable Map and Assess results, measurable wrapper metrics, actionable background full-review handoff, and userland model policy flags for routing fast/strong workers without changing the full review contract.

_No changes to the release-flow tooling in v0.1.81; this release was cut through the existing gate->review->tag flow._
_No changes to the release-tooling contract in v0.1.82._
