# scheduling-registry

## Scope

This covers the wall-clock scheduler, the daemon, routine triggers, the run registry (index, queue, archive, rerun, history), control-plane scheduling (`sched`), run reclamation (`gc`), orphan run sweep (`orphans`), and the clone cache (`clones`). Files: `src/scheduler.ts`, `src/scheduling.ts`, `src/daemon.ts`, `src/triggers.ts`, `src/run-registry.ts`, `src/run-registry/{derive,format,gc,orphans,policy,queue}.ts`, `src/reclamation.ts`, `src/reclamation/hash.ts`, `src/clones.ts`, with CLI wiring in `src/cli/handlers/{scheduling,registry,maintenance,orphans,clones}.ts`, `src/cli/command-surface.ts`, shared ops in `src/capability-core.ts`, and MCP wiring in `src/mcp/tool-call.ts`.

## Public surface

### A. Wall-clock scheduler — `cw loop`, `cw schedule` (src/scheduler.ts, src/daemon.ts)

All these print JSON (2-space, trailing newline) via `printJson`.

- `cw loop [--prompt TEXT ...]` — same as `schedule create` with `kind` forced to `"loop"` (src/cli/command-surface.ts:383-385). Prints the created `ScheduledTask`.
- `cw schedule create --prompt TEXT [--kind loop|cron|reminder] [--interval N | --intervalMinutes N] [--cron "M H D Mo W"] [--delay N | --delayMinutes N] [--jitterSeconds N] [--ttlDays N] [--maxRuns N] [--workflowId ID] [--runId ID] [--sessionId ID]` — makes one `ScheduledTask` and stores it. `prompt` is required. `kind` default is `"loop"`. `ttlDays` default is `7` (src/scheduler.ts:7,29-62).
- `cw schedule list [--status STATUS]` — all tasks, or only those with the given `status` (src/scheduler.ts:64-67).
- `cw schedule delete <id>` — removes the task; returns `{ "deleted": bool, "id": "<id>" }` (src/scheduler.ts:69-77).
- `cw schedule due` — marks tasks past `expiresAt` as `expired`, then returns tasks that are `active` with `nextRunAt <= now`. Adds one `"due"` history record per new due instant, with a dedup guard (src/scheduler.ts:79-108).
- `cw schedule complete <id> [--maxRuns N]` — bumps `runCount`, sets `lastRunAt`. A `reminder`, or a task at `maxRuns`, becomes `completed`; else `nextRunAt` is computed again (src/scheduler.ts:110-129).
- `cw schedule pause <id>` — sets `status` to `"paused"` (src/scheduler.ts:131-133).
- `cw schedule resume <id>` — sets `status` to `"active"`; if `nextRunAt` is in the past it is computed again (src/scheduler.ts:135-148).
- `cw schedule run-now <id>` — sets `lastDueAt`, appends a `"started"` history record, returns that record (src/scheduler.ts:150-162).
- `cw schedule history [<id>]` — all history records, or only for one schedule (src/scheduler.ts:164-167).
- `cw schedule daemon [--cwd DIR] [--intervalSeconds N | --interval N] [--once]` — `--once` prints one tick (pretty JSON). Without `--once` it loops forever: each tick calls `Scheduler.due()`, writes `.cw/schedules/due-inbox.json`, and prints one single-line JSON tick to stdout every `intervalSeconds` (default 60, floor 1) (src/cli/handlers/scheduling.ts:57-68; src/daemon.ts:30-53).

Schedule kinds and next-run math (src/scheduler.ts:228-249):
- `loop`: first run at `now + (intervalMinutes ?? 1) minutes`; each `complete` schedules the next at the same interval.
- `cron`: needs `--cron`; next run from a 5-field cron expression.
- `reminder`: one shot at `now + (delayMinutes ?? intervalMinutes ?? 1) minutes`; `complete` ends it.
- Jitter: `addJitter` adds `sha256(baseMs) mod (jitterSeconds+1)` seconds — a pure function of the base time, no randomness (src/scheduler.ts:291-296).
- Cron support: exactly 5 fields; per field `*`, `*/step` (value % step === 0), or a comma list of whole numbers in range. Scan starts at `now + 60s` with seconds/ms zeroed and walks minute by minute for at most `8 * 24 * 60` minutes (src/scheduler.ts:251-282).

### B. Routine triggers — `cw routine` (src/triggers.ts)

- `cw routine create --prompt TEXT [--kind api|github] [--source TEXT] [--match JSON] [--metadata JSON] [--workflowId ID] [--runId ID]` — kind default `"api"`. Id is `${kind}-NNNN` from a monotonic `nextTriggerSeq` that never re-uses a deleted id (src/triggers.ts:22-45,183-185).
- `cw routine list [--kind KIND]` (src/triggers.ts:47-50).
- `cw routine delete <trigger-id>` — returns `{ "deleted": bool, "id": ... }` (src/triggers.ts:52-58).
- `cw routine fire <kind> [payload-file]` — payload from the JSON file, or from the CLI options when no file. For EVERY trigger of that kind one event is made (even when not matched); each event's payload is written to `.cw/routines/payloads/<event-id>.json`. `matched` is true when every `match` key (dot-path) equals the payload value; an empty/absent `match` always matches. Only a matched event gets a `prompt` (src/triggers.ts:60-98,130-152; src/cli/handlers/scheduling.ts:87-97).
- `cw routine events [<trigger-id>]` (src/triggers.ts:73-76).

### C. Run registry — `cw registry`, `cw queue`, `cw history`, run verbs (src/run-registry.ts, src/run-registry/queue.ts)

- `cw registry refresh [--scope repo|home] [--json]` — registers the current repo into `$CW_HOME/registry/repos.json`, rebuilds the index from source, writes it. A `repo`-scope refresh ALSO rebuilds and writes the home index (src/run-registry.ts:496-510). Default scope `repo` (src/capability-core.ts:210-212).
- `cw registry show [--scope repo|home] [--json]` — reads with explicit freshness; never writes (src/run-registry.ts:515-518). Default scope `repo`.
- `cw queue add [--app ID|--workflow ID|--runId ID] [--repo PATH] [--priority N] [--note TEXT] [--id ID]` — appends a durable entry with `status:"pending"`; priority default `100`; registers the repo (src/run-registry/queue.ts:54-90; src/run-registry/policy.ts:14-25).
- `cw queue list [--status STATE] [--repo PATH] [--json]` — sorted by `compareQueue` (priority asc, then `enqueuedAt`, then id bytes) (src/run-registry/queue.ts:92-104; src/run-registry/derive.ts:42-46).
- `cw queue show <queue-id>` (src/run-registry/queue.ts:106-110).
- `cw queue drain [--limit N] [--repo PATH]` — marks the next N (default 1) `pending|ready` entries `drained` with one shared `drainedAt`; returns `{ schemaVersion:1, drained, remaining }` (src/run-registry/queue.ts:114-140).
- `cw history [--app ID] [--status STATE] [--limit N] [--offset N] [--scope repo|home] [--json]` — newest first (src/run-registry.ts:924-960; src/run-registry/derive.ts:36-40).
- Registry-owned run verbs (routed via `src/capability-core.ts`; CLI `run` handler and MCP both call these): `run search` (src/run-registry.ts:558-592), `run list` (594-601), `run show <id>` (607-636), `run resume <id> [--limit N]` (681-734), `run archive <id> [--reason TEXT] [--unarchive]` and `run archive --older-than-days N [--state S ...]` (737-791), `run rerun <id> [--reason TEXT]` (839-889).
- `deriveLifecycle` — exported, pure. First match wins: running>0 → `running`; openFeedback>0 → `blocked`; failed>0 → `failed`; total>0 && completed==total → `completed`; verifierGatedCommits>0 && pending==0 → `completed`; completed>0 → `running`; else `queued` (src/run-registry.ts:206-214).
- `resolveCwHome(env)` — `CW_HOME`, else `XDG_STATE_HOME/cool-workflow`, else `~/.local/state/cool-workflow` (src/run-registry.ts:108-114).

### D. Control-plane scheduling — `cw sched` (src/scheduling.ts, src/capability-core.ts:465-546)

Pure core over the SAME queue file; every function takes an injected `now`.

- `cw sched plan [--now ISO]` — read-only lease plan `{ schemaVersion:1, now, maxConcurrent, inFlight, available, leases, skipped }` (src/scheduling.ts:78-112).
- `cw sched lease [--limit N] [--now ISO]` — marks planned entries `leased`; returns `{ schemaVersion:1, now, granted, leases }` (src/scheduling.ts:116-131; src/capability-core.ts:487-494).
- `cw sched release <leaseId> [--failed] [--reason TEXT]` — clean release → `ready`; `--failed` counts an attempt (backoff or park). Returns `{ schemaVersion:1, released, failed }` (src/scheduling.ts:171-186; src/capability-core.ts:495-505).
- `cw sched complete <leaseId>` — → `drained` + `drainedAt`; returns `{ schemaVersion:1, completed }` (src/scheduling.ts:160-168; src/capability-core.ts:506-511).
- `cw sched reclaim [--now ISO]` — every EXPIRED lease counts one failed attempt; returns `{ schemaVersion:1, now, reclaimed:[ids] }` (src/scheduling.ts:145-157; src/capability-core.ts:512-517).
- `cw sched reset <id>` — parked → `ready`, attempts 0; the ONLY way out of parked. Returns `{ schemaVersion:1, reset }` (src/scheduling.ts:189-197; src/capability-core.ts:518-523).
- `cw sched policy show` / `cw sched policy set --maxConcurrent N --maxAttempts N --leaseTtlMs N --backoffBaseMs N --backoffFactor N --backoffCapMs N` — policy file beside the queue; returns `{ schemaVersion:1, policy, source:"default"|"file" }` (src/capability-core.ts:524-546).
- Defaults (`DEFAULT_SCHEDULING_POLICY`): `maxConcurrent:1, maxAttempts:3, leaseTtlMs:300000, backoffBaseMs:1000, backoffFactor:2, backoffCapMs:60000` (src/scheduling.ts:27-35). Backoff = `min(round(baseMs * factor^(attempts-1)), capMs)`, no jitter (src/scheduling.ts:53-56).
- Lease id format: `lease-${entry.id}-${attempts+1}-${now with all non-digits removed}` (src/scheduling.ts:105).

### E. Run retention / reclamation — `cw gc` (src/run-registry/gc.ts, src/reclamation.ts)

- `cw gc plan [run-id] [--reclaimAfterArchiveDays N] [--keep-scratch] [--keep-snapshots] [--state S ...] [--scope repo|home] [--now ISO] [--json]` — pure dry run; frees nothing (src/run-registry/gc.ts:76-146).
- `cw gc run [run-id] [same policy flags] [--limit N] [--actor NAME] [--max-reclaim-runs N] [--max-reclaim-bytes N] [--json]` — the write-ahead reclamation transaction per eligible run (src/run-registry/gc.ts:151-222).
- `cw gc verify <run-id> [--scope repo|home] [--json]` — re-proves the chain; exit code 1 ONLY when `reclaimed && !verified` (src/run-registry/gc.ts:227-280; src/cli/handlers/maintenance.ts:37-49).
- Eligibility (fail closed, checked in this order): `already-reclaimed`, `non-terminal` (derivedLifecycle not `completed`/`failed`, or not in `reclaimStates`), `open-feedback`, `not-archived`, `within-retention` (also fires when `archivedAt` cannot be parsed and days>0). `null` means eligible (src/run-registry/gc.ts:51-65). All defaults reclaim NOTHING (src/run-registry/policy.ts:14-25).
- Transaction order (src/reclamation.ts:736-769): `extractSkeleton` → `validateSkeleton` + `validateSkeletonAgainstRun` (refuse `skeleton-incomplete`) → under the per-run lock: `planReclamation` + `buildTombstone` + `commitTombstone` (durable fsync) → `prepareFree` (re-point node artifacts off scratch, persist state.json durably, prove no dangling reference; refuse `repoint-incomplete`) → `freeBulk`. `faultAfter: "skeleton"|"tombstone-write"|"tombstone-commit"` throws a test-only `ReclamationAbort`.
- Free classes (src/reclamation.ts:373-492): worker `scratch` (only when the result copy exists; the result node's artifact is re-pointed) and `reconstructable-snapshot` (recipe `node-snapshot-projection` with `inputDigests`/`inputsDigest`/`expectDigest`). Everything else is RETAINED. `freeable` is sorted by path bytes before hashing (src/reclamation.ts:466).
- Capability downgrade: snapshots reclaimed with recipes → `re-runnable-by-reconstruction` (`inputs-and-expectdigest-retained`); snapshot without recipe → `verify-only` (`snapshot-reclaimed-no-reconstruction`); scratch only → `re-runnable` (`scratch-only-reclaimed`) (src/reclamation.ts:478-489).
- Hash chain: `tombstoneId` = `tomb-NNN` (chain position); genesis `prevTombstoneHash` = `sha256OfString(replayStableStringify(skeleton))`; `tombstoneHash` recomputed independently by verify (src/reclamation.ts:508-539,808-866).
- Witness: `gc run` also records a trust-audit event `run.reclaimed`; `commitTombstone` records `run.reclamation`. `gc verify` treats a present `run.reclaimed` witness with a missing/empty `reclaimed.json` as `reclaim-proof-deleted` (fail closed: `reclaimed:true, verified:false`) (src/run-registry/gc.ts:196-266; src/reclamation.ts:585-608).

### F. Orphan sweep — `cw orphans` (src/run-registry/orphans.ts, new in PR #330)

- `cw orphans list [--scope repo|home] [--now ISO] [--json]` — read-only. An orphan is a directory under `<repo>/.cw/runs/` that (1) is not a known run dir in the index and (2) has NO `state.json`. Age = the newest mtime found ANYWHERE in the tree; bytes = recursive file sizes (lstat, no symlink follow) (src/run-registry/orphans.ts:107-149).
- `cw orphans gc [--scope repo|home] [--min-age-minutes N] [--all] [--now ISO] [--json]` — deletes orphan dirs. Default keeps anything touched within the last `60` minutes (`DEFAULT_ORPHAN_MIN_AGE_MINUTES`); `--all` ignores age. Containment: only paths proven inside the scanned repo's runs dir. The final check-and-delete runs INSIDE `withFileLock(<dir>/state.json)` — the same lock `saveCheckpoint` takes — and re-checks that `state.json` is still absent; if a checkpoint landed in between, the dir is kept (src/run-registry/orphans.ts:151-199).
- A dir whose `state.json` exists but does not parse is NOT an orphan; it is left alone (gc territory, reads as `unreadable`) (src/run-registry/orphans.ts:120).
- Scope default is `home` on both list and gc (src/capability-core.ts:1079-1091).

### G. Clone cache — `cw clones` (src/clones.ts)

- `cw clones list [--json]` — reads `$CW_HOME/clones/`; one entry per non-dot directory; meta from `.cw-clone-meta.json` (missing meta → `url:"(unknown)", kind:"git", ref:null, fetchedAt:null, commit:null`); sorted by `fetchedAt` (localeCompare) (src/clones.ts:81-130).
- `cw clones gc [--older-than-days N] [--all] [--now ISO] [--json]` — TTL sweep, default `30` days. An entry with no (or unparseable) `fetchedAt` is KEPT in a TTL sweep (cannot be aged) but removed by `--all`. Containment check before every `rmSync` (src/clones.ts:136-174).

### H. Env vars

- `CW_HOME` — home registry root override (src/run-registry.ts:109).
- `XDG_STATE_HOME` — second choice for the home root (src/run-registry.ts:110-112).
- `CW_DETERMINISTIC_RUN_IDS` — `1|true|yes|on` makes schedule and schedule-run ids pure content hashes with no wall clock (src/scheduler.ts:307,322).

### I. MCP tools (src/mcp/tool-call.ts:397-504)

Same functions, same payloads as the CLI `--json`: `cw_schedule_create|list|delete|due|complete|pause|resume|run_now|history`, `cw_routine_create|list|delete|fire|events`, `cw_registry_refresh|show`, `cw_run_search|list|show|resume|archive|rerun`, `cw_queue_add|list|drain|show`, `cw_sched_plan|lease|release|complete|reclaim|reset|policy_show|policy_set`, `cw_gc_plan|run|verify`, `cw_clones_list|gc`, `cw_orphans_list|gc`, `cw_history`. There is no `cw_loop` tool; `loop` is CLI-only sugar.

## Exact outputs

JSON commands print `JSON.stringify(value, null, 2)` plus `"\n"` (src/cli/io.ts:17-19). `--json` or `--format json` selects JSON on the human-default commands (src/cli/io.ts:22-24). Any thrown error prints to stderr as `cw: <message>` (plus an optional dim `Try:` hint) and sets exit code 1 (src/cli.ts:5-16).

Usage errors (exact `Error` messages, printed after `cw: `):

```text
Usage: cw.js schedule create|list|delete|due|complete|pause|resume|run-now|history|daemon
Usage: cw.js routine create|list|delete|fire|events
Usage: cw.js sched plan|lease|release|complete|reclaim|reset|policy [show|set] [id] [--maxConcurrent N --maxAttempts N ...]
Usage: cw.js registry refresh|show [--scope repo|home] [--json]
Usage: cw.js queue add|list|drain|show [queue-id] [--repo PATH] [--priority N]
Usage: cw.js gc plan|run|verify [run-id] [--reclaimAfterArchiveDays N] [--keep-scratch] [--keep-snapshots] [--limit N] [--json]
Usage: cw.js orphans list [--scope repo|home] [--json] | orphans gc [--scope repo|home] [--min-age-minutes N] [--all] [--json]  (scope defaults to home: every registered repo)
Usage: cw.js clones list [--json] | clones gc [--older-than-days N] [--all] [--json]
```

(src/cli/handlers/scheduling.ts:70,102,139; registry.ts:39,64; maintenance.ts:52; orphans.ts:34-37; clones.ts:29)

Domain errors (exact template strings):

```text
Scheduled task not found: ${id}
Unsupported schedule kind: ${kind}
cron schedule requires --cron
Only 5-field cron expressions are supported
Unable to resolve next cron run within 8 days
Missing required prompt
Unsupported routine trigger kind: ${kind}
Expected a JSON object, got invalid JSON
Expected JSON object
Failed to parse payload file "${payloadPath}": ${message}
Queue entry not found: ${id}
No active lease to release: ${leaseId}
No active lease to complete: ${leaseId}
No parked entry to reset: ${id}
Invalid --${key} "${value}": expected a number (e.g. --${key} 4)
Cannot resume: run ${runId} not found in source state (fail closed; try registry refresh).
Cannot archive: run ${runId} not found in source state (fail closed).
Cannot rerun: run ${runId} not found in source state (fail closed).
rerun requires a run planner (CoolWorkflowRunner)
Run not found: ${runId}
Unsupported run state for ${runId}: ${errors joined with "; "}
Corrupt overlay ${file}: expected a JSON object, got ${array|null|typeof}
Invalid JSON in ${file}: ${message}
File not found: ${file}
--min-age-minutes must be a non-negative number (got ${value})
--now must be a valid ISO date (got ${value})
--older-than-days must be a non-negative number (got ${value})
could not acquire file lock for ${targetPath}
Skeleton missing required keys: ${missing joined with ", "}
Skeleton dropped audit content: ${contentLoss joined with ", "}
ReclamationAbort after step: ${step}
```

(src/scheduler.ts:114,198-199,225,240,253,269,331; src/triggers.ts:127,161,164,171; src/cli/handlers/scheduling.ts:93; src/run-registry/queue.ts:108; src/capability-core.ts:502,508,520,539; src/run-registry.ts:271-272,685,743,843,840,672,675; src/state.ts:115,120,274; src/run-registry/orphans.ts:69,167; src/clones.ts:144,150; src/reclamation.ts:71-74,741,746)

Id formats (byte-level):

```text
schedule id:      ${kind}-${stamp}-${hash6}        stamp = ISO time with "-" and ":" removed, ".sss" -> "Z"  (e.g. loop-20260703T211530Z-a1b2c3)
                  ${kind}-${hash6}                 when CW_DETERMINISTIC_RUN_IDS is on
history id:       run-${kind}-${stamp}-${hash6}    (deterministic: run-${kind}-${hash6})
trigger id:       ${kind}-NNNN                     NNNN = seq padded to 4 (e.g. api-0001)
event id:         event-${kind}-NNNN               NNNN = events.length-based seq padded to 4
queue id:         q-${stamp14}-${NNN}              stamp14 = 14 digits of ISO, NNN = process counter padded to 3
lease id:         lease-${entryId}-${attempt}-${nowDigits}
tombstone id:     tomb-NNN                         chain position padded to 3 (tomb-001)
sha strings:      sha256:<64 hex>                  fingerprints: sha256:<32 hex>
```

(src/scheduler.ts:303-327; src/triggers.ts:183-192; src/run-registry/derive.ts:138-143; src/scheduling.ts:105; src/reclamation.ts:534-539; src/reclamation/hash.ts:18-23; src/run-registry.ts:149-153)

Human (non-`--json`) render, exact line shapes (src/run-registry/format.ts):

```text
Run Registry (${scope}): ${root}
Freshness: ${status}( (stale: a, b))( (missing: c))
Repos: ${n}
total=N queued=N running=N blocked=N completed=N failed=N archived=N reclaimed=N
Next Action: ${nextAction}                       <- only when status != "valid"

Run Queue: ${total} entry(ies) [priority asc]
  #${priority} ${id} [${status}] ${appId|workflowId|runId|"?"} repo=${repo}( note=${note})
  (queue empty)

GC Plan (${scope}): ${eligibleCount}/${total} eligible, ${bytesToFree} byte(s) would be freed [DRY-RUN, frees nothing]
  policy: reclaimAfterArchiveDays=${n} keepScratch=${b} keepSnapshots=${b}
  [eligible] ${runId} -> ${capability} (${capabilityReason}) ${bytes}B {kind=bytes ...}
  [skip:${reason}] ${runId} (tier=${tier})
  (no runs in scope)

GC Run (${scope}): reclaimed ${n} run(s), freed ${bytes} byte(s)
  [reclaimed] ${runId} -> ${capability} (${capabilityReason}) ${bytes}B tombstone=${hash first 19 chars}
  [refused:${code}] ${runId}
  (nothing eligible)

GC Verify ${runId}: reclaimed=${b} verified=${b} tier=${t} capability=${c}( tombstone=${hash first 19})
  PASS|FAIL ${name}( [${code}])( (${detail}))

No orphan run(s) (${scope}): every ".cw/runs/" entry across ${n} repo(s) is known to the registry.
Orphan Runs (${scope}): ${count} in ${n} repo(s), ${humanBytes} total
  ${runId} (${repo}) age=${m}m ${humanBytes}

Reclaim with: cw orphans gc --min-age-minutes 60   (or --all)
Nothing to reclaim (${scopeText}); ${kept} kept (${scope}).
Reclaimed ${n} orphan run(s) (${scopeText}) — freed ${humanBytes}; ${kept} kept
```

`scopeText` is `all orphan candidates` or `orphans older than ${minAgeMinutes} minute(s)` (src/run-registry/format.ts:121-127). `humanBytes` renders `${n}B` under 1024, else one decimal with `KiB`/`MiB`/`GiB` (src/run-registry/format.ts:23-33; duplicated in src/cli/format.ts:7-17).

Clones human render (src/cli/format.ts:19-41):

```text
No cached remote checkouts in ${clonesDir}.
${count} cached checkout(s) — ${humanBytes} in ${clonesDir}
  KIND       SIZE  FETCHED               SOURCE
  ${kind padded 7} ${bytes padded 8}  ${fetchedAt "T"->" " frac->"Z" | "unknown"}  ${url}(@${ref})

Reclaim with: cw clones gc --older-than-days 30   (or --all)
Nothing to reclaim (${"all entries"|"entries older than N day(s)"}); ${kept} kept in ${clonesDir}.
Reclaimed ${n} checkout(s) (${scope}) — freed ${humanBytes}; ${kept} kept
```

Key JSON result shapes (keys, in code):

- `sched plan`: `{ "schemaVersion":1, "now", "maxConcurrent", "inFlight", "available", "leases":[{ "id","leaseId","leaseExpiresAt","attempts","priority" }], "skipped":[{ "id","reason" }] }`; `reason` ∈ `"concurrency-ceiling"|"parked"|"backoff"|"leased"|"terminal"` (src/types/run-registry.ts:193-206).
- `registry show/refresh` (`RunRegistryReport`): `{ "schemaVersion":1, "scope", "root", "generatedAt", "freshness":{ "status","persistedFingerprint","currentFingerprint","staleRuns","missingRuns" }, "index", "counts", "nextAction" }`; `status` ∈ `"valid"|"stale"|"absent"`; `nextAction` is `"node scripts/cw.js run search"` when valid, else `"node scripts/cw.js registry refresh"` (`--scope home` added at home scope) (src/run-registry.ts:520-555).
- `orphans list`: `{ "schemaVersion":1, "scope", "repos", "count", "totalBytes", "entries":[{ "repo","runId","path","ageMinutes","bytes" }] }` (src/run-registry/orphans.ts:39-53).
- `orphans gc`: `{ "schemaVersion":1, "scope", "removed":[{ "repo","runId","path","bytes" }], "freedBytes", "keptCount", "minAgeMinutes", "all" }`; `minAgeMinutes` is `null` with `--all` (src/run-registry/orphans.ts:54-62,190-198).
- `clones list`: `{ "schemaVersion":1, "clonesDir", "count", "totalBytes", "entries":[{ "hash","url","kind","ref","fetchedAt","commit","bytes" }] }` (src/clones.ts:120-130).
- `clones gc`: `{ "schemaVersion":1, "clonesDir", "removed":[{ "hash","url","bytes" }], "freedBytes", "keptCount", "olderThanDays", "all" }` (src/clones.ts:173).
- `gc run` (`GcRunResult`): `{ "schemaVersion":1, "scope", "generatedAt", "dryRun":false, "reclaimed":[{ "runId","bytesFreed","tombstoneHash","capability","capabilityReason" }], "refused":[{ "runId","code" }], "totalBytesFreed", "nextAction" }`; `nextAction` = `"node scripts/cw.js gc verify <run-id>"` when anything was reclaimed, else `"node scripts/cw.js gc plan"` (src/run-registry/gc.ts:212-221).
- daemon tick: `{ "checkedAt", "dueCount", "dueIds", "inboxPath" }` — single line per tick in daemon mode (src/daemon.ts:12-17,49-52).
- Routine fire event: `{ "id","triggerId","kind","receivedAt","matched","prompt"?,"payloadPath" }`; matched prompt = `` `${trigger.prompt}\n\ncw:routine\n${JSON.stringify({triggerId,kind,source,workflowId,runId,payload}, null, 2)}` `` (src/triggers.ts:89-97,143-152).

Exit codes: `0` on success; `1` on any thrown error (src/cli.ts:15); `1` from `gc verify` when `result.reclaimed && !result.verified` (src/cli/handlers/maintenance.ts:48).

## Files on disk

```text
<cwd>/.cw/schedules/tasks.json          ScheduleStore  { "schemaVersion":1, "tasks":[ScheduledTask], "history":[ScheduleRunRecord] }   durable write
<cwd>/.cw/schedules/due-inbox.json      { "schemaVersion":1, "checkedAt":"ISO", "due":[ScheduledTask] }   rewritten each daemon tick
<cwd>/.cw/routines/triggers.json        { "schemaVersion":1, "triggers":[], "events":[], "nextTriggerSeq":N }
<cwd>/.cw/routines/payloads/<event>.json{ "schemaVersion":1, "trigger", "receivedAt", "matched", "payload" }   file name is safeFileName(eventId)
<repo>/.cw/runs/<id>/state.json         run source of truth — READ ONLY here (never mutated by the registry; only prepareFree persists a re-point)
<repo>/.cw/runs/<id>/reclaimed.json     ReclaimedOverlay { "schemaVersion":1, "runId", "tombstones":[ReclamationTombstone] }   append-only chain, durable
<repo>/.cw/registry/index.json          per-repo RunRegistryIndex (derived, rebuildable)
<repo>/.cw/registry/archive.json        { "schemaVersion":1, "archived": { "<runId>": { "archivedAt":"ISO", "reason"? } } }   durable
<repo>/.cw/registry/provenance.json     { "schemaVersion":1, "links": { "<newRunId>": RunProvenance } }   durable
$CW_HOME/registry/repos.json            { "schemaVersion":1, "repos":[ { "root":"/abs", "addedAt":"ISO" } ] }   sorted by root, durable
$CW_HOME/registry/index.json            home-scope RunRegistryIndex
$CW_HOME/registry/queue.json            { "schemaVersion":1, "entries":[RunQueueEntry] }   durable
$CW_HOME/registry/scheduling-policy.json  SchedulingPolicy (plain; absent = defaults; corrupt = fail closed)
$CW_HOME/clones/<hex-hash>/             one cached checkout; meta at <dir>/.cw-clone-meta.json { url, kind, ref, fetchedAt, commit }
<any-store>.lock                        advisory lock file, content "${pid}@${ISO}\n"
<file>.tmp.<pid>.<n>                    atomic-write temp, renamed over the target
```

Example `tasks.json` task:

```json
{
  "id": "loop-20260703T211530Z-a1b2c3",
  "kind": "loop",
  "status": "active",
  "createdAt": "2026-07-03T21:15:30.000Z",
  "updatedAt": "2026-07-03T21:15:30.000Z",
  "nextRunAt": "2026-07-03T21:16:30.000Z",
  "expiresAt": "2026-07-10T21:15:30.000Z",
  "prompt": "check the build",
  "intervalMinutes": 1,
  "jitterSeconds": 0,
  "runCount": 0
}
```

(Paths: src/scheduler.ts:15; src/daemon.ts:33; src/triggers.ts:18-19,81; src/run-registry.ts:246-256,277,284,302,476-479; src/run-registry/queue.ts:35-37; src/capability-core.ts:357-359 via src/run-registry.ts:357-359; src/clones.ts:51,101; src/state.ts:140-172,250-308; src/reclamation.ts:114-116)

## Invariants and error behavior

- Atomic writes everywhere: `writeJson` writes a temp file then `renameSync` over the target; a reader always sees whole old or whole new bytes. `{ durable: true }` adds fsync of the file and (best effort) the dir — used for the scheduler store, queue, repos, archive/provenance overlays, `reclaimed.json`, and `state.json` (src/state.ts:140-172).
- Cross-process locks: every read-modify-write on a shared store runs under `withFileLock` (`<target>.lock`, `wx` create, up to 240 tries with 25 ms sleeps, a holder older than `30000` ms is stolen). The lock mtime is refreshed before the critical section and ownership is checked after; a stolen lock makes the holder throw and NOT release (src/state.ts:243-308). Locked stores: scheduler store (src/scheduler.ts:25-27), queue add/drain (src/run-registry/queue.ts:70,123), `repos.json` (src/run-registry.ts:329), archive overlay (src/run-registry.ts:747), provenance overlay (src/run-registry.ts:866), the per-run reclamation chain (src/reclamation.ts:105-107,753), orphan delete (src/run-registry/orphans.ts:181), `state.json` checkpoints (src/state.ts:87-91).
- Absent vs corrupt is NOT the same thing. Absent store files load a clean default. Present-but-unparseable AUTHORITATIVE stores fail closed with `Invalid JSON in <file>` (queue.json — src/run-registry/queue.ts:39-48; repos.json — src/run-registry.ts:305-314; archive/provenance overlays plus a shape check `Corrupt overlay ...` — src/run-registry.ts:259-287; scheduling-policy.json — src/capability-core.ts:466-476). Exceptions that fail OPEN by design: a corrupt `reclaimed.json` reads as an empty chain (a bad overlay must never brick the run — src/run-registry/derive.ts:149-163; src/reclamation.ts:118-131), a corrupt persisted `index.json` reads as undefined (it is a rebuildable cache — src/run-registry.ts:481-491), and a clone dir with bad meta is still listed (src/clones.ts:99-104).
- The registry is derived, never authoritative. Every read re-derives records from `state.json`; the persisted index is only compared, never trusted. Missing source → `found:false`, `freshness:"missing"`, last-known record under `persisted` only. Unreadable/unsupported state → the run is skipped in a scan (and `unreadable` in gc), never counted a success (src/run-registry.ts:361-448,515-555,607-636).
- Registry reads never write. Only `refresh`, `queueAdd`, `archive`, `rerun`, `gc run`, `orphans gc` write; `knownRepos` unions registered repos with the current repo in memory (src/run-registry.ts:317-337).
- Archive is a mark, never a delete; `derivedLifecycle` stays search-able under the overlay. Rerun makes a NEW run and records provenance in the overlay of the ORIGINAL repo; the original run's state is never touched (src/run-registry.ts:737-791,839-889).
- Scheduling fail-closed rules: the `maxConcurrent` ceiling is never passed (skips report `concurrency-ceiling`); an entry at `maxAttempts` is `parked` with `parkedReason` = `"${reason} (attempt N/M)"` and is never re-selected; only `sched reset` (parked → ready, attempts 0) recovers it; an expired lease reclaim counts one attempt (src/scheduling.ts:78-157,189-197).
- `sched policy set` refuses a non-numeric flag with `Invalid --<key> ...` instead of writing a silent default (src/capability-core.ts:528-546). `normalizeSchedulingPolicy` clamps: below-minimum or non-finite values fall back to the default per field (mins: maxConcurrent 1, maxAttempts 1, leaseTtlMs 1, backoffBaseMs 0, backoffFactor 1, backoffCapMs 0) (src/scheduling.ts:37-50).
- Reclamation red line: only `scratch` and `reconstructable-snapshot` are ever freed; anything unclassified is retained; an unreadable snapshot file is retained; a node whose scratch is re-pointed this pass keeps its snapshot this pass (src/reclamation.ts:373-458). A crash at any step leaves either the full run or a complete tombstone (write-ahead order, src/reclamation.ts:736-769). `gc verify` recomputes every hash and never trusts a stored value (src/reclamation.ts:804-866).
- Orphan sweep never touches: a dir with any `state.json` (even corrupt), a known indexed run dir, anything outside `<repo>/.cw/runs/`, or (without `--all`) anything younger than the age gate (src/run-registry/orphans.ts:107-188).
- Scheduler `due()` first expires tasks past `expiresAt`, then reports due tasks; the `"due"` history record is deduplicated: it is only appended when `lastDueAt < nextRunAt` (src/scheduler.ts:83-108).
- Trigger ids are monotonic and delete-proof: `nextTriggerSeq` only goes up, and load recovers `max(persisted, highest id suffix)` for legacy stores (src/triggers.ts:26-29,100-117).

## Edge cases

- A pre-v0.1.37 `queue.json` with no scheduling fields loads and plans unchanged (docs/control-plane-scheduling.7.md:61-67; pinned in test/control-plane-scheduling-smoke.js).
- `planSchedule` counts only ACTIVE leases (`leaseExpiresAt > now`) toward `inFlight`; an entry whose lease is expired is skipped with reason `"leased"`, not counted, and only `sched reclaim` moves it on (src/scheduling.ts:62-96).
- `applyLease` with `limit` grants `plan.leases.slice(0, max(0, limit))` — a limit of 0 grants none (src/scheduling.ts:122-123).
- `queueDrain` default limit is 1 (`clampInt(options.limit, 1, 1)`); `search`/`history` default limit is 50, offset 0; `resume` next-task limit default 5 (src/run-registry/queue.ts:118; src/run-registry.ts:571-572,689).
- `queue add --priority` accepts only a finite number; anything else falls to the default `100` (src/run-registry/queue.ts:79).
- Search text matches a lower-cased join of runId, appId, workflowId, title, repo, lifecycle, loopStage, and `inputsDigest` (bounded at 360 chars with `...`) (src/run-registry/derive.ts:48-108).
- `run archive` with no run id but `--older-than-days N` runs the retention policy path; with `archiveOlderThanDays <= 0` it archives nothing and returns `{ policy, archived:[], eligible:0 }` (src/run-registry.ts:770-791; src/capability-core.ts:260-279).
- Rerun of a rerun: `generation` goes up by one and `originRunId` stays pinned to the chain root (src/run-registry.ts:852-859).
- `gc run` stops early: after `limit ?? maxReclaimRuns` runs (when > 0), and after `maxReclaimBytes` is reached or passed (checked AFTER the run that crossed it) (src/run-registry/gc.ts:160-206).
- `gc plan`/`gc run` with a run id resolve just that run via `locate` (repo first, then registered repos) — no full scan (src/run-registry/gc.ts:69-86).
- `gc verify` on a run that was never reclaimed returns `reclaimed:false, verified:false` with check `{ name:"reclaimed", pass:false, code:"not-reclaimed" }` and exit 0; on a missing run it returns a `located` check with `detail:"run source not found"` (src/run-registry/gc.ts:229-241; src/reclamation.ts:812-814).
- Orphan gc race: if a first checkpoint lands between the scan and the delete, the locked re-check sees `state.json` and keeps the dir (counted in `keptCount`) (src/run-registry/orphans.ts:180-188).
- Orphan age is `max(0, round((now - newest mtime)/60000))`; a dir still being filled keeps a fresh mtime deep in the tree, so the default gate protects it (src/run-registry/orphans.ts:73-101,122).
- What a killed process leaves behind: `ensureRunDirs` makes ~16 sub-dirs before the first `saveCheckpoint` writes `state.json`; a kill in that window leaves a dir with no `state.json` — invisible to the registry (`scanRepo` drops it silently) and to gc; only `cw orphans` reclaims it (src/state.ts:31-50; src/run-registry.ts:365-367,437-448; src/run-registry/orphans.ts:1-32).
- Known gap (kept on purpose): a run stuck `running`/`queued`/`blocked` with a valid but stale `state.json` is reclaimed by NEITHER gc (refuses `non-terminal`) NOR orphans (it has a `state.json`). It stays retained with no time limit (src/run-registry/orphans.ts:27-32; src/run-registry/gc.ts:46-50; docs/run-retention-reclamation.7.md:124-129).
- Clones: names starting with `.` are skipped (in-progress `.stage-*` temp dirs); sizing uses `lstat` and never follows symlinks; sizing and walking never throw (src/clones.ts:54-79,90).
- Daemon `run()` never returns; interval floor is 1 second (src/daemon.ts:47-53). `schedule daemon --once` prints pretty JSON via `printJson`; the loop prints compact single-line JSON.
- `routine fire` with no payload file uses the parsed CLI options object as the payload (src/cli/handlers/scheduling.ts:91).
- Scheduler option coercion: `true` (a bare flag) reads as "not given" for both strings and numbers (src/scheduler.ts:335-344).
- `repos.json` entries are sorted by `compareBytes(root)` on every register; register is idempotent (src/run-registry.ts:324-337).
- Index fingerprint = sha256 (first 32 hex) over sorted `["repo:<r>", "<runId>:<fp>:<lifecycle>", ...]`; a lifecycle-only change (e.g. archive mark) also flips the index fingerprint (src/run-registry.ts:149-153,459-462).

## Evidence

Every claim above carries its pointer inline. The load-bearing ones, one per line:

- Scheduler store path and lock: src/scheduler.ts:15,25-27; durable save: src/scheduler.ts:190-194.
- due/expiry/dedup: src/scheduler.ts:79-108. complete/maxRuns/reminder: src/scheduler.ts:110-129.
- cron parse/scan bounds: src/scheduler.ts:251-282. deterministic jitter: src/scheduler.ts:291-296. deterministic ids + `CW_DETERMINISTIC_RUN_IDS`: src/scheduler.ts:303-327.
- daemon tick/inbox: src/daemon.ts:30-53.
- trigger seq monotonic + recovery: src/triggers.ts:26-29,100-117. fire/matching/payload files: src/triggers.ts:60-98,130-141. prompt render: src/triggers.ts:143-152.
- home root resolution: src/run-registry.ts:108-114. overlay fail-closed: src/run-registry.ts:259-287. repos load/register: src/run-registry.ts:302-337.
- deriveRecord/tier/capability from `reclaimed.json`: src/run-registry.ts:361-432. scanRepo drops no-state dirs: src/run-registry.ts:437-448.
- refresh writes repo + home: src/run-registry.ts:496-510. freshness report: src/run-registry.ts:520-555.
- search/list/showRun/resume/archive/archiveByPolicy/rerun/history: src/run-registry.ts:558-601,607-636,681-734,737-791,839-889,924-960.
- queue file/lock/drain: src/run-registry/queue.ts:35-140. order: src/run-registry/derive.ts:42-46. queue id: src/run-registry/derive.ts:138-143.
- scheduling policy defaults/normalize/backoff: src/scheduling.ts:27-56. plan/lease/retryOrPark/reclaim/complete/release/reset: src/scheduling.ts:78-197.
- sched CLI ops + policy file fail-closed + set validation: src/capability-core.ts:465-546.
- gc eligibility order: src/run-registry/gc.ts:51-65. gc plan/run bounds: src/run-registry/gc.ts:76-222. verify + witness: src/run-registry/gc.ts:227-280.
- reclamation transaction: src/reclamation.ts:736-769. skeleton keys: src/reclamation.ts:54-64. plan classes/capability: src/reclamation.ts:373-492. tombstone chain: src/reclamation.ts:508-580. prepareFree proofs: src/reclamation.ts:616-662. verify: src/reclamation.ts:804-866.
- hash helpers: src/reclamation/hash.ts:15-60.
- orphans list/gc/lock/containment: src/run-registry/orphans.ts:64-199.
- clones list/gc/TTL/containment: src/clones.ts:81-174.
- lock protocol: src/state.ts:243-308. atomic/durable write: src/state.ts:140-172. run dirs before first checkpoint: src/state.ts:31-50,84-91.
- CLI wiring: src/cli/command-surface.ts:383-416; handlers as cited per command. MCP wiring: src/mcp/tool-call.ts:397-504.
- Man pages (contract): docs/control-plane-scheduling.7.md, docs/run-registry-control-plane.7.md, docs/run-retention-reclamation.7.md, docs/routine.7.md, docs/durable-state-and-locking.7.md.

## Pinned by tests

- test/schedule-routine-daemon-smoke.js — scheduler create/pause/resume/complete/run-now/history/delete, cron + interval math, TTL expiry, due dedup, routine create/fire/match, payload persistence, daemon tick, CLI `loop`/`schedule`/`routine`, fail-closed names (unknown kind, missing prompt, cron without `--cron`, unknown id, malformed match JSON).
- test/control-plane-scheduling-smoke.js — deterministic lease order, hard concurrency ceiling, retry/backoff, expired-lease reclaim counts an attempt, park at maxAttempts + reset-only recovery, `sched plan` purity, pre-v0.1.37 queue compatibility.
- test/sched-policy-validation-smoke.js — `sched policy set` fails closed on a non-numeric flag.
- test/run-registry-control-plane-smoke.js — deriveLifecycle, cross-repo index, search determinism, resume-by-id, queue drain order, archive without loss, rerun provenance chain, stale/missing fail-closed, overlay read-once, CLI = MCP payloads.
- test/registry-corrupt-fail-closed-smoke.js — absent loads default, corrupt store (queue/overlays/repos/policy/scheduler) fails closed with `Invalid JSON`.
- test/run-retention-reclamation-smoke.js — the gc plan/run/verify transaction, tombstone chain, capability downgrade, fault injection.
- test/orphan-runs-gc-smoke.js — orphans list/gc find and reclaim only true orphans; never a state.json run, never corrupt-but-present, never outside `.cw/runs/`; age gate; containment.
- test/clones-gc-smoke.js and test/cli-handler-clones-smoke.js — clone cache list/gc, TTL sweep, no-fetchedAt keep rule, `--all`.
- test/mcp-surface-registry-smoke.js — the MCP registry tool surface.
- test/durable-atomic-write-smoke.js — atomic temp→rename write + lock behavior.

## Rebuild risks

1. Corrupt-vs-absent is asymmetric on purpose. queue.json, repos.json, archive/provenance overlays, scheduling-policy.json and the scheduler store FAIL CLOSED on corrupt bytes; `reclaimed.json` and the persisted `index.json` fail OPEN (empty chain / rebuildable cache). Flattening this to one rule breaks either the fail-closed tests or run derivation.
2. Order inside the reclamation transaction is the safety property: skeleton → validate (shape AND content) → lock(build tombstone + durable commit) → durable re-point + proofs → free. Also: the freed manifest MUST be path-sorted before hashing or `tombstoneHash` is not reproducible across hosts (src/reclamation.ts:466).
3. Determinism of ids and jitter. Schedule jitter is a content hash of the base instant; trigger/event/tombstone ids are positions; `CW_DETERMINISTIC_RUN_IDS` drops the wall clock from schedule ids. Any `Math.random()` or plain timestamps break replay and the hash chain.
4. `sched` vs `schedule` are two different systems: `sched` is leases over `$CW_HOME/registry/queue.json`; `schedule` is wall-clock tasks in `<cwd>/.cw/schedules/tasks.json`. `cw loop` is only sugar for `schedule create --kind loop`.
5. `planSchedule` counts only unexpired leases as in-flight; expired leases are skipped (reason `"leased"`) and only `sched reclaim` retries them, counting one attempt. Getting either wrong breaks the hard ceiling or loses the attempt budget.
6. gc eligibility must check in the exact order (`already-reclaimed` → `non-terminal` → `open-feedback` → `not-archived` → `within-retention`) because tests and operators key on the distinct refusal codes; and ALL policy defaults reclaim nothing.
7. The orphan gc delete must re-check `state.json` INSIDE `withFileLock(<dir>/state.json)` — the same lock `saveCheckpoint` takes. A plain check-then-delete lets a first checkpoint land in the gap and get wiped. Orphan age comes from the newest mtime in the whole tree, not the dir's own mtime.
8. `gc verify` exit semantics: exit 1 only when `reclaimed && !verified`; a never-reclaimed run is NOT a failure. The `run.reclaimed` trust-audit witness turns a deleted `reclaimed.json` into `reclaim-proof-deleted` (reclaimed:true, verified:false) rather than "never reclaimed".
