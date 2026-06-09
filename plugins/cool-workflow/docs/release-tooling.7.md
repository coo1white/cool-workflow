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
