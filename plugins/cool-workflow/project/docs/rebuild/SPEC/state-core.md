# state-core

## Scope

The durable run-state kernel: the `.cw/runs/<id>/` on-disk layout, atomic and durable JSON writes, the cross-process file lock, run-state schema migration and normalization, `StateNode` lifecycle and pipeline-contract gates, node snapshot/diff/replay, the state-explosion summary layer, the contract-migration prover, the small JSON-schema validator, and the persisted-record shape guards. Files: `src/state.ts`, `src/state-node.ts`, `src/state-migrations.ts`, `src/run-state-schema.ts`, `src/node-projection.ts`, `src/node-snapshot.ts`, `src/state-explosion.ts`, `src/state-explosion/helpers.ts`, `src/state-explosion/size.ts`, `src/state-explosion/format.ts`, `src/contract-migration.ts`, `src/schema-validate.ts`, `src/validation.ts`.

## Public surface

### Version constants (from `src/version.ts`, one level out)

- `WORKFLOW_APP_SCHEMA_VERSION = 1` (src/version.ts:2)
- `CURRENT_RUN_STATE_SCHEMA_VERSION = 1` (src/version.ts:3)
- `LEGACY_RUN_STATE_SCHEMA_VERSION = 0` (src/version.ts:4)
- `MIN_SUPPORTED_RUN_STATE_SCHEMA_VERSION = 0` (src/version.ts:5)

### `src/state.ts` — persistence kernel

- `createRunPaths(runDir)` — returns a `RunPaths` object with 16 keys: `runDir`, `state` (`state.json`), `report` (`report.md`), `tasksDir`, `resultsDir`, `dispatchesDir`, `artifactsDir`, `commitsDir`, `stateNodesDir` (`nodes`), `feedbackDir`, `auditDir`, `workersDir`, `candidatesDir`, `multiAgentDir` (`multi-agent`), `blackboardDir`, `topologiesDir`. All joined under `runDir` (`core/state/run-paths.ts:13-33`).
- `ensureRunDirs(paths)` — the shell uses `mkdirSync` with `recursive: true` on `runDir` plus the 13 sub-dirs; missing optional dir fields fall back to `path.join(runDir, "<name>")` (`shell/run-store.ts:23-45`).
- `loadRunFromCwd(runId, cwd = process.cwd())` — refuses an empty id with `Missing run id`; runs `assertSafeRunId`; loads `<cwd>/.cw/runs/<runId>/state.json` through `loadRunStateFile` with `dryRun: true`; throws `Unsupported CW run state: <errors joined by "; ">` when the report status is `unsupported`; else returns the migrated `WorkflowRun` in memory (never writes) (src/state.ts:52-61).
- `loadRunStateFile(statePath, { dryRun? })` — `readJson` then `migrateRunState`; `dryRun` defaults to `true` (src/state.ts:63-70).
- `checkRunStateFile(statePath)` — same as load with `dryRun: true` (src/state.ts:72-74).
- `migrateRunStateFile(statePath, { write? })` — dry-run unless `write: true`; writes the migrated state back with `writeJson` ONLY when status is not `unsupported` AND `write` AND `report.writeRequired` (src/state.ts:76-82).
- `saveCheckpoint(run)` — sets `run.updatedAt` to a new ISO string, then under `withFileLock(run.paths.state)` calls `writeJson(run.paths.state, run, { durable: true })` (src/state.ts:84-91).
- `compactCheckpoint(run)` — deletes the 7 top-level keys `nodes`, `contracts`, `feedback`, `workers`, `sandboxProfiles`, `candidates`, `candidateSelections` when each is an empty array; if any were stripped, calls `saveCheckpoint`; returns the count stripped (src/state.ts:97-112).
- `readJson(file)` — throws `File not found: <file>` when absent; throws `Invalid JSON in <file>: <message>` on a parse error (src/state.ts:114-122).
- `writeJson(file, value, { durable? })` — atomic temp-then-rename write; see "Files on disk" for the exact rules (src/state.ts:140-172).
- `durableAppendFileSync(file, data)` — mkdir, open `"a"`, write, `fsyncSync`, close (src/state.ts:183-192).
- `realResolve(target)` — realpath the deepest EXISTING ancestor (follows symlinks), then re-join the not-yet-created tail; if nothing exists up to the root, returns `path.resolve(target)` (src/state.ts:206-221).
- `isContainedPath(candidate, allowed)` — true when `realResolve(candidate)` equals `realResolve(allowed)` or starts with it plus `path.sep` (src/state.ts:223-227).
- `withFileLock(targetPath, fn)` — portable advisory lock; see "Invariants" (src/state.ts:250-308).
- `safeFileName(value)` — replaces every run of chars outside `[a-zA-Z0-9_.:-]` with a single `_` (src/state.ts:310-312).
- `assertSafeRunId(value, context = "run id")` — refuses non-string or empty with `Invalid <context>: expected a non-empty string`; refuses any value not matching `/^[A-Za-z0-9._:-]+$/`, or equal to `.` or `..`, with `Unsafe <context>: <JSON.stringify(value)> must be a single path segment ([A-Za-z0-9._:-], not '.' or '..')`; returns the id on success (src/state.ts:326-334).
- `hashArtifactFile(artifact)` — reads `artifact.path` as utf8, sets `artifact.sha256` (full `sha256:<64-hex>` from `sha256()` in src/execution-backend/util.ts:13-15) and `artifact.sizeBytes` (`Buffer.byteLength`); a missing file is silently skipped, never a throw (src/state.ts:338-347).
- Re-export: `CURRENT_RUN_STATE_SCHEMA_VERSION` (src/state.ts:8).

### `src/state-node.ts` — StateNode lifecycle and contract gates

- `STATE_NODE_SCHEMA_VERSION = 1`, `PIPELINE_CONTRACT_SCHEMA_VERSION = 1` (src/state-node.ts:18-19).
- `PipelineContractError` — an `Error` with `name = "PipelineContractError"` and a `structured: StateNodeError` field; `at` defaults to now-ISO (src/state-node.ts:21-32).
- `createStateNode(input)` — returns a `StateNode` with `schemaVersion: 1`, `id` (given or deterministic fallback, see Invariants), `status` default `"pending"`, `createdAt`/`updatedAt` now, and empty-defaulted `inputs`/`outputs`/`artifacts`/`evidence`/`errors`/`parents`/`children` (src/state-node.ts:59-79).
- `transitionStateNode(node, input)` — checks the legal-transition matrix (see Invariants); ALSO refuses `committed` unless the node is already `verified` (`commit-without-verifier`); returns a NEW node with merged `outputs` (object spread), `artifacts`/`evidence` merged by id (replace-in-slot or append), `metadata` merged, fresh `updatedAt` (src/state-node.ts:81-110).
- `validatePipelineContract(contract)` — refuses wrong `schemaVersion` (`invalid-contract-schema`), missing `id`/`title`, empty `stages`, per-stage checks, missing `compatibility`, and `compatibility.minSchemaVersion > 1` (`incompatible-contract`) (src/state-node.ts:112-135).
- `assertNodeSatisfiesContract(node, contract, stageId)` — validates the contract, then the stage: unknown stage (`unknown-contract-stage`), kind not accepted (`unexpected-node-kind`), status not accepted (`unexpected-node-status`), required artifacts present AND their paths exist on disk, required evidence present, verifier gate (src/state-node.ts:137-164).
- `recordNodeError(node, error)` — returns a new node with `status: "failed"` and the error appended to `errors` with defaulted `at`/`nodeId` (src/state-node.ts:166-183).
- `linkStateNodes(parent, child)` — returns both nodes with de-duplicated `children`/`parents` arrays and fresh `updatedAt` (src/state-node.ts:185-198).
- `appendRunNode(run, node)` — upserts into `run.nodes` IN PLACE (replace at the same index when the id exists, else push at the end; the array reference is stable), then `writeRunNode` (src/state-node.ts:200-215).
- `upsertRunContract(run, contract)` — validates then upserts into `run.contracts` (src/state-node.ts:217-224).
- `writeRunNode(run, node)` — writes the node JSON to `<stateNodesDir>/<safeFileName(node.id)>.json` with `writeJson` (NOT durable) and returns the file path (src/state-node.ts:226-231).
- `artifactExists(artifact)` — `Boolean(artifact.path && fs.existsSync(artifact.path))` (src/state-node.ts:233-235).

### `src/state-migrations.ts` — run-state migration

- `RUN_STATE_MIGRATIONS` — ONE step: `from: 0, to: 1`, description `Mark legacy run state without schemaVersion as run-state schema 1.`, `migrate` sets `schemaVersion` default; `reverse` deletes `schemaVersion` only when it equals 1 (src/state-migrations.ts:62-79).
- `findMigrationPath(steps, fromVersion, toVersion)` — BFS shortest path over forward edges (`from -> to`) plus reverse edges (`to -> from`, only when the step has `reverse()`); same version returns `{ reachable: true, path: [] }`; no path returns `{ reachable: false, path: [], error: "no migration path from schemaVersion <from> to <to>" }` (src/state-migrations.ts:84-134).
- `migrateRunState(input, { statePath?, dryRun? })` — the load pipeline: detect → bound-check → clone → path steps → `normalizeRunState` → `validateMigratedRunState` → status. Returns `{ run, report }` (src/state-migrations.ts:136-201). See Invariants for the exact rules.
- `reverseRunState(input, targetSchemaVersion, options)` — same shape but takes a target version; refuses a target below min or above current; warns on destructive changes: `Destructive reverse change at <path>: removed <JSON.stringify(before)>` (src/state-migrations.ts:207-276).
- Types: `StateCompatibilityStatus = "current" | "migrated" | "normalized" | "unsupported"`, `StateMigrationChange { path, before?, after?, reason }`, `StateMigrationReport`, `StateMigrationResult`, `StateMigrationStep`, `MigrationPathStep` (src/state-migrations.ts:10-60).

### `src/run-state-schema.ts` — the single field-list source

- `REQUIRED_TOP_LEVEL_KEYS` = `schemaVersion, id, createdAt, updatedAt, cwd, workflow, inputs, loopStage, phases, tasks, dispatches, commits, paths` (src/run-state-schema.ts:18-32).
- `REQUIRED_ARRAY_KEYS` = `phases, tasks, dispatches, commits` (src/run-state-schema.ts:35-40).
- `REQUIRED_RECORD_KEYS` = `workflow, paths, multiAgent, blackboard, topologies` (src/run-state-schema.ts:43-49).
- `OPTIONAL_TOP_LEVEL_KEYS` = `nodes, contracts, feedback, audit, workers, sandboxProfiles, customSandboxProfiles, candidates, candidateSelections, multiAgent, blackboard, topologies, collaboration` (src/run-state-schema.ts:55-69). A build gate (`validate-run-state-schema.js`) matches this module against the `WorkflowRun` type, fail-closed. The same gate reads `schema-version-inventory.json` and requires one `*_SCHEMA_VERSION` definition in its named source for each schema domain. Unknown, second, moved, and dead definitions fail the gate. Different domains stay separate (scripts/validate-run-state-schema.js; scripts/schema-version-inventory.json).

### `src/node-projection.ts` — the canonical node projection

- `rawNodeProjection(node)` — the ONE place that lists the 13 projected fields: `id, kind, status, loopStage, inputs, outputs, artifacts, evidence, errors, parents, children, contractId, metadata` (no `createdAt`/`updatedAt`/`schemaVersion`) (src/node-projection.ts:29-45).
- `projectNodeBody(node)` — `normalizeValue(rawNodeProjection(node))`, the `NodeSnapshotBody` (src/node-projection.ts:50-52).
- `nodeProjectionDigestInput(node)` — `replayStableStringify(rawNodeProjection(node))` (src/node-projection.ts:57-59). Shared with `src/reclamation.ts` so the tombstone chain cannot drift (src/node-projection.ts:1-20).

### `src/node-snapshot.ts` — snapshot / diff / replay

- `NODE_SNAPSHOT_SCHEMA_VERSION = 1` (src/node-snapshot.ts:43).
- `NodeSnapshotError` — `name = "NodeSnapshotError"`, fields `code`, optional `freshness`, optional `details` (src/node-snapshot.ts:46-57).
- `snapshotNode(run, nodeId, { now?, persist? })` — refuses an absent node (`node-absent`, freshness `absent`); builds `{ schemaVersion: 1, snapshotId, runId, nodeId, capturedAt, sourceFingerprint, body }`; `snapshotId = "snap-" + safeFileName(nodeId) + "-" + <first 12 hex of the raw source fingerprint>`; persists by default under `nodes/snapshots/<safeFileName(nodeId)>/<snapshotId>.json` (src/node-snapshot.ts:135-154).
- `sourceFingerprint(node)` — RAW (not normalized): `fingerprintStrings(["node:<id>:<status>:<updatedAt>", "artifact:<id>:<path>"..., "evidence:<id>:<path or empty>"...])`; any transition flips it (src/node-snapshot.ts:80-86).
- `loadNodeSnapshot(run, snapshot)` — recomputes freshness from current source: node gone → `absent` with reason `source node <id> is gone from run <runId>`; a referenced artifact path missing on disk → `absent` with reason `referenced artifact path is unreadable: <artifactId>`; fingerprint changed → `stale` with reason `source node <id> changed since capture`; else `valid` (src/node-snapshot.ts:157-173).
- `diffNodeSnapshots(baseline, candidate)` — structural diff over 8 sections in fixed order `status, inputs, outputs, artifacts, evidence, errors, links, metadata` (`links` compares `{ parents, children }`); each section's `change` is `same|added|removed|changed` by comparing `replayStableStringify` bytes; non-same sections carry `baseline` and `candidate` values; returns `{ schemaVersion: 1, runId, baselineSnapshotId, candidateSnapshotId, baselineNodeId, candidateNodeId, changed, sections }` (src/node-snapshot.ts:59-68,181-208).
- `replayNodeSnapshot(run, snapshot, { now?, persist? })` — fail-closed on drift: freshness not `valid` throws `NodeSnapshotError` with code `snapshot-stale` or `snapshot-absent`; else builds `{ schemaVersion: 1, replayId, runId, nodeId, snapshotId, replayedAt, freshness: "valid", contractValidated, outputFingerprint, body }`; `replayId = "replay-" + snapshotId + "-" + <first 8 hex of outputFingerprint>`; `outputFingerprint = fingerprintStrings([replayStableStringify(normalizeValue(snapshot.body))])`; persists by default under `.../replays/<replayId>.json` (src/node-snapshot.ts:218-245).
- `verifyNodeReplay(run, replay, { now? })` — source node gone gives `{ pass: false, freshness: "absent", findings: [{ id: "source-absent", severity: "error", category: "source", reason: "source node <id> is gone" }] }`; else a fresh non-persisted snapshot is diffed against the replay body; each drifted section becomes a finding `{ id: "drift:<section>", severity: "error", category: <section>, reason: "replay diverged from source in <section>" }`; `pass` is true only with zero findings (src/node-snapshot.ts:249-283).
- `readNodeSnapshot(run, snapshotId)` — scans every dir under `nodes/snapshots/` for `<snapshotId>.json`; validates with `validateNodeSnapshot`; not found throws `snapshot-not-found`: `Node snapshot <id> not found in run <runId>` (src/node-snapshot.ts:106-115).
- `readNodeReplay(run, replayId)` — same scan for `replays/<replayId>.json`; not found throws `replay-not-found`: `Node replay <id> not found in run <runId>` (src/node-snapshot.ts:118-127).

### `src/state-explosion.ts` + `src/state-explosion/*` — derived summary layer

- `STATE_EXPLOSION_SCHEMA_VERSION = 1` (src/state-explosion/size.ts:6).
- `DEFAULT_STATE_EXPLOSION_THRESHOLDS = { graphNodes: 40, graphEdges: 60, blackboardMessages: 25, blackboardRecords: 40, collapseBucket: 6, totalRecords: 80 }` (src/state-explosion/size.ts:17-24).
- `computeStateSize(run, thresholds?)` / `computeStateSizeWithGraph(run, thresholds, graph)` — counts 12 record categories plus `graphNodes`/`graphEdges`; `total` is the sum of the 12; `reasons` (sorted) are added when a count passes a threshold, with exact strings: `graph has <n> nodes (> <t>)`, `graph has <n> edges (> <t>)`, `blackboard has <n> messages (> <t>)`, `blackboard has <n> records (> <t>)`, `run has <n> multi-agent records (> <t>)`; `compactionRecommended = reasons.length > 0` (src/state-explosion/size.ts:50-98).
- `GRAPH_VIEWS` = `full, compact, critical-path, failures, evidence, trust, topology, blackboard, candidate, commit-gate` (src/state-explosion.ts:74-85).
- `buildCompactGraph(run, view = "compact", { focus?, depth?, thresholds? })` — returns a `GraphSummaryRecord`; see Invariants for collapse rules (src/state-explosion.ts:552-709).
- `summarizeBlackboardDigest(run, blackboardId?)` — deterministic `BlackboardSummaryRecord` with 12 entry lists (`topicRollups`, `threadSummaries`, `unresolvedQuestions`, `conflicts`, `decisions`, `artifacts`, `adoptedEvidence`, `missingEvidence`, `policyViolations`, `judgeRationale`, `recentChanges` (last 10 by `updatedAt` desc), `highSignal`), every list sorted by id; record `id` is `blackboard-digest` or `blackboard-digest:<boardId>` (src/state-explosion.ts:302-526).
- `buildStateExplosionReport(run, { thresholds?, index? })` — the top-level `StateExplosionReport` with `freshness.status` `valid|stale|absent` computed against the persisted index fingerprint (absent index → `absent`; mismatch or any stale scope → `stale`) and `nextAction` becoming `cw summary refresh <runId>` when stale or absent (src/state-explosion.ts:1041-1103).
- `maybeCompactRun(run)` — best-effort: when `computeStateSize(run).compactionRecommended`, call `refreshStateExplosionSummaries(run)`; ALL errors silently caught (src/state-explosion.ts:1126-1135).
- `refreshStateExplosionSummaries(run, { thresholds?, views? })` — writes every summary record plus `index.json` and `state-explosion-report.json` under `<runDir>/summaries/`, then records a trust-audit event `kind: "summary.refresh", decision: "recorded", source: "runtime-derived", actor: "cw"` (src/state-explosion.ts:1141-1221).
- `loadStateExplosionSummaryIndex(run)` — reads `summaries/index.json`; returns `undefined` when the file is missing, unparseable, or its `id` is not `multi-agent-summary-index` (src/state-explosion.ts:1223-1233).
- `showStateExplosionSummary(run, { thresholds? })` — loads the index, builds the report; when a persisted index exists AND freshness is `stale`, records a trust-audit event `kind: "summary.stale", decision: "failed"` (src/state-explosion.ts:1235-1255).
- `normalizeStateExplosionForEval(run)` — 6 deterministic eval sections (`summaryFreshness`, `compactGraphShape`, `blackboardDigest`, `criticalPath`, `evidenceDigest`, `expansionRefs`) built with `stableLine` (key-sorted `JSON.stringify`) (src/state-explosion.ts:1261-1320).
- Helpers (src/state-explosion/helpers.ts): `isProtectedStatus` (true for `failed, blocked, rejected, conflicting`), `dominantStatus` (priority order `failed, blocked, rejected, conflicting, running, pending`, else first status, else `completed`), `parentMap` (first edge in wins), `stableLine`, `sortKeys`, `stripRunId`, `unique` (drops falsy, sorts), `byId`, `truncate` (whitespace-collapsed; over 80 chars becomes first 77 + `...`), `slug` (chars outside `[a-zA-Z0-9._:-]` become `-`).
- `fingerprintStrings(values)` — `"sha256:" + <first 32 hex of sha256(JSON.stringify(values sorted))>` (src/util/fingerprint.ts:6-10); `fingerprintRecords(records)` fingerprints `"<id>:<status or empty>"` lines (src/util/fingerprint.ts:12-14). Re-exported from src/state-explosion.ts:1327 and src/state-explosion/helpers.ts:11.
- Human formatters (CLI text only, never `--json`): `formatStateExplosionReport`, `formatCompactGraph`, `formatBlackboardDigest`, `stateExplosionReportLines` (src/state-explosion/format.ts:15-151).

### `src/contract-migration.ts` — declared migration registry + prover

- `CONTRACT_MIGRATION_SCHEMA_VERSION = 1` (src/contract-migration.ts:31).
- `listMigrationContracts()` — two contracts: `run-state` (currentVersion 1, minVersion 0, edges derived 1:1 from `RUN_STATE_MIGRATIONS` with proof `{ invariant: "run-state 0 -> 1: adds defaults only, drops no existing key", addsDefaulted: ["schemaVersion"], dropsNothing: true }`) and `workflow-app` (currentVersion 1, minVersion 1, `edges: []`) (src/contract-migration.ts:112-139).
- `resolveChain(contract, detected)` — fail-closed reachability; exact errors: `<contract> schemaVersion <d> is below the minimum supported <min>`, `<contract> schemaVersion <d> is newer than this runtime (<cur>)`, `<contract> schemaVersion <d> is not current (<cur>) and no migration edges exist`, `no migration edge from <contract> schemaVersion <v>` (src/contract-migration.ts:154-191).
- `checkMigration(contractId, snapshot)` — `MigrationVerdict { schemaVersion: 1, contract, status, detectedVersion, currentVersion, reachable, chain, changes, errors }`; a missing/non-number `schemaVersion` detects as 0 for `run-state` and 0 for `workflow-app` (src/contract-migration.ts:147-215).
- `proveMigration(contractId, snapshot)` — `MigrationProof { schemaVersion: 1, contract, verdict, validatesAtCurrent, appendOnly, idempotent, sourceImmutable, pass, sourceHash, resultHash, fingerprint, errors }`; `pass` requires all four proofs true AND zero errors; an `unsupported` verdict never transforms; hashes use `stableHash` (key-sorted, full sha256, `sha256:` prefix, src/contract-migration.ts:90-103); `appendOnly` = every source key survives recursively (src/contract-migration.ts:219-290).
- Unknown contract id throws `Unknown migration contract: <id>` (src/contract-migration.ts:141-145).

### `src/schema-validate.ts` — dependency-free JSON-schema subset

- `validateAgainstSchema(value, schema, path = "$")` — returns a string-error list, empty means valid; supports `type` (incl. arrays of types; `integer`, `null`), `const`, `enum`, `required`, `properties`, `additionalProperties: false`, `items` (single schema); unknown declared type is NOT enforced; a `type` mismatch stops downstream keyword checks for that level; unsupported keywords (`$ref`, `allOf`, `anyOf`, `oneOf`, `not`, `pattern`, `format`, `minimum`, `maximum`, `minLength`, `maxLength`, `minItems`, `maxItems`, `uniqueItems`, `contains`, `if`, `then`, `else`) are ignored, and ONLY when `process.stderr.isTTY` a diagnostic is written to stderr: `[cw] schema at <path>: unsupported keywords ignored: <list>\n` (src/schema-validate.ts:51-106).

### `src/validation.ts` — persisted-record shape guards

- `RecordValidationError` — `name = "RecordValidationError"`, `code = "record-shape-invalid"`, `message = "Invalid persisted <TypeName>: <reason>"`, plus `typeName` and optional `field` (src/validation.ts:74-84).
- `validateWorkerScope(value)` (src/validation.ts:122-126), `validateNodeSnapshot(value)` (src/validation.ts:168-172), `validateNodeReplayRun(value)` (src/validation.ts:205-209), `validateCandidateScore(value)` (src/validation.ts:242-246), `validateCandidateRecord(value)` (src/validation.ts:286-290) — each checks `schemaVersion === 1`, required string fields, enum fields, and typed arrays; throw on mismatch.
- `tryValidateCandidateScore(value)` — returns `null` on mismatch, never throws (src/validation.ts:250-252).

### CLI verbs backed directly by this core (wired in `src/cli/` and `src/orchestrator/`)

- `cw state check <run-id> [--state PATH] [--write] [--cwd PATH]` — prints the `StateMigrationReport` as pretty JSON; sets `process.exitCode = 1` when `report.status === "unsupported"`; wrong subcommand throws `Usage: cw state check <run-id> [--state PATH] [--write]` (src/cli/command-surface.ts:286-298; src/orchestrator/lifecycle-operations.ts:428-435).
- `cw migration list` / `cw migration check <target> [--contract run-state|workflow-app]` / `cw migration prove <target> [--contract ...]` — check exits 1 on `unsupported`; prove exits 1 when `!proof.pass`; prove appends the proof to `<targetDir>/migration/<first 16 hex of fingerprint>.json` (best-effort; a read-only target still returns the proof); `<target>` is an existing file path, else `<cwd>/.cw/runs/<target>/state.json`; a missing target throws `Migration target not found: <target>`; wrong subcommand throws `Usage: cw migration list|check|prove [target] [--contract run-state|workflow-app]` (src/cli/handlers/operational.ts:83-104; src/orchestrator/migration-operations.ts:9-38).
- `cw node snapshot <run-id> <node-id>` / `cw node diff <run-id> <baseline-snapshot-id> <candidate-snapshot-id>` / `cw node replay <run-id> <snapshot-id>` / `cw node verify <run-id> <replay-id>` — all print pretty JSON; `verify` sets `process.exitCode = 1` when `!verdict.pass` (src/cli/handlers/node.ts:28-52; src/orchestrator.ts:570-587).
- `cw summary refresh <run-id> [--json]` / `cw summary show <run-id> [--json]` — refresh also runs `writeReport` + `saveCheckpoint`; show runs `saveCheckpoint`; without `--json` both print `formatStateExplosionReport` text; wrong subcommand throws `Usage: cw summary refresh|show <run-id> [--json]` (src/cli/handlers/operator.ts:119-137; src/orchestrator.ts:461-474).
- `cw commit` post-step calls `maybeCompactRun(run)` after `saveCheckpoint` (src/orchestrator/lifecycle-operations.ts:437-461).
- All CLI JSON goes through `printJson`: `JSON.stringify(value, null, 2)` + `\n` on stdout (src/cli/io.ts:17-19).
- Env vars: none read in these modules.

## Exact outputs

### JSON bytes on disk (every file this core writes)

```text
JSON.stringify(value, null, 2) + "\n"
```
(src/state.ts:145) — 2-space indent, one trailing newline. Every state, node, snapshot, replay, summary, and proof file has these bytes.

### `StateMigrationReport` shape (what `cw state check` prints)

```json
{
  "status": "current|migrated|normalized|unsupported",
  "statePath": "<abs path or absent>",
  "detectedSchemaVersion": 0,
  "currentSchemaVersion": 1,
  "supportedSchemaVersions": { "min": 0, "max": 1 },
  "dryRun": true,
  "writeRequired": false,
  "changes": [ { "path": "schemaVersion", "before": null, "after": 1, "reason": "..." } ],
  "warnings": [],
  "errors": []
}
```
(src/state-migrations.ts:19-33; `before` is absent when it was `undefined` — JSON drops undefined keys.)

### Migration error strings (byte-exact)

```text
Run state must be a JSON object.
Unsupported run-state schemaVersion <desc>.
Run state schemaVersion <desc> is newer than this CW runtime (1).
no migration path from schemaVersion <from> to <to>
No migration path from run-state schemaVersion <detected>.
Missing required run-state field: <key>.
Expected schemaVersion 1; found <value>.
<key> must be an object.
<key> must be an array.
<key> must be an object when present.
<key> must be an array when present.
Target schemaVersion <t> is below the minimum supported 0.
Target schemaVersion <t> is newer than this CW runtime (1).
Destructive reverse change at <path>: removed <JSON.stringify(before)>
```
(src/state-migrations.ts:158-266,421-431,454-462.) `<desc>` is the number, or `non-object`, or `invalid (<typeof>: <String(value)>)` for a non-integer `schemaVersion` (src/state-migrations.ts:440-445).

### `state.ts` error strings (byte-exact)

```text
Missing run id
Unsupported CW run state: <errors joined by "; ">
File not found: <file>
Invalid JSON in <file>: <parse message>
could not acquire file lock for <targetPath>
File lock for <targetPath> was stolen during the critical section (lock now owned by another process). The operation may have lost cross-process isolation — increase FILE_LOCK_STALE_MS or split the work.
Invalid <context>: expected a non-empty string
Unsafe <context>: <JSON.stringify(value)> must be a single path segment ([A-Za-z0-9._:-], not '.' or '..')
```
(src/state.ts:53,58,115,120,274,288-292,328,331.)

### `PipelineContractError` codes (`error.structured.code`)

```text
illegal-transition            commit-without-verifier
invalid-contract-schema       invalid-contract-id
invalid-contract-title        invalid-contract-stages
invalid-contract-compatibility incompatible-contract
unknown-contract-stage        unexpected-node-kind
unexpected-node-status        missing-required-artifact
missing-artifact-path         missing-required-evidence
verifier-gate-blocked         verifier-gate-missing-evidence
invalid-contract-stage-id     duplicate-contract-stage
invalid-contract-stage-name   invalid-contract-stage-kinds
invalid-contract-stage-statuses invalid-contract-stage-output
```
Example messages: `State node <id> cannot transition from <from> to <to>`, `State node <id> cannot be committed before it is verified`, `Node <id> is missing required artifact <ref>`, `Node <id> artifact <artifactId> path does not exist`, `Node <id> is missing required evidence <ref>`, `Stage <id> requires verifier status <list joined by ", ">`, `Stage <id> requires evidence before commit` (src/state-node.ts:83-98,112-135,144-163,237-307).

### `NodeSnapshotError` codes and shapes

```text
node-absent        Cannot snapshot: node <nodeId> not found in run <runId>
snapshot-not-found Node snapshot <snapshotId> not found in run <runId>
replay-not-found   Node replay <replayId> not found in run <runId>
snapshot-stale     source node <nodeId> changed since capture
snapshot-absent    source node <nodeId> is gone from run <runId>
                   referenced artifact path is unreadable: <artifactId>
```
(src/node-snapshot.ts:114,126,138,163,167,170,218-226.)

`NodeSnapshot` JSON:
```json
{
  "schemaVersion": 1,
  "snapshotId": "snap-<safe-node-id>-<12 hex>",
  "runId": "...", "nodeId": "...",
  "capturedAt": "<ISO>",
  "sourceFingerprint": "sha256:<32 hex>",
  "body": { "id": "...", "kind": "...", "status": "...", "loopStage": "...", "inputs": {}, "outputs": {}, "artifacts": [], "evidence": [], "errors": [], "parents": [], "children": [], "contractId": "...", "metadata": {} }
}
```
`NodeReplayRun` JSON: `{ "schemaVersion": 1, "replayId": "replay-<snapshotId>-<8 hex>", "runId", "nodeId", "snapshotId", "replayedAt", "freshness": "valid", "contractValidated": <bool>, "outputFingerprint": "sha256:<32 hex>", "body": {...} }`.
`NodeSnapshotDiff` JSON: `{ "schemaVersion": 1, "runId", "baselineSnapshotId", "candidateSnapshotId", "baselineNodeId", "candidateNodeId", "changed": <bool>, "sections": [{ "section": "status", "change": "same" }, ...] }` — 8 sections always, in the fixed order.
`NodeReplayVerdict` JSON: `{ "schemaVersion": 1, "runId", "nodeId", "replayId", "pass": <bool>, "freshness": "valid|absent", "findings": [{ "id": "drift:<section>", "severity": "error", "category": "<section>", "reason": "replay diverged from source in <section>", "baselineRef": "<snapshotId>", "replayRef": "<replayId>" }] }`.
(src/node-snapshot.ts:141-149,229-240,198-207,249-283; src/types/state-node.ts:62-124.)

### `MigrationVerdict` / `MigrationProof` JSON

```json
{ "schemaVersion": 1, "contract": "run-state", "status": "migrated", "detectedVersion": 0, "currentVersion": 1, "reachable": true, "chain": [0, 1], "changes": 3, "errors": [] }
```
```json
{ "schemaVersion": 1, "contract": "run-state", "verdict": { ... }, "validatesAtCurrent": true, "appendOnly": true, "idempotent": true, "sourceImmutable": true, "pass": true, "sourceHash": "sha256:<64 hex>", "resultHash": "sha256:<64 hex>", "fingerprint": "sha256:<64 hex>", "errors": [] }
```
(src/contract-migration.ts:57-82,194-279.)

### Schema-validator error strings

```text
<path>: expected type <t1|t2>, got <actual>
<path>: expected const <JSON>
<path>: <JSON value> is not one of <JSON enum>
<path>: missing required property "<key>"
<path>: additional property "<key>" is not allowed
```
stderr (TTY only): `[cw] schema at <path>: unsupported keywords ignored: <k1, k2>\n` (src/schema-validate.ts:59,66,73,76,84,93). Paths look like `$.field[0].sub`.

### Fingerprint / hash formats

```text
fingerprintStrings -> "sha256:" + first 32 hex chars     (src/util/fingerprint.ts:6-10; inputs JSON-array-sorted)
sha256()           -> "sha256:" + all 64 hex chars       (src/execution-backend/util.ts:13-15)
stableHash()       -> "sha256:" + all 64 hex chars, key-sorted JSON (src/contract-migration.ts:90-103)
```

### Human summary text (first lines, `cw summary show` without `--json`)

```text
State Explosion Report: <runId>
Freshness: <status>[ (stale: <scope1, scope2>)]

State Size
  records=<n>; graph nodes=<n>; graph edges=<n>; messages=<n>; compaction=<recommended|not needed>
```
and later panels `Compact Graph`, `Blackboard Digest`, `Critical Path`, `Failures / Blockers`, `Evidence Digest`, `Trust / Policy Digest`, `Hidden Source Records`, `Expansion Commands`, `Next Action`; the collapse line is `  Graph compacted: <n> nodes collapsed into <m> summary nodes` (src/state-explosion/format.ts:15-63).

### Exit codes

```text
0  success
1  cw state check      -> report.status === "unsupported"
1  cw migration check  -> status === "unsupported"
1  cw migration prove  -> proof.pass === false
1  cw node verify      -> verdict.pass === false
```
(src/cli/command-surface.ts:292; src/cli/handlers/operational.ts:92,99; src/cli/handlers/node.ts:44-47.)

## Files on disk

### The full `.cw/runs/<run-id>/` layout

```text
.cw/runs/<run-id>/
├── state.json                  # WorkflowRun — THE single source of truth (durable atomic write, lock-serialized)
├── state.json.lock             # transient advisory lock: "<pid>@<ISO>\n" (src/state.ts:257-258)
├── state.json.tmp.<pid>.<n>    # transient atomic-write temp (renamed away or removed)
├── report.md                   # human report (written by report layer, path declared here)
├── tasks/                      # task prompt files
├── results/                    # result envelope files
├── dispatches/                 # dispatch manifests
├── artifacts/                  # run artifacts
├── commits/                    # commit snapshots
├── nodes/                      # one JSON per StateNode
│   ├── <safeFileName(nodeId)>.json
│   └── snapshots/
│       └── <safeFileName(nodeId)>/
│           ├── snap-<safe-node-id>-<12hex>.json      # NodeSnapshot
│           └── replays/
│               └── replay-<snapshotId>-<8hex>.json   # NodeReplayRun
├── feedback/
├── audit/
│   ├── events.jsonl            # trust-audit log (durable append) — default path in state.audit
│   ├── summary.json
│   └── index.json
├── workers/
├── candidates/
├── multi-agent/
├── blackboard/
├── topologies/
├── summaries/                  # derived, rebuildable (refreshStateExplosionSummaries)
│   ├── index.json              # MultiAgentSummaryIndex, id "multi-agent-summary-index"
│   ├── state-explosion-report.json
│   ├── blackboard-digest.json  # or blackboard-digest:<boardId> -> safeFileName'd
│   ├── operator-digest.json
│   └── graph-<view>.json       # one per view (10 default views)
└── migration/                  # appended MigrationProof files (cw migration prove)
    └── <first 16 hex of proof fingerprint>.json
```
Evidence: layout dirs src/state.ts:10-50; node files src/state-node.ts:226-231; snapshots src/node-snapshot.ts:96-127,150-152,241-243; audit defaults src/state-migrations.ts:322-330; summaries src/state-explosion.ts:1137-1202; migration proofs src/orchestrator/migration-operations.ts:21-27. Other dirs (`metrics/`, `clones/`, etc.) belong to other subsystems.

### `state.json` minimal example (after normalization, schema 1)

```json
{
  "schemaVersion": 1,
  "id": "demo-run",
  "createdAt": "1970-01-01T00:00:00.000Z",
  "updatedAt": "1970-01-01T00:00:00.000Z",
  "cwd": "/repo",
  "workflow": { "id": "unknown-workflow", "title": "Unknown Workflow", "summary": "", "limits": { "maxAgents": 8, "maxConcurrentAgents": 4 } },
  "inputs": {},
  "loopStage": "interpret",
  "phases": [],
  "tasks": [],
  "dispatches": [],
  "commits": [],
  "paths": { "runDir": "...", "state": ".../state.json", "report": ".../report.md", "tasksDir": ".../tasks", "resultsDir": ".../results", "dispatchesDir": ".../dispatches", "artifactsDir": ".../artifacts", "commitsDir": ".../commits", "stateNodesDir": ".../nodes", "feedbackDir": ".../feedback", "auditDir": ".../audit", "workersDir": ".../workers", "candidatesDir": ".../candidates", "multiAgentDir": ".../multi-agent", "blackboardDir": ".../blackboard", "topologiesDir": ".../topologies" },
  "nodes": [],
  "contracts": [],
  "feedback": [],
  "audit": { "schemaVersion": 1, "eventLogPath": ".../audit/events.jsonl", "summaryPath": ".../audit/summary.json", "indexPath": ".../audit/index.json" },
  "workers": [],
  "sandboxProfiles": [],
  "candidates": [],
  "candidateSelections": [],
  "multiAgent": { "schemaVersion": 1, "runs": [], "roles": [], "groups": [], "memberships": [], "fanouts": [], "fanins": [] },
  "blackboard": { "schemaVersion": 1, "boards": [], "topics": [], "messages": [], "contexts": [], "artifacts": [], "snapshots": [], "decisions": [] },
  "topologies": { "schemaVersion": 1, "runs": [] }
}
```
(Field set: src/types/run.ts:178-224; defaults: src/state-migrations.ts:278-417.)

### `nodes/<id>.json` — one `StateNode`

```json
{
  "schemaVersion": 1, "id": "...", "kind": "...", "status": "pending",
  "loopStage": "interpret", "createdAt": "<ISO>", "updatedAt": "<ISO>",
  "inputs": {}, "outputs": {}, "artifacts": [], "evidence": [], "errors": [],
  "parents": [], "children": [], "contractId": "...", "metadata": {}
}
```
(`contractId`/`metadata` absent when undefined; src/types/state-node.ts:14-31, src/state-node.ts:59-79.)

### Write ordering and atomic rules

1. `writeJson` (src/state.ts:140-172): `mkdirSync(dirname, { recursive: true })` → open `"<file>.tmp.<pid>.<counter>"` with flag `"w"` (counter is a per-process integer that goes up each call) → write the full bytes → if `durable`, `fsyncSync(fd)` → close → `renameSync(tmp, file)`. On rename failure: remove the temp (best-effort) and rethrow. If `durable`: open the parent dir and `fsyncSync` it (best-effort; errors swallowed). Readers ALWAYS see either the old bytes or the new bytes; never a torn file.
2. `saveCheckpoint` (src/state.ts:84-91): set `updatedAt` → take the lock on `state.json` → durable `writeJson` → release lock. `state.json` is the ONLY authoritative store in this subsystem; node/snapshot/summary files are derived and written non-durable (atomic rename only).
3. `durableAppendFileSync` (src/state.ts:183-192): used by the trust-audit event log — append + `fsync` before returning.
4. `refreshStateExplosionSummaries` write order: each summary record file → `index.json` → `state-explosion-report.json` → trust-audit event (src/state-explosion.ts:1156-1219).
5. `migrationProve` writes the proof AFTER computing it, never touching the source file (src/orchestrator/migration-operations.ts:21-27).

### Lock protocol (`withFileLock`, src/state.ts:243-308)

- Lock file: `<targetPath>.lock`, created with `openSync(lock, "wx")` (O_EXCL), body `"<pid>@<ISO>\n"`.
- Up to 240 tries; on `EEXIST`, if the lock's `mtimeMs` is older than `FILE_LOCK_STALE_MS = 30_000` it is deleted (stolen) and retried at once; else sleep 25 ms (`Atomics.wait` busy-safe sleep) and retry. Any non-`EEXIST` open error is rethrown.
- No lock after 240 tries → throw `could not acquire file lock for <targetPath>`.
- Right before `fn()` the lock mtime is refreshed (`utimesSync`, best-effort).
- After `fn()` returns, the lock body is re-read: if it no longer starts with `"<pid>@"`, the lock was stolen mid-operation → throw the "stolen" error and do NOT delete the thief's lock. On the release path the lock is removed only when still owned.

## Invariants and error behavior

### Migration pipeline (`migrateRunState`)

- Order: `read JSON -> detect schema -> migrate -> normalize -> validate -> report` (docs/release-and-migration.7.md:24-28).
- Detection: no `schemaVersion` key (or non-object) → `0`; a non-integer `schemaVersion` → `Number.POSITIVE_INFINITY` (so it fails the "newer than runtime" bound); else the number (src/state-migrations.ts:434-438).
- Fail-closed bounds (before any transform): non-object input, version below 0, version above 1 → status `unsupported`, run returned as a clone (or `{}` for non-object), NO write ever (src/state-migrations.ts:156-173).
- The input is deep-cloned (`JSON.parse(JSON.stringify(...))`); the source object and the source file are never mutated (src/state-migrations.ts:175,540-542).
- Path resolution is BFS over `RUN_STATE_MIGRATIONS` (forward + declared reverse edges); no path → `unsupported` (src/state-migrations.ts:177-189).
- `normalizeRunState` fills defaults, each recorded as a `StateMigrationChange`: `id` from the run-dir basename (else `"unknown-run"`); `createdAt`/`updatedAt` copy each other, else epoch-0 ISO `1970-01-01T00:00:00.000Z`; `cwd` = three dirs above the run dir (`<runDir>/../../..`), else `process.cwd()`; `inputs` `{}`; `loopStage` `"interpret"` (an unknown loopStage VALUE is overwritten to `"interpret"`); `workflow.id` from legacy `state.workflowId` else `"unknown-workflow"`; `workflow.title` = title-cased id; `workflow.summary` `""`; `workflow.limits` `{ "maxAgents": 8, "maxConcurrentAgents": 4 }`; all 16 `paths.*` entries; the arrays `tasks, dispatches, commits, nodes, contracts, feedback, workers, sandboxProfiles, candidates, candidateSelections`; `audit` object with the three default paths; `multiAgent`/`blackboard`/`topologies` defaults with `schemaVersion: 1`; `collaboration` normalized ONLY when present (`schemaVersion: 1`, arrays `approvals, comments, handoffs`); `phases` derived from tasks when absent (group by `task.phase` else `"Workflow"`; phase `id` is the slugified name; `status` is `"completed"` only when every task in it is completed, else `"pending"`) (src/state-migrations.ts:278-417,490-513).
- Type conflicts add errors (`<key> must be an object when present.` / `<key> must be an array when present.`) AND the value is replaced with the default — but any error forces final status `unsupported` (src/state-migrations.ts:195,322-413,447-463).
- Final status: errors → `unsupported`; else detected < 1 → `migrated`; else changes > 0 → `normalized`; else `current`. `writeRequired = changes.length > 0` (src/state-migrations.ts:194-198).
- Unknown user keys are preserved by copy — migration only adds; it never rebuilds state (docs/release-and-migration.7.md:32-34; proven append-only by src/contract-migration.ts:282-290).

### StateNode transition matrix (src/state-node.ts:310-323)

```text
same -> same        : always legal
pending   -> running | blocked | failed | completed | verified | rejected
running   -> completed | failed | blocked
completed -> verified | rejected | failed
failed    -> pending | blocked
blocked   -> pending | failed
verified  -> committed | rejected
rejected  -> pending | failed
committed -> (nothing; terminal)
```
Plus the double gate: `committed` is refused unless the node status is exactly `verified` (`commit-without-verifier`), checked AFTER the matrix (src/state-node.ts:91-99). An illegal transition throws BEFORE the node changes.

### Deterministic id fallback (src/state-node.ts:337-355)

A node minted without an explicit id gets `"<kind>-" + <first 16 hex of sha256(stableStringify({ kind, loopStage, contractId: null-or-value, inputs: null-or-value, outputs: null-or-value }))>` — no wall clock, no random. Two nodes with the same content collapse to ONE id by design.

### Contract gates (src/state-node.ts:137-164,253-308)

- Required artifacts match by artifact `id` OR `kind`; the artifact's `path` must exist on disk or the gate throws `missing-artifact-path`.
- Required evidence matches by evidence `id` OR `source`; a contract-wide `evidencePolicy.requireEvidence` makes ANY empty evidence list a `missing-required-evidence` throw.
- Verifier gate: applies when `stage.verifierGate.required` OR (`contract.commitPolicy.requiresVerifierGate` AND `stage.producedOutputKind === "commit"`); accepted statuses default `["verified"]`; a gate with `requiredEvidence` (or the evidence policy) also requires a non-empty evidence list.

### Snapshot freshness fail-closed

`diff`/`replay` never work from stale data silently: `replayNodeSnapshot` recomputes freshness first and throws `snapshot-stale`/`snapshot-absent` (src/node-snapshot.ts:218-226). The `sourceFingerprint` is RAW (includes `updatedAt`), so ANY transition makes an old snapshot `stale`; the projected `body` is normalized (timestamps and machine paths scrubbed), so replay output is byte-stable.

### State-explosion collapse rules (src/state-explosion.ts:552-804)

- Protected — NEVER collapsed: nodes on the critical path (run root, multi-agent runs/groups/fanouts/fanins, selections + their candidates, verifier-gated commits, linked failures — src/state-explosion.ts:893-912), any node with status `failed|blocked|rejected|conflicting`, reasoning-critical nodes, and failure-linked nodes.
- Collapsible kinds ONLY: `blackboard-message`, `blackboard-context`, `agent-membership`, `worker`, `score`, `blackboard-snapshot`, `agent-role` (src/state-explosion.ts:791-804). `decisions, artifacts, fanins, candidates, selections, commits, feedback` are never collapsed.
- A bucket smaller than `collapseBucket` (6) stays expanded — except in the `critical-path` view, where everything off the path collapses into one bucket per kind named `critical-context:<kind>` (src/state-explosion.ts:630-650).
- Synthetic node id: `<runId>:summary:<slug(bucketKey)>`, label `<bucketKey> (<n> collapsed)`; edges into a collapsed member re-point at the synthetic node; fully-internal edges are dropped; duplicate edges are de-duplicated (src/state-explosion.ts:645-698).
- Output is deterministic: nodes sorted by kind then id, edges by from/to/label, synthetic nodes by id, buckets processed in sorted key order.
- Raw records are never deleted or rewritten by summaries; summaries live only under `summaries/` (docs/state-explosion-management.7.md:44-46).

### Fail-closed record reads

Every persisted `NodeSnapshot`/`NodeReplayRun` read via `readNodeSnapshot`/`readNodeReplay` is shape-validated first; corrupt JSON throws `RecordValidationError` (`Invalid persisted <Type>: <reason>`) — never trusted by cast (src/node-snapshot.ts:111,123; src/validation.ts:74-209).

### Contract-migration prover invariants

`pass` requires ALL of: `validatesAtCurrent` (result is schema 1 and migration did not report unsupported), `appendOnly` (every source key survives recursively), `idempotent` (re-running migration on the result gives 0 changes and status `current`), `sourceImmutable` (the source hash is unchanged after proving), and 0 errors. An `unsupported` verdict never transforms (src/contract-migration.ts:219-279).

## Edge cases

- Non-object run state (a string, a number, an array) → `unsupported` with the single error `Run state must be a JSON object.` and `run` = `{}` (src/state-migrations.ts:156-160).
- `schemaVersion: 1.5` (non-integer) detects as infinity → `unsupported` "newer", description `invalid (number: 1.5)` (src/state-migrations.ts:436,444).
- An embedded `..` inside a run id (e.g. `v1..2`) is ALLOWED by `assertSafeRunId`; only the exact components `.` and `..`, separators, or chars outside the charset are refused (src/state.ts:314-334).
- `writeJson` cleans up its temp file when the rename fails (e.g. the target became a directory) and rethrows — the old bytes stay intact (src/state.ts:150-159; test/durable-atomic-write-smoke.js:36-59).
- Two processes: a lock older than 30 s is stolen; a holder whose lock was stolen mid-`fn` refuses to release and throws — it never deletes the thief's lock (src/state.ts:264-307).
- `realResolve` of a path where NOTHING exists up to the root returns plain `path.resolve(target)`; `isContainedPath` realpaths BOTH sides, so a symlinked temp root (macOS `/tmp` → `/private/tmp`) compares right (src/state.ts:206-227).
- `appendRunNode` with an existing id replaces in the same slot — persisted `state.json` node ORDER is unchanged by an update (src/state-node.ts:200-215; test/append-run-node-no-realloc-smoke.js).
- `compactCheckpoint` on a run with no empty optional arrays writes nothing (returns 0, no `saveCheckpoint`) (src/state.ts:97-112).
- `normalizeValue` (used in snapshot bodies and eval lines) drops the keys `createdAt, updatedAt, recordedAt, selectedAt, replayedAt, generatedAt`, sorts all object keys, and rewrites strings: `YYYYMMDDTHHMMSSZ` and full ISO timestamps → `<timestamp>`, run dirs → `<run-dir>`, eval dirs → `<eval-dir>`, `/var/folders/...` and `/tmp/...` and `/private/tmp/...` → `<tmp>` (src/multi-agent-eval/normalize.ts:9-35).
- `loadStateExplosionSummaryIndex` swallows a corrupt `index.json` and returns `undefined` (the report then shows freshness `absent`, next action `summary refresh`) (src/state-explosion.ts:1223-1233,1078-1081).
- `maybeCompactRun` swallows ALL errors — a state mutation never fails because of compaction (src/state-explosion.ts:1126-1135).
- `migrationProve` against a read-only target still returns the proof; only the proof-file write is skipped (src/orchestrator/migration-operations.ts:21-27).
- `verifyNodeReplay` of a replay whose source node has since transitioned reports `pass: false` with a `drift:status` finding — not a throw (src/node-snapshot.ts:249-283).
- `snapshotNode` with `persist: false` (used inside `verifyNodeReplay`) writes nothing.
- Pre-v0.1.32 runs with no `collaboration` key load unchanged; the key is not added (src/state-migrations.ts:393-410).
- `writeJson`'s per-process counter means two writes to the same file from ONE process never share a temp name; cross-process collisions are avoided by the pid in the name (src/state.ts:138-142).

## Evidence

Every claim above carries its pointer inline. Key anchors:

- Run-dir layout: src/state.ts:10-50; src/state-migrations.ts:297-330
- Atomic write: src/state.ts:124-172; durable append: src/state.ts:183-192
- Lock: src/state.ts:243-308
- Safe ids / names: src/state.ts:310-334
- Load/check/migrate entry points: src/state.ts:52-82; src/orchestrator/lifecycle-operations.ts:428-435
- Checkpoint + compaction: src/state.ts:84-112; src/orchestrator/lifecycle-operations.ts:437-461
- Migration steps + BFS + normalize + validate: src/state-migrations.ts:62-201,278-432
- Reverse migration: src/state-migrations.ts:207-276
- Field lists: src/run-state-schema.ts:18-69
- Node lifecycle: src/state-node.ts:59-135,310-323; deterministic id: src/state-node.ts:337-355
- Node persistence: src/state-node.ts:200-231
- Projection: src/node-projection.ts:29-59
- Snapshot/diff/replay/verify: src/node-snapshot.ts:59-283
- State size + thresholds: src/state-explosion/size.ts:6-98
- Compact graph + digests + report + refresh/show: src/state-explosion.ts:302-1255
- Human format: src/state-explosion/format.ts:15-151
- Contract migration: src/contract-migration.ts:31-290; src/orchestrator/migration-operations.ts:9-38
- Schema validator: src/schema-validate.ts:51-106
- Record guards: src/validation.ts:74-290
- Types: src/types/run.ts:178-224; src/types/state-node.ts:4-124
- Contract docs: docs/durable-state-and-locking.7.md; docs/state-node.7.md; docs/release-and-migration.7.md; docs/node-snapshot-diff-replay.7.md; docs/state-explosion-management.7.md; docs/contract-migration-tooling.7.md

## Pinned by tests

- `test/durable-atomic-write-smoke.js` — `writeJson` atomicity, temp cleanup, torn-write safety, `withFileLock` serialization.
- `test/state-node-smoke.js` — node create/transition/contract gates and `PipelineContractError`.
- `test/append-run-node-no-realloc-smoke.js` — in-place `run.nodes` upsert, stable array reference, byte-identical persisted state.
- `test/det-ids-b-smoke.js` — deterministic entity ids (incl. the `createNodeId` content-hash fallback) byte-identical across fresh runs.
- `test/node-snapshot-diff-replay-smoke.js` — snapshot fingerprints, structural diff, deterministic replay, fail-closed `stale|absent`.
- `test/contract-migration-tooling-smoke.js` — registry contents, legacy 0→1 migration, four-proof prover, source file byte-unchanged.
- `test/run-fixture-compat-smoke.js` — old fixture runs under `test/fixtures/runs/` migrate/normalize and stay hash-unchanged on disk.
- `test/robustness-hardening-smoke.js` — fail-closed loads on corrupt state (`migrateRunState` edges).
- `test/schema-validation-smoke.js` — the `validateAgainstSchema` subset semantics.
- `test/blackboard-state-explosion-management-smoke.js` — summaries, compact/focused graphs, digest, critical-path protection, stale detection, determinism.
- `test/run-import-path-traversal-smoke.js` — `assertSafeRunId` refuses traversal ids from archives.
- `test/dead-export-removal-guard-smoke.js` — the validation guards stay exported.
- `test/deferred-checkpoint-batching-smoke.js` — checkpoint write batching above this kernel (uses `saveCheckpoint` semantics).

## Rebuild risks

1. **Write bytes.** Every JSON file is `JSON.stringify(value, null, 2)` plus ONE trailing `\n`. Fixture-compat hashes files before/after; a different indent or a missing newline breaks byte checks everywhere (src/state.ts:145).
2. **Fingerprint truncation and sorting.** `fingerprintStrings` SORTS its inputs and keeps only the FIRST 32 hex chars after `sha256:`; `sha256()` and `stableHash()` keep all 64. Mixing these up flips every freshness check, snapshot id, and proof fingerprint (src/util/fingerprint.ts:6-10; src/contract-migration.ts:90-103).
3. **Normalization defaults.** The exact defaults (epoch-0 ISO timestamps, `cwd` three dirs up, `limits { maxAgents: 8, maxConcurrentAgents: 4 }`, `loopStage "interpret"`, derived phases with slug ids) are pinned by fixtures; also note `createdAt` defaults FROM `updatedAt` and `updatedAt` FROM `createdAt` (src/state-migrations.ts:283-286).
4. **Projection field set.** The 13-field node projection is used by snapshots AND the reclamation tombstone hash-chain. Adding or dropping a field (or including `updatedAt`) silently breaks the chain (src/node-projection.ts:1-45).
5. **Raw vs normalized fingerprints.** The snapshot `sourceFingerprint` is RAW (has `updatedAt`, real paths); the `body` and `outputFingerprint` are NORMALIZED (no timestamps, scrubbed paths). Swapping them kills either drift detection or replay determinism (src/node-snapshot.ts:80-86,227-228).
6. **Lock semantics.** O_EXCL lockfile, 30 s steal window, 240×25 ms wait, refresh-before, verify-after, and NEVER deleting a stolen lock. A rebuild that releases unconditionally corrupts the thief's critical section (src/state.ts:243-308).
7. **Transition matrix + double commit gate.** `pending -> completed` and `pending -> verified` ARE legal; `committed` is terminal; and the `verified`-before-`committed` check is a SECOND gate on top of the matrix with its own error code (src/state-node.ts:81-99,310-323).
8. **Collapse protections.** Failures/blocked/rejected/conflicting, critical-path, and reasoning nodes must never end up inside a synthetic summary node; buckets under 6 stay expanded except in `critical-path` view. Getting this wrong hides provenance — the one thing the layer promises not to do (src/state-explosion.ts:574-650,791-804).
9. **Migration status ladder + write gate.** `unsupported` beats `migrated` beats `normalized` beats `current`; a write happens ONLY on `--write` AND `writeRequired` AND not `unsupported`; dry-run is the default everywhere (src/state-migrations.ts:194-198; src/state.ts:76-82).
