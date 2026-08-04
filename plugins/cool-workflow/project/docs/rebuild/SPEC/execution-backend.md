# execution-backend

## Scope

This covers the driver layer that runs or hands off work: backend drivers and probes, agent delegation config, sandbox profiles, worker isolation and the accept path, and remote source materialization. Files: `src/execution-backend.ts`, `src/execution-backend/{agent,probes,util}.ts`, `src/agent-config.ts`, `src/sandbox-profile.ts`, `src/worker-isolation.ts`, `src/worker-isolation/{helpers,paths}.ts`, `src/worker-accept/*.ts`, `src/remote-source.ts`, plus the shipped scripts `scripts/children/{http-delegate-child,batch-delegate-child}.js` and `scripts/agents/*` which are part of the contract.

## Public surface

### The driver registry (src/execution-backend.ts)

There are 7 built-in backend drivers, each a data row in `DRIVER_SPECS` (src/execution-backend.ts:116-200):

| id | kind | locality | default | delegate | static readiness | support (read/write/command/network/env) |
|---|---|---|---|---|---|---|
| `node` | local | local | true | — | ready | attest/attest/enforce/attest/enforce |
| `bun` | local | local | false | `bun` | ready | attest/attest/enforce/attest/enforce |
| `shell` | local | local | false | `/bin/sh` | ready | attest/attest/enforce/attest/enforce |
| `container` | delegating | local | false | `docker` | unverified | enforce ×5 |
| `remote` | delegating | remote | false | `remote-runner` | unverified | attest/attest/enforce/attest/enforce |
| `ci` | delegating | remote | false | `ci-runner` | unverified | attest/attest/enforce/attest/enforce |
| `agent` | delegating | local | false | `agent-process` | unverified | attest/attest/enforce/attest/attest |

- `EXECUTION_BACKEND_SCHEMA_VERSION = 1` (src/execution-backend.ts:82). `DEFAULT_BACKEND_ID = "node"` (:83). `SANDBOX_DIMENSIONS = ["read","write","command","network","env"]` (:84).
- `registerBackend(driver)` — the open extension seam. Puts (or overwrites) a driver in the registry map by `driver.spec.id` (src/execution-backend.ts:277-279). Built-ins register at module load (:338-340).
- `getBackendDriver(id)` (:281), `listBackendDescriptors()` — sorted by id with `localeCompare` (:289-293), `backendIds()` — sorted string list (:295-299), `isBackendId(id)` (:301-303).
- `getBackendDescriptor(id)` — throws `BackendError` with code `backend-not-found` and message `Execution backend not found: ${id}` when the id is not in the registry (:305-311).
- `BackendError` — an `Error` with `name = "BackendError"`, a `code` string, and optional `details` (:86-96).
- `resolveBackendSelection(requested?, env)` — order: flag > `CW_BACKEND` env > default. Gives back `{ backendId, source: "flag"|"env"|"default", requested? }`. An unknown flag id throws `backend-not-found` with message `Unknown execution backend: ${id}`; an unknown env id throws with message `Unknown execution backend in CW_BACKEND: ${id}` (src/execution-backend.ts:359-384).
- `requiredSandboxDimensions(policy)` — `read` and `write` are always required; `command` when `policy.execute.mode !== "any"`; `network` when `policy.network.mode !== "any"`; `env` when `policy.env.inherit === false` (:391-401).
- `attestSandbox(descriptor, policy, options)` — maps required dimensions onto the driver's support. In `"delegate-host"` mode every supported dimension but `write` becomes `attest` and `write` becomes `enforce` (:429-433). Status is `"refused"` when any required dimension is `unsupported` or `options.ready === false`, else `"enforced"` when any dimension was enforced, else `"attested"` (:439-441). Gives back the `SandboxAttestation` shape (see Exact outputs).
- `probeBackend(id, {cwd})` — wraps the driver's probe body with the descriptor fields; a driver with no probe gets `checks: []` and the static readiness (:466-486). `ready` is true only when `readiness === "ready"` (:480).
- `runBackend(request)` — the run entry. Order of gates: (1) command policy check (`sandbox-command-denied`), (2) attestation — any unenforceable dimension refuses (`sandbox-unenforceable`), (3) delegating drivers go to `delegate()`, (4) a local backend that is not ready refuses (`backend-not-ready`), (5) a local run with no command refuses (`no-command`), else `executeLocal` (src/execution-backend.ts:494-545).
- `createExecutionBackend(id)` — gives back `{ descriptor, probe, run }` where `run` forces `backendId: id` (:1132-1139).
- Inspection payloads: `backendListPayload()` = `{ schemaVersion: 1, default: "node", backends: [...] }` (:1143-1149); `backendShowPayload(id)` = the descriptor (:1151-1153); `backendProbePayload(id?, ctx)` = one probe result, or `{ schemaVersion: 1, default: "node", probes: [...] }` for every id when no id is given (:1155-1161). Probe results here go through a cache with a 60s TTL keyed by `${id}:${cwd||''}`; `CW_PROBE_CACHE_TTL_MS` sets the TTL, `0` turns the cache off (:1200-1214).
- `buildChildEnv(policy)` — when `policy.env.inherit` is true, a copy of the full `process.env`. Else a small base: `PATH` and `HOME` only, plus each name in `policy.env.expose`, minus each name in `policy.env.deny` (:1167-1181).
- `delegateChildScript()` — resolves `scripts/children/http-delegate-child.js` next to the compiled module; throws `Delegate child script not found at ${path}. This indicates a broken installation — reinstall cool-workflow or ensure "scripts/children/http-delegate-child.js" is shipped in the package.` when missing (:801-811). It is resolved once at import time (:814).
- `shouldStreamAgentStderr(env, isTTY)` — `CW_NO_STREAM=1` ⇒ false (wins over all); `CW_AGENT_STREAM=0` ⇒ false; `CW_AGENT_STREAM=1` ⇒ true even with no TTY; else `isTTY` (:908-913).
- Re-exports so importers stay byte-identical: `sha256` from util; `stripSecretArgs`, `prepareAgentSpawn`, `runAgentBatchOutcomes`, type `AgentSpawnJob` from agent (:78-80).

### Local execution (executeLocal)

- The command and args are made into strings; env comes from `buildChildEnv(policy)`; `maxBuffer` is `32 * 1024 * 1024`; `timeout` is `request.timeoutMs` (src/execution-backend.ts:554-563).
- Spawn style comes from the registered driver: `node`/`bun` use `spawnSync(command, args, { shell: false })` (direct); `shell` uses `spawnSync([command, ...args].join(" "), { shell: true })` (:568-587).
- Shell guard: for the `shell` driver, the joined string (with `{{token}}` placeholders taken out first via `/\{\{[a-zA-Z0-9_.-]+\}\}/g`) must not match `/[;&|`$(){}<>!\n\r#*?~]/`; if it does, a plain `Error` is thrown: `Shell backend refused: args contain shell control characters. Use the node, bun, or agent backend instead for untrusted inputs.` (:569-579).
- When `process.stderr.isTTY`, two stderr lines frame the run: `● Running ${shortLabel}...\n` before and `✓ Done (${elapsedMs}ms)\n` after, where `shortLabel` is the last path segment of the command (:580-589).
- Status: `spawnError` ⇒ `"failed"`; exit 0 ⇒ `"completed"`; else `"failed"` (:595). A provenance note `runtime: <note>` is always added; the bun note is `bun (node-compatible execution)` when `bun` is on PATH, else `node-compatible (bun not installed)`; node is `node`; shell is `posix-shell` (:320-326, :610).

### Delegation shared parts

- `delegate()` builds the handle from the driver's `buildHandle`; no handle ⇒ `delegation-target-missing` refusal. A delegating driver with no `commandlessDelegate` flag and no `request.command` ⇒ `no-command`. A driver with no `delegateRun` ⇒ `backend-not-runnable` (src/execution-backend.ts:628-675). The attestation carries the note `delegated: ${id} -> ${handle.ref}` (:658).
- `delegatedEnvelope()` builds the same canonical envelope shape as `executeLocal`; the handle lands in `provenance` only, never in `evidence` (:680-713).
- Handle builders: container — `image` from `request.delegation.image` or `CW_CONTAINER_IMAGE`, digest from `delegation.digest` or `CW_CONTAINER_DIGEST`, `ref` = `image@digest` or `image`, kind `"container"` (:1068-1075). remote — endpoint from `delegation.endpoint` or `CW_REMOTE_ENDPOINT`, jobId from `delegation.jobId` or `CW_REMOTE_JOB`, `ref` = `endpoint#jobId` or `endpoint`, kind `"remote"` (:1077-1084). ci — endpoint from `CW_CI_ENDPOINT`, jobId from `CW_CI_JOB`; at least one must be set; `ref` = `endpoint#jobId`, or jobId, or endpoint, kind `"ci"` (:1086-1093).

### container driver (runContainer)

- Runtime pick: `docker` if on PATH, else `podman`, else refuse `runtime-unavailable` with reason `no container runtime (docker/podman) on PATH` (src/execution-backend.ts:728-733).
- Daemon pre-flight: `spawnSync(runtime, ["version","--format","{{.Server.Version}}"], { timeout: 15000 })`; the daemon is up only when exit 0 and stdout is not empty. Else refuse `runtime-unavailable` with `${runtime} daemon is not reachable: ${firstStderrLine}` (:738-745).
- Run argv: `run --rm` + (`--network none` when `policy.network.mode !== "any"`) + `-v ${cwd}:${cwd}:ro -w ${cwd}` + `-e NAME=VALUE` per exposed env name (skipping `PATH` and `HOME`) + `handle.ref` + command + args (:750-767).
- Exit 125 or a null exit is a runtime failure, not a command result ⇒ refuse `runtime-unavailable` with `${runtime} could not run the container: ${firstStderrLine}` (:785-790). A spawn error ⇒ `delegation-failed` (:776-780). A real non-zero exit is a `failed` envelope, not `refused`.

### remote / ci drivers (runHttpDelegation)

- The job JSON `{ command, args, env, sandboxProfileId, jobId }` goes on stdin to a child: `spawnSync(process.execPath, [scripts/children/http-delegate-child.js])` with `CW_DELEGATE_ENDPOINT` set to the handle endpoint, timeout `request.timeoutMs || 120000` (src/execution-backend.ts:837-851).
- The child POSTs the job to the endpoint, polls a returned `jobId` (1s steps, up to 600 polls) until `done === true`, and prints one JSON object `{ exitCode, stdout }` or `{ error }` on stdout (scripts/children/http-delegate-child.js:17-40). It caps stdin at 32 MiB (:18-19).
- The parent refuses `delegation-failed` on: a spawn error; unparseable child stdout (`${id} runner returned an unparseable response`); a child `error` field or missing numeric `exitCode` (`${id} runner error: ${error || "no exitCode reported"}`) (src/execution-backend.ts:852-874). Else a delegated envelope with the runner's exit + stdout digest.

### agent driver (runAgentProcess / runAgentEndpoint)

- `resolveAgentInvocation(request)` — the invocation comes from `request.delegation` (command/args/endpoint/model), then top-level `request.command`/`args`, then env `CW_AGENT_COMMAND` / `CW_AGENT_ENDPOINT` / `CW_AGENT_MODEL`. A one-string command with spaces is split on white space into binary + argv template — never shell-read (src/execution-backend/agent.ts:44-64).
- Substitution: `agentSubstitutions` binds `manifest` (manifest path or `workerDir/manifest.json`), `input`, `result`, `workerDir`, `model`, `prompt` (src/execution-backend/agent.ts:158-169). `substituteAgentArg` replaces `{{word}}` (`\w+` only) inside each argv element; an unknown key stays as literal `{{key}}` (:171-173).
- Spawn: `spawnSync(binary, realArgs, { shell: false, stdio: ["ignore","pipe", streamStderr ? "inherit" : "pipe"], timeout: resolved.timeoutMs || 600000, maxBuffer: 32MiB })` (src/execution-backend.ts:951-959). stdout is always captured as data; stderr streams live per `shouldStreamAgentStderr`.
- Child env (v0.1.95): baseline is `buildChildEnv(policy)`, then every `process.env` key matching `/^(CW_|ANTHROPIC_|OPENAI_|GEMINI_|DEEPSEEK_|CODEX_|GOOGLE_|COHERE_|MISTRAL_|OLLAMA_|AZURE_|AWS_)/i` is passed through so the agent's own keys resolve. CW never reads or records their values (src/execution-backend.ts:945-949).
- Refusals: spawn error ⇒ `delegation-failed` `agent process failed to spawn: ${err}`; null exit ⇒ `delegation-failed` `agent process returned no exit code (timed out or killed)`; no command-template and no endpoint ⇒ `delegation-target-missing` `Backend agent has no command-template or endpoint configured` (:966-994).
- The evidence triple records the SECRET-STRIPPED args, and the recorded handle (kind `"process"`) carries `metadata: { mode, command, args, model, reportedModel, reportedUsage?, usageSignature? }` (src/execution-backend/agent.ts:177-207). `reportedModel` is `"unreported"` when the agent's stdout reports none — never `CW_AGENT_MODEL` (src/execution-backend.ts:975).
- `parseAgentReport(stdout)` — parses the whole stdout as JSON, or the LAST line that starts with `{` and ends with `}`. Reads `model`, or `usage.model`, or `modelId`; when absent, picks the key of `modelUsage` with the most `inputTokens`/`input_tokens`. Also reads `usage` and `usageSignature`/`usage_signature` (src/execution-backend/agent.ts:103-156).
- `stripSecretArgs(args)` — (1) a value after one of `--api-key --apikey --token --key --secret --password --auth --bearer` becomes `<redacted>`; (2) `--x-key=...`-style inline values (flag name matching `key|token|secret|password|auth|bearer`) become `${flag}=<redacted>`; (3) a bare token with prefix `sk-`, `ghp_`, `gho_`, `github_pat_`, `xox[abpr]-`, or `Bearer ` — or any 32+ char run of `[A-Za-z0-9_\-]` with no path separator — becomes `<redacted>` (src/execution-backend/agent.ts:66-99).
- `preparedAgentOutcome` on the request (Track 2) skips the spawn and settles the pre-collected child outcome through the same branches (src/execution-backend.ts:936-938; src/types/execution-backend.ts:180-187).
- Endpoint form: the manifest job `{ manifest, prompt, model, resultPath, sandboxProfileId }` goes through the same http-delegate child (timeout `resolved.timeoutMs || 600000`). If the endpoint gave a `result` body (via `extractEndpointResult`: JSON `result`/`resultMarkdown` string, or raw non-JSON text) and the report has no `usage` and `manifest.resultPath` does not exist yet, CW writes the body to `result.md` as transport (src/execution-backend.ts:1002-1062). Evidence command is `agent-endpoint` with the endpoint as its one arg (:1061).

### Concurrent batch (Track 2)

- `prepareAgentSpawn(request)` — resolves to `{ binary, args (substituted, with secrets, in memory only), cwd, timeoutMs: resolved.timeoutMs || 600000 }`, or undefined for endpoint/unconfigured (src/execution-backend/agent.ts:274-284).
- `runAgentBatchOutcomes(jobs)` — one `spawnSync(process.execPath, [scripts/children/batch-delegate-child.js])` with the jobs JSON on stdin, `maxBuffer: 34 * 1024 * 1024 * jobs.length`, parent backstop timeout `max(job timeouts) + 30000`. No `encoding` option — stdout stays a Buffer (src/execution-backend/agent.ts:369-390).
- The child spawns ALL jobs at once (`shell:false`, `env: job.env || process.env`), SIGTERM at `timeoutMs`, SIGKILL at `timeoutMs + 5000`, drains stderr, caps each stdout at 32 MiB (over-cap ⇒ `spawnError: "stdout exceeded ${CAP} byte cap (${bytes} bytes)"`, exitCode null), and streams one NDJSON line `{"i":<index>,...}\n` per job the moment it settles (scripts/children/batch-delegate-child.js:38-85). Bad stdin JSON ⇒ one array `[{ spawnError: "invalid stdin JSON: ...", exitCode: null, stdout: "" }]`; empty jobs ⇒ `[]` (:32-38).
- `reconcileBatchOutcomes(jobs, child)` — splits stdout on the raw `0x0a` byte on the Buffer, decodes one line at a time, drops the last part after the final newline, skips lines that do not parse or whose `i` is out of range. Every job with no full line gets `{ spawnError: "batch delegate failed: ${reason}", exitCode: null, stdout: "" }` where reason is the child error message, `batch delegate exited with ${status}`, or `batch delegate produced no outcome for this job` (src/execution-backend/agent.ts:327-358).

### Probes (src/execution-backend/probes.ts)

- `node`: check `node-runtime`; ready iff `node` on PATH; reason `node runtime not found on PATH` (:17-24).
- `shell`: check `posix-shell` (`sh` on PATH or `/bin/sh` exists); reason `POSIX shell not found` (:26-33).
- `bun`: checks `bun-runtime` + `node-compatible-fallback`; ready when either exists; reason `bun not installed; executing via node-compatible runtime` when only node (:35-46).
- `container`: checks `docker` + `podman`; ready when either; reason `no container runtime (docker/podman) found; supply --image to delegate explicitly` (:48-59).
- `remote`: checks `endpoint` (`CW_REMOTE_ENDPOINT`) + `delegate-child-script`; unset endpoint ⇒ `unverified` with reason `no remote endpoint configured (set CW_REMOTE_ENDPOINT or pass --endpoint)`; missing script ⇒ `unavailable`, `delegate child script is missing` (:65-78).
- `ci`: checks `ci-endpoint` (`CW_CI_ENDPOINT`) + `delegate-child-script`; reason `no CI job target configured (set CW_CI_ENDPOINT or pass --job)` (:80-93).
- `agent`: checks `agent-command` (`CW_AGENT_COMMAND`) + `agent-endpoint` (`CW_AGENT_ENDPOINT`); configured ⇒ `ready`, else `unverified` (NEVER refused) with reason `no agent configured (set CW_AGENT_COMMAND or CW_AGENT_ENDPOINT, or pass --agent-command/--agent-endpoint)` (:95-109).

### Agent delegation config (src/agent-config.ts)

- `agentConfigPath(env)` = `$CW_HOME/agent-config.json` where CW home resolves `CW_HOME` > `XDG_STATE_HOME/cool-workflow` > `~/.local/state/cool-workflow` (src/agent-config.ts:28-30; src/run-registry.ts:108-115).
- `loadAgentConfigFile(env)` — reads the file; a corrupt file is treated as absent (never throws) (:75-94).
- Env layer fields: `CW_AGENT_COMMAND` (split on white space into command + args), `CW_AGENT_ENDPOINT`, `CW_AGENT_MODEL`, `CW_AGENT_TIMEOUT_MS` (Number), `CW_AGENT_ATTEST_PUBKEY`, `CW_REQUIRE_ATTESTED_TELEMETRY` (boolish: `1/true/yes/on` ⇒ true, `0/false/no/off` ⇒ false, else undefined) (:96-109, :40-48).
- Flag layer accepts both camelCase and kebab-case keys: `agentCommand`/`agent-command`, `agentArgs`/`agent-args`, `agentEndpoint`/`agent-endpoint`, `agentModel`/`agent-model`, `agentTimeoutMs`/`agent-timeout-ms`, `agentAttestPublicKey`/`agent-attest-public-key`, `requireAttestedTelemetry`/`require-attested-telemetry` (:111-127).
- `resolveAgentConfig(args, env)` — per-field order flags > env > file; `source` is `"flag"` when a flag command/endpoint is set, else `"env"`, else `"file"`, else `"none"` (:186-204). Builtin expansion: a command `builtin:<name>` reads `scripts/agents/builtin-templates.json` and becomes `node <agentsDir>/<script> {{input}} {{result}}`; an unknown name throws `Unknown builtin agent template "${name}" — available: ${names}` (:161-182). Builtin names in the shipped manifest: `claude`→`claude-p-agent.js`, `codex`→`codex-agent.js`, `gemini`→`gemini-opencode-agent.js`, `gemini-cli`→`gemini-agent.js`, `opencode`→`opencode-agent.js`, `deepseek`→`deepseek-agent.js` (scripts/agents/builtin-templates.json).
- Auto-detect: when no command and no endpoint resolve, `detectAgentFromPath` walks `PATH` (on win32, with `PATHEXT` or `.EXE;.CMD;.BAT`) for the FIRST of `["claude","codex","gemini","opencode"]` that both is a file on PATH and has a builtin template. The pick expands as `builtin:<name>`, `source` becomes `"auto"`, and the model hint (when none set) becomes `builtin:<name>`. `CW_NO_AUTO_AGENT=1` turns detection off (src/agent-config.ts:141-159, :209-220).
- `agentConfigured(args, env)` — true iff a command OR endpoint resolves (:226-229).
- `setAgentConfigFile(patch, env)` — merges the flag-shaped patch over the current file (new value wins per field), strips secrets from `args`, and writes with `writeJson` (atomic temp → rename, 2-space JSON + one ending newline) (:241-260; src/state.ts:140-152). API keys are never written.
- `agentConfigShow(args, env)` — deterministic projection: `{ schemaVersion: 1, configured, source, config (secret-stripped), path, fileExists }` — no time-derived field (:275-285).

### Sandbox profiles (src/sandbox-profile.ts)

- `SANDBOX_PROFILE_SCHEMA_VERSION = 1`; `DEFAULT_SANDBOX_PROFILE_ID = "default"` (:18-19).
- 4 bundled profiles (:35-100): `default` (read `$cwd`,`$workerDir`; write []; workerOutput result+artifacts+logs; execute `any`; network `any`; env inherit false), `readonly` (same but network `none`), `workspace-write` (adds write `$cwd`), `locked-down` (read `$inputPath` only; workerOutput result only; execute `none`; network `none`).
- `resolveSandboxProfileById(id?, context)` — order: bundled id > a readable profile FILE at `path.resolve(context.cwd, id)` (which must not escape cwd — else `sandbox-profile-path-escape`, `Custom profile path traversal denied: ${id}`) > a persisted custom definition in `context.customProfiles` (H7 re-resolve) > `showBundledSandboxProfile` which throws `sandbox-profile-not-found` `Sandbox profile not found: ${id}` (:124-163, :114-122).
- `resolveSandboxProfile(profile, context)` — validates, then resolves: unique resolved read/write paths (profile paths + `context.extraReadPaths`/`extraWritePaths`), normalized `workerOutput` (context `allowArtifacts`/`allowLogs` win), `execute`/`network` mode default `"none"` when absent, `env.inherit` coerced boolean. Adds the fixed `enforcement` lists: `enforcedByCW: ["profile validation","path normalization","worker result acceptance against sandbox write policy","durable ErrorFeedback for denied worker output"]` and `hostRequired: ["OS-level read isolation","OS-level write isolation before result acceptance","process execution restrictions","network restrictions","environment variable filtering"]`, plus `resolvedAt` (ISO now) (:165-211, :483-515).
- Path tokens: `$cwd $runDir $workerDir $inputPath $resultPath $artifactsDir $logsDir`; an unknown/unbound token throws `Unknown or unavailable sandbox path token: ${value}` (:463-481). Traversal (`..` as a segment) and control characters (U+0000–U+001F) are turned down everywhere (:558-564).
- `validateSandboxProfileFile(file, context)` — fail closed on traversal in the path, a missing file, bad JSON, and a custom profile whose `id` reuses a bundled name: `Custom sandbox profile id "${id}" is reserved (collides with a bundled profile); choose a different id` (:213-245). Issues all carry code `sandbox-profile-invalid`.
- `validateSandboxProfileDefinition` — checks schemaVersion 1, id shape `/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/`, title, path lists, execute/network mode in `none|allowlist|any`, env names `/^[A-Za-z_][A-Za-z0-9_]*$/` (:247-266, :517-548).
- `effectiveSandboxWritePaths(policy)` — writePaths + the worker output paths that the profile allows (`metadata.resultPath/artifactsDir/logsDir`) (:268-275).
- `sandboxPolicyForWorker(profileId, context)` — resolves and stamps worker paths into `policy.metadata` (:277-295).
- Runtime checks, each giving back a `WorkerBoundaryViolation` `{ code, message, path?, allowedPaths }` or null: `validateSandboxWrite`/`validateSandboxRead` (codes `sandbox-write-denied`/`sandbox-read-denied`; traversal, control characters, then containment — `isContainedPath` realpath-hardens both sides so a symlink whose real target escapes is denied) (:297-311, :375-397; src/state.ts:223-227); `validateSandboxCommand` (`sandbox-command-denied`; malformed, mode `none`, or an allowlist miss on the exact string) (:313-325); `validateSandboxNetwork` (`sandbox-network-denied`, same shape) (:327-339).
- `upsertRunSandboxPolicy(run, policy)` — replace-by-id or append into `run.sandboxProfiles` (:341-348). `sandboxContextForRun` threads `run.customSandboxProfiles` (:350-358). `sandboxContextForValidation(cwd)` builds a fake context under `.cw/runs/_sandbox-profile-validation/workers/_worker` (:360-373).
- Note (docs/sandbox-profiles.7.md:29-42): under the `node` backend the `execute`/`network`/`env` policy is attested, not enforced; only the `container` backend truly enforces all five dimensions.

### Worker isolation (src/worker-isolation.ts, src/worker-isolation/*)

- `WORKER_ISOLATION_SCHEMA_VERSION = 1` (:52). `WORKER_SCOPE_FILE = "worker.json"`, `WORKER_MANIFEST_FILE = "manifest.json"` (src/worker-isolation/paths.ts:12-13).
- `createWorkerId(run, taskId)` — deterministic: `worker-<safeTaskId>-<seq>` where seq is the count of scopes already holding that prefix + 1, left-padded to 4 digits (src/worker-isolation/paths.ts:38-42).
- `allocateWorkerScope(run, task, options)` — makes `workers/<workerId>/` with `input.md`, `result.md` path, `artifacts/`, `logs/`; resolves the sandbox policy for the worker; records the backend selection + a `delegate-host` attestation ONLY when a backend was named; writes input.md, manifest.json, worker.json, index.json; records `worker.sandbox-profile` (and `worker.backend`) trust-audit events; stamps the task (`workerId`, `workerManifestPath`, `sandboxProfileId`, `sandboxPolicy`, `backendId`, ...); saves a checkpoint unless `options.persist === false` (:61-200). Re-allocating a task whose scope is `failed`/`orphaned` bumps `retryCount`, clears `errors`, resets status, and gives back the SAME scope (:67-79).
- `writeWorkerInput` — writes a fixed markdown: `# Worker ${id}`, run/task/dispatch/result/artifacts/logs/sandbox lines, optional multi-agent lines, the task prompt under `## Task`, and a `## Boundary` list with the read/write paths and the lines `- Write the final Markdown result to result.md.`, `- CW enforces result acceptance. The host is responsible for OS/process/network/environment sandbox enforcement.`, `- Do not mutate state.json, nodes/, feedback/, dispatches/, or commits/ directly.` (:548-584).
- `writeWorkerManifest` — the full `WorkerManifest` JSON with `instructions` fixed to 7 lines starting `Read input.md before doing work.` and `Write the final Markdown result to result.md.` (:202-272).
- `recordWorkerOutput(run, workerId, resultPath, options)` — the ordered accept path; the 7 steps run in this order and MUST NOT be reordered (:317-341): validateWorkerResult → attestWorkerDelegation → acceptWorkerResult → recordWorkerDelegationLedger → runWorkerVerify → recordWorkerCompletion → fanOutWorkerOutput, then a checkpoint save.
- `recordWorkerFailure` — builds an error StateNode (`${run.id}:worker:${workerId}:failure:${n}`), marks the task `failed` with loopStage `adjust`, records feedback + a `worker.failure` trust-audit event, and sets the scope status to `rejected` when the code is `worker-boundary-violation` or starts with `sandbox-`, else `failed` (:343-426).
- `recordWorkerRetryAttempt(run, workerId, attempts, reason)` — stamps `retryCount` and metadata `agentDelegationAttempts`/`agentDelegationLastFailure` (:428-448).
- `validateWorkerBoundary` — write-path check via the (possibly re-resolved) policy; on pass records a `worker.sandbox-boundary` allowed event with `metadata.enforced_by_cw: ["write-paths"]` and `delegated_to_host: ["execute","network","env"]` (:450-482).
- `listWorkerScopes` / `getWorkerScope` — merge in-memory scopes with `worker.json` files on disk. A corrupt file in `getWorkerScope` throws `Corrupt worker scope ${file}: ${msg}`; in the directory list it is skipped with the stderr line `cw: skipping unreadable worker scope ${file}: ${msg}\n` (:299-315, :627-647).
- `summarizeWorkers` — `{ total, byStatus, manifestPaths, failed: [{id,status,feedbackIds}] }` (:484-499).
- `reclaimOrphans(run, now?)` — pure function of time + state: an `allocated`/`running` scope with a positive `timeoutMs` whose age ≥ timeout becomes `orphaned` with the retryable error `worker-orphaned` `Worker exceeded timeout of ${timeoutMs}ms (elapsed: ${elapsedMs}ms).`; gives back `{ runId, reclaimed, orphans }`. A bad `now` throws `Invalid reclaim 'now': ...` (:507-540).

### The accept path (src/worker-accept/*)

- Step 1 `validateWorkerResult` — boundary violation ⇒ a denied `sandbox path` audit record + failure + throw; missing result file ⇒ retryable `worker-result-missing` `Worker result file does not exist: ${path}`; then `parseResultEnvelope` + `validateResultEnvelope`; then (default ON since v0.1.95, off only with `CW_REQUIRE_RESOLVABLE_EVIDENCE=0|false|no|off`; `=url` also checks URLs) file-style evidence must resolve on disk under run.cwd / process.cwd / workerDir / runDir, else `worker-evidence-unresolvable` (src/worker-accept/validation.ts:38-113; src/evidence-grounding.ts:56-66).
- Step 2 `attestWorkerDelegation` — verifies the agent's signed telemetry against the operator PUBLIC key before recording; when `options.requireAttestedTelemetry` is on and the verdict is not `attested`, throws `telemetry-unattested-blocked` (`Worker ${id} telemetry is ${status} (...) and require-attested-telemetry is enabled — refusing to accept a hop whose usage cannot be cryptographically verified`) BEFORE any accept-side state change. Builds the `AgentDelegationProvenance` with `resultDigest = sha256(rawResult)` (src/worker-accept/telemetry-ledger.ts:22-77).
- Step 3 `acceptWorkerResult` — records the allowed-path audit, copies `result.md` to `${run.paths.resultsDir}/${safeFileName(task.id)}.md`, completes the task, appends a result node `${run.id}:result:${task.id}` with the agent provenance folded into node metadata (never evidence), records the `worker.output` accepted event, and a `worker.capture-warning` event when the parsed result has no findings and no evidence (src/worker-accept/acceptance.ts:15-120).
- Step 4 `recordWorkerDelegationLedger` — for agent hops only: appends the verdict to the hash-chained telemetry ledger FIRST (storing the signed result digest only when the signature covered it), then the `worker.agent-delegation` audit event cross-linking `telemetryRecordId`/`telemetryRecordHash`/`telemetryPrevHash` (src/worker-accept/telemetry-ledger.ts:83-142).
- Step 5 `runWorkerVerify` — drives the `verify` pipeline stage to node `${run.id}:verifier:${task.id}` (src/worker-accept/verifier-completion.ts:13-30).
- Step 6 `recordWorkerCompletion` — builds the `WorkerOutputRecord`, sets the scope status `verified` when the verify stage `advanced`, else `completed`, stamps `outputDigest` (`sha256(rawResult)`) + `outputSizeBytes`, and a `UsageRecord` (`source: "host-attested"`, note `agent-delegation host-attested usage`) only when the agent reported a model or usage — `unreported` is never backfilled (src/worker-accept/verifier-completion.ts:35-82).
- Step 7 `fanOutWorkerOutput` — posts the accepted output to the blackboard (first linked topic) and records the multi-agent worker output; a scope with no blackboard linkage is a no-op (src/worker-accept/blackboard-fanout.ts:9-89; src/worker-accept/blackboard-linkage.ts:4-18).

### The red line (no model SDK, no key)

- CW spawns agents out-of-process only: `spawnSync(binary, args, { shell:false })` or a plain-HTTP child; it imports no model SDK, holds no API key, and builds no model API request (src/execution-backend.ts:188-199, :888-894; src/execution-backend/agent.ts:24-28; scripts/children/http-delegate-child.js:13-15; scripts/children/batch-delegate-child.js:22-23).
- Keys flow only through the agent's inherited env (the pass-through name filter at src/execution-backend.ts:946-949); recorded args/handles/config are secret-stripped first (src/execution-backend/agent.ts:72-99, :225-244; src/agent-config.ts:232-237).
- `CW_AGENT_MODEL` is operator policy put into `{{model}}`; the attested model comes only from the agent's own report, else `unreported` (src/execution-backend/agent.ts:101-102; docs/agent-delegation-drive.7.md:77-86).
- The wrapper seam: argv in (`{{input}}` = worker `input.md`, `{{result}}` = worker `result.md`); the wrapper writes `result.md` itself and prints ONE JSON line `{model, usage, result}` on stdout for `parseAgentReport` (scripts/agents/claude-p-agent.js:39-44, :194-198; docs/agent-delegation-drive.7.md:49-53). A failed wrapper drops its child's stderr to `logs/agent-stderr.log` next to `result.md` (docs/agent-delegation-drive.7.md:310-314) and writes a `transcript.md` next to `result.md` when streaming (scripts/agents/claude-p-agent.js:96, :180).

### Remote source — `--link` (src/remote-source.ts)

- `classifyRemote(value)` → `"git" | "archive" | "local"`. No scheme, no scp form, no helper form ⇒ `"local"` (a real directory is never fetched). Archive by path extension `/\.(tar\.gz|tgz|tar|zip)$/i`; scp (`git@host:owner/repo`) and helper forms are always git-ish (:64-75). `isRemoteUrl` = not `"local"` (:78-80).
- `sanitizeUrl` strips URL userinfo (username/password); scp-style passes through unchanged (:84-95). `redactCredentials(text)` strips `user[:pass]@` from URLs in any text (:162-164) — git output is never relayed raw.
- `assertSafeUrl` throws on: a `-`-leading value (`refusing a URL that begins with '-' (option injection): ...`), a transport helper (`blocked git transport helper in URL (e.g. ext::/fd::): ...`), an unparseable URL, or a scheme outside `https, http, ssh, git, file` (`unsupported URL scheme '${s}:' (allowed: https, http, ssh, git, file): ...`) (:99-113).
- `validateRemoteUrl(value)` → `{ ok, kind, url, reason? }` with NO network I/O; local kind gives reason `not a recognized remote URL (expected https/ssh/git/file or git@host:repo)` (:125-135). `gitAvailable(env)` runs `git --version` (:138-140).
- `materializeRemote(value, opts)` — throws `not a remote URL: ${value}` for local values; asserts URL safety + git on PATH (`git is required to review a remote repository but was not found on PATH`); then clones (git) or downloads (archive) (:254-262).
- Cache: `<cwHome>/clones/<key>` where key = first 24 hex chars of `sha256("${sanitizedUrl}\0${ref||""}")` (:150-157). Containment asserted: the target must sit inside `clones/` (:209-211, :433-435). Cache reuse: a `.git` dir present and no `opts.refresh` ⇒ `cached: true` (git: HEAD re-resolved; archive: `commit` read from `.cw-clone-meta.json`) (:213-217, :267-278).
- Git clone argv: `clone --depth 1 --single-branch [--branch <ref>] -c core.hooksPath= -- <rawUrl> <dir>` — array argv, `--` before the URL, hooks off; the raw (maybe credentialed) URL exists only as an argv element (:224-235). Git env: `GIT_TERMINAL_PROMPT: "0"`, `GIT_ASKPASS: ""`, `GCM_INTERACTIVE: "never"`; default timeout 120000ms; failures throw `git ${verb} failed: <redacted 3-line stderr tail>` (:168-189). A failed clone removes the dir and throws `could not clone ${url}: ...`; an unresolvable HEAD throws `cloned ${url} but could not resolve HEAD` (:236-246).
- Archive: size caps `MAX_ARCHIVE_BYTES` = 200 MiB (download) and `MAX_EXTRACTED_BYTES` = 1 GiB (tree) (:24-27). `file://` is copied directly; http(s) is fetched in a `node -e` child that follows redirects BY HAND (max 6), re-checking each hop for http(s) scheme and a non-private host (localhost, `.local`, loopback, 10/8, 172.16/12, 192.168/16, 169.254/16, 0.0.0.0, `::1`, `fe80:`, `fc`/`fd`) — SSRF guard (:286-334). Bomb guard: declared uncompressed size (gzip ISIZE / `unzip -l` total) checked before extraction; entry names checked for `..`/absolute traversal before extraction (`refusing archive ...: unsafe path escapes the extraction dir: ...`); after extraction the tree is walked with `lstat` and fails closed on symlinks (`contains a symlink (...)`), non-regular entries, or an over-cap size (`extracted size exceeds ... (possible decompression bomb)`) (:338-420, :450-461). Missing tools: `unzip is required to review a .zip link but was not found on PATH (use a .tar.gz or a git URL)` / `tar is required to review a .tar/.tgz link but was not found on PATH` (:344-349).
- A one-dir wrapper (a GitHub tarball) is stepped into; the tree is moved into the cache slot (same filesystem rename) and then `git init` + `add -A` + `commit --allow-empty -m "snapshot of ${url}"` with identity `-c user.email=cw@local -c user.name=cw -c commit.gpgsign=false -c core.hooksPath=` (:422-427, :462-469). `commit` for an archive = sha256 hex of the downloaded bytes (:447).
- The caller (quickstart) treats `--link <url>` and a URL given to `--repo` the same; `--check` never fetches; materialization happens before plan; `args.repo` is rewritten to the local path; origin rides in as `sourceUrl`/`sourceCommit`/`sourceRef` inputs, a `source.clone`/`source.download` trust-audit event, and a `remote { url, commit, kind, cached, ref? }` block in the JSON result (src/capability-core.ts:669-703, :745-760, :833-836).

### Env vars (full list for this subsystem)

| var | effect | evidence |
|---|---|---|
| `CW_BACKEND` | backend id when no flag; unknown value fails closed | src/execution-backend.ts:373-382 |
| `CW_AGENT_COMMAND` | agent command template (split on white space; `builtin:<name>` allowed) | src/agent-config.ts:97; src/execution-backend/agent.ts:46 |
| `CW_AGENT_ENDPOINT` | agent HTTP endpoint | src/agent-config.ts:102; src/execution-backend/agent.ts:47 |
| `CW_AGENT_MODEL` | operator model policy → `{{model}}`; never the attested model | src/agent-config.ts:103; src/execution-backend/agent.ts:48 |
| `CW_AGENT_TIMEOUT_MS` | agent timeout config | src/agent-config.ts:104 |
| `CW_AGENT_ATTEST_PUBKEY` | trust public key (PEM or path) | src/agent-config.ts:105 |
| `CW_REQUIRE_ATTESTED_TELEMETRY` | opt-in fail-closed telemetry gate | src/agent-config.ts:106; src/worker-accept/telemetry-ledger.ts:51 |
| `CW_NO_AUTO_AGENT=1` | turn PATH auto-detect off | src/agent-config.ts:144 |
| `CW_AGENT_STREAM` / `CW_NO_STREAM` | stderr live-view gate (`CW_NO_STREAM=1` wins) | src/execution-backend.ts:908-913 |
| `CW_CONTAINER_IMAGE` / `CW_CONTAINER_DIGEST` | container handle | src/execution-backend.ts:1068-1075 |
| `CW_REMOTE_ENDPOINT` / `CW_REMOTE_JOB` | remote handle | src/execution-backend.ts:1077-1084 |
| `CW_CI_ENDPOINT` / `CW_CI_JOB` | ci handle | src/execution-backend.ts:1086-1093 |
| `CW_PROBE_CACHE_TTL_MS` | probe cache TTL (default 60000; 0 = off) | src/execution-backend.ts:1201-1205 |
| `CW_DELEGATE_ENDPOINT` | (child-only) endpoint the http delegate child POSTs to | scripts/children/http-delegate-child.js:22 |
| `CW_HOME` / `XDG_STATE_HOME` | home root for `agent-config.json` + `clones/` | src/run-registry.ts:108-115 |
| `CW_REQUIRE_RESOLVABLE_EVIDENCE` | default ON; `0/false/no/off` = shape-only; `url` = also check URLs | src/evidence-grounding.ts:56-66 |
| `GIT_TERMINAL_PROMPT=0`, `GIT_ASKPASS=`, `GCM_INTERACTIVE=never` | set BY CW on git children (fail closed on auth prompts) | src/remote-source.ts:170-174 |
| wrapper-side: `CW_GEMINI_MODEL`, `CW_DEEPSEEK_MODEL`, `CW_CODEX_REASONING_EFFORT`, `NO_COLOR`/`CW_NO_COLOR`/`FORCE_COLOR` | vendor wrapper knobs (config, not core) | scripts/agents/deepseek-agent.js:20-21; docs/agent-delegation-drive.7.md:275-308 |

## Exact outputs

Canonical evidence triple, byte-stable in shape across every real backend (src/execution-backend.ts:597-601, :692-696):

```text
command:<command + " " + args joined by " ">
exitCode:<int or "null">
stdoutSha256:sha256:<64-hex>
```

`sha256(value)` format (src/execution-backend/util.ts:13-15):

```text
sha256:<64 lowercase hex chars>
```

Result summaries (src/execution-backend.ts:602-607, :697-698, :1108):

```text
<label>: completed (exit 0)
<label>: failed (exit <code>)
<label>: failed (<spawnError>)            # local spawn error only
<label>: failed (exit null)               # delegated null exit
<label>: refused (<code>) — <reason>
```

Refused envelope evidence (src/execution-backend.ts:1106):

```text
refused:<code>
backend:<backendId>
sandbox:<sandboxProfileId>
```

Refusal / error codes: `backend-not-found`, `sandbox-command-denied`, `sandbox-unenforceable`, `backend-not-ready`, `no-command`, `delegation-target-missing`, `backend-not-runnable`, `runtime-unavailable`, `delegation-failed` (src/execution-backend.ts:308, :505, :513-521, :530, :539, :641, :669, :730, :853).

`ExecutionResultEnvelope` JSON shape (src/types/execution-backend.ts:214-222; src/execution-backend.ts:613-625):

```json
{
  "schemaVersion": 1,
  "status": "completed | failed | refused",
  "result": { "summary": "...", "findings": [], "evidence": ["command:...", "exitCode:...", "stdoutSha256:sha256:..."] },
  "evidence": ["command:...", "exitCode:...", "stdoutSha256:sha256:..."],
  "provenance": {
    "schemaVersion": 1,
    "backendId": "node",
    "locality": "local",
    "kind": "local",
    "attestation": { "schemaVersion": 1, "backendId": "...", "locality": "...", "kind": "...", "sandboxProfileId": "...", "required": [], "enforced": [], "attested": [], "unenforceable": [], "status": "enforced | attested | refused", "enforcedByCW": [], "hostRequired": [], "recordedAt": "<ISO>", "handle": null, "notes": [] },
    "handle": { "kind": "container | remote | ci | process", "ref": "...", "image": null, "digest": null, "endpoint": null, "jobId": null, "metadata": {} }
  }
}
```

(Optional keys are absent, not null, in real payloads; the table above only names them.)

`backendIds()` for the shipped set, sorted (src/execution-backend.ts:295-299; docs/agent-delegation-drive.7.md:319-322):

```json
["agent", "bun", "ci", "container", "node", "remote", "shell"]
```

`backendListPayload()` (src/execution-backend.ts:1143-1149):

```json
{ "schemaVersion": 1, "default": "node", "backends": [ { "schemaVersion": 1, "id": "...", "title": "...", "description": "...", "kind": "...", "locality": "...", "default": false, "capabilities": [{ "dimension": "read", "support": "attest" }], "enforces": [], "attests": [], "delegate": "...", "readiness": "..." } ] }
```

`backendProbePayload()` with no id (src/execution-backend.ts:1155-1161) / one probe (src/execution-backend.ts:474-485):

```json
{ "schemaVersion": 1, "default": "node", "probes": [ { "schemaVersion": 1, "backendId": "...", "locality": "...", "kind": "...", "readiness": "ready | unavailable | unverified", "ready": true, "enforces": [], "attests": [], "checks": [{ "name": "...", "ok": true, "detail": "..." }], "reason": "..." } ] }
```

TTY-only stderr lines around a local run (src/execution-backend.ts:582, :589):

```text
● Running <basename-of-command>...
✓ Done (<ms>ms)
```

Shell-guard throw (src/execution-backend.ts:573-578):

```text
Shell backend refused: args contain shell control characters. Use the node, bun, or agent backend instead for untrusted inputs.
```

http-delegate-child stdout (one JSON object, no newline) (scripts/children/http-delegate-child.js:36-38):

```json
{ "exitCode": 0, "stdout": "..." }
{ "error": "runner responded 502" }
```

batch-delegate-child stdout (one NDJSON line per job) (scripts/children/batch-delegate-child.js:48):

```json
{"i":0,"exitCode":0,"stdout":"..."}
{"i":1,"spawnError":"...","exitCode":null,"stdout":""}
```

`agentConfigShow` payload (src/agent-config.ts:275-285):

```json
{ "schemaVersion": 1, "configured": true, "source": "flag | env | file | auto | none", "config": { "schemaVersion": 1, "command": "...", "args": ["..."], "endpoint": "...", "model": "...", "timeoutMs": 600000, "attestPublicKey": "...", "requireAttestedTelemetry": false, "source": "..." }, "path": "<cwHome>/agent-config.json", "fileExists": true }
```

Agent handle metadata (src/execution-backend/agent.ts:186-206):

```json
{ "kind": "process", "ref": "<binary + stripped args joined by \" \">", "endpoint": null, "metadata": { "mode": "command | endpoint", "command": "...", "args": ["..."], "model": "...", "reportedModel": "unreported", "reportedUsage": {}, "usageSignature": "..." } }
```

Wrapper stdout contract (the seam) (scripts/agents/claude-p-agent.js:197; docs/agent-delegation-drive.7.md:49-53):

```json
{"model":"<agent-reported id>","usage":{...},"result":"<final markdown>"}
```

Wrapper usage error on bad argv, exit 2 (scripts/agents/claude-p-agent.js:41-44):

```text
usage: claude-p-agent.js <inputPath> <resultPath>  (CW substitutes {{input}} {{result}})
```

Worker scope stderr skip line (src/worker-isolation.ts:642):

```text
cw: skipping unreadable worker scope <file>: <message>
```

Key thrown-error strings quoted in the sections above are exact: `Execution backend not found: ...`, `Unknown execution backend: ...`, `Unknown execution backend in CW_BACKEND: ...`, `Unknown builtin agent template "..." — available: ...`, `Corrupt worker scope ...: ...`, `Unknown worker for run ...: ...`, `Unknown task for worker ...: ...`, `Invalid reclaim 'now': ...`, `not a remote URL: ...`, `refusing a URL that begins with '-' (option injection): ...`, `blocked git transport helper in URL (e.g. ext::/fd::): ...`, `unparseable remote URL: ...`, `unsupported URL scheme '...:' (allowed: https, http, ssh, git, file): ...`, `git is required to review a remote repository but was not found on PATH`.

Exit codes: this module surface throws or gives back envelopes; process exits belong to the CLI layer. Inside this area: the wrapper scripts exit `2` on bad argv, `1` on spawn/parse/no-result failures, and pass the vendor child's exit code through (scripts/agents/claude-p-agent.js:44, :61-67, :186-192); the SSRF fetch child exits `2` (HTTP error), `3` (too large), `4` (fetch/body error), `5` (blocked redirect), `6` (too many redirects) (src/remote-source.ts:308-322); `quickstart --check` exits non-zero when blocked (docs/agent-delegation-drive.7.md:188-192).

## Files on disk

| path | who writes | format |
|---|---|---|
| `$CW_HOME/agent-config.json` | `setAgentConfigFile` (atomic temp → rename) | 2-space JSON + one ending `\n`: `{ "schemaVersion": 1, "command": "...", "args": [...], "endpoint": "...", "model": "...", "timeoutMs": n, "attestPublicKey": "...", "requireAttestedTelemetry": b, "source": "file" }`, secret-stripped (src/agent-config.ts:241-260; src/state.ts:140-152) |
| `$CW_HOME/clones/<24-hex>/` | `materializeRemote` | a git checkout (shallow clone, or an extracted tree with a one-commit snapshot) (src/remote-source.ts:150-157) |
| `$CW_HOME/clones/<24-hex>/.cw-clone-meta.json` | `writeCloneMeta` (best-effort) | `{ "url": "<sanitized>", "kind": "git|archive", "ref": "<ref or null>", "commit": "<sha>", "fetchedAt": "<ISO>" }` + `\n` (src/remote-source.ts:196-202, :247, :470) |
| `$CW_HOME/clones/.stage-*/` | archive staging (mkdtemp), removed in `finally` | temp (src/remote-source.ts:443-474) |
| `.cw/runs/<run>/workers/<worker>/worker.json` | `writeWorkerScope` | the `WorkerScope` JSON (src/worker-isolation.ts:602-604) |
| `.cw/runs/<run>/workers/<worker>/manifest.json` | `writeWorkerManifest` | the `WorkerManifest` JSON with `instructions`, `sandbox{profileId,policy,enforcedByCW,hostRequired}`, `backend{...attestation}`, `blackboard?` (src/worker-isolation.ts:202-272) |
| `.cw/runs/<run>/workers/<worker>/input.md` | `writeWorkerInput` | the fixed markdown described above (src/worker-isolation.ts:548-584) |
| `.cw/runs/<run>/workers/<worker>/result.md` | the EXTERNAL agent (or CW as transport for an endpoint agent) | the worker's markdown result with a ```cw:result fence (src/execution-backend.ts:1049-1058; scripts/agents/agent-adapter-core.js:7-35) |
| `.cw/runs/<run>/workers/<worker>/artifacts/`, `logs/` | made at allocation | dirs (src/worker-isolation.ts:121-122) |
| `.cw/runs/<run>/workers/<worker>/logs/agent-stderr.log` | wrapper scripts on a failed hop | plain text, secret-redacted (docs/agent-delegation-drive.7.md:310-314) |
| `.cw/runs/<run>/workers/<worker>/transcript.md` | wrapper scripts (stream mode) | full narration + tool I/O (scripts/agents/claude-p-agent.js:96, :180) |
| `.cw/runs/<run>/workers/index.json` | `writeWorkerIndex` | `{ schemaVersion: 1, runId, workers: [{ id, taskId, dispatchId, status, workerDir, manifestPath, resultPath, sandboxProfileId, backendId, multiAgent, feedbackIds }] }` (src/worker-isolation.ts:606-625) |
| `<run.paths.resultsDir>/<safeTaskId>.md` | `acceptWorkerResult` (copy of result.md) | markdown (src/worker-accept/acceptance.ts:27-29) |
| `scripts/agents/builtin-templates.json` | shipped, read-only | `{ "schemaVersion": 1, "templates": { "claude": "claude-p-agent.js", ... } }` (src/agent-config.ts:161-171) |
| `scripts/children/http-delegate-child.js`, `batch-delegate-child.js` | shipped, spawned by path with `shell:false` | node scripts (src/execution-backend.ts:801-814; src/execution-backend/agent.ts:286-295) |
| `.cw/runs/_sandbox-profile-validation/workers/_worker/...` | never written — a token-binding context only | (src/sandbox-profile.ts:360-373) |

## Invariants and error behavior

1. Fail closed, never quiet fallback. A backend that cannot honor the profile, is not ready, has no target, or whose runtime/transport fails gives back `status: "refused"` with `attestation.status: "refused"` and a `refused:<code>` note — never a made-up completion (src/execution-backend.ts:494-545, :628-675, :776-790, :852-874, :966-994; docs/execution-backends.7.md:180-192).
2. Same envelopes, any backend. `result`/`evidence` are schema-identical and byte-stable across backends for the same task; the backend id, attestation, and handle live in provenance only (src/execution-backend.ts:14-17, :677-713; docs/real-execution-backends.7.md:14-29).
3. The red line. No model SDK import, no API key held, no model API request built. Agent spawns are argv-style `shell:false`; keys pass only through the name-filtered inherited env; anything recorded is secret-stripped first (src/execution-backend.ts:888-894, :946-958; src/execution-backend/agent.ts:24-28, :72-99).
4. Two layers never mixed: the backend evidence triple hashes the agent CHILD's stdout, never `result.md`; `result.md` is taken in by the separate `recordWorkerOutput` path (src/execution-backend.ts:878-886; docs/agent-delegation-drive.7.md:87-101).
5. Attested vs policy model: `UsageRecord.model` and `reportedModel` come only from the agent's own report; `unreported` is never backfilled from `CW_AGENT_MODEL` (src/execution-backend.ts:975; src/worker-accept/verifier-completion.ts:53-69).
6. Accept-path order is load-bearing and must not change: validate → attest telemetry → accept/audit → ledger → verify → completion → fan-out; failures in steps 1–2 throw BEFORE any accept-side state change (src/worker-isolation.ts:322-341; src/worker-accept/validation.ts:34-37; src/worker-accept/telemetry-ledger.ts:51-59).
7. Boundary violations set scope status `rejected` (codes `worker-boundary-violation` / `sandbox-*`); other failures set `failed` (src/worker-isolation.ts:416-423).
8. Custom sandbox profiles may not reuse a bundled id (reserved-name check), and a lost policy snapshot re-resolves by logical id against the WORKER's own paths, using `run.customSandboxProfiles` for custom ids (H7) (src/sandbox-profile.ts:234-241, :150-162; src/worker-isolation.ts:665-696).
9. Path checks realpath both sides, so a planted symlink whose text looks inside but whose real target is outside is denied (src/sandbox-profile.ts:388-395; src/state.ts:223-227).
10. Delegate-host attestation: on the dispatch path only `write` is enforced by CW; all other supported dimensions are attested to the host — the pre-v0.1.29 behavior for the `node` default (src/execution-backend.ts:403-437; src/worker-isolation.ts:110-119).
11. Unconfigured probe ≠ refusal: `agent`/`remote`/`ci` with no target probe as `unverified`, `ready: false`, with a non-empty reason (src/execution-backend/probes.ts:65-109; docs/agent-delegation-drive.7.md:129-134).
12. Batch collect-all: one failing job never stops its siblings; a job whose NDJSON line got through keeps its real outcome even when the whole batch child dies; every job settles (src/execution-backend/agent.ts:308-358).
13. Atomic writes: `worker.json`, `manifest.json`, `index.json`, and `agent-config.json` go through `writeJson` (temp → rename) (src/state.ts:140-152; test/agent-config-atomic-write-smoke.js).
14. Remote source: URL shape is checked before any subprocess; the raw URL exists only as one argv element; all git/diagnostic text is credential-redacted; clone/extract targets must sit inside `clones/`; archives are guarded against traversal, symlinks, and bombs; redirects are re-checked per hop (src/remote-source.ts:99-113, :159-189, :209-211, :286-334, :356-420).

## Edge cases

- `{{unknown}}` placeholders stay as literal text (only known keys substitute); the substitution regex accepts `\w+` only, so `{{a-b}}` never substitutes (src/execution-backend/agent.ts:171-173). The shell guard strips a wider token form (`[a-zA-Z0-9_.-]+`) before scanning (src/execution-backend.ts:572).
- `splitCommand`: an explicit args array always wins over splitting; a one-word command stays whole (src/agent-config.ts:63-71). In `resolveAgentInvocation` a binary WITH spaces and no delegation args is re-split too (src/execution-backend/agent.ts:58-62).
- A corrupt `agent-config.json` is treated as absent — resolution falls through to lower layers (src/agent-config.ts:73-94).
- Secret stripping keeps file paths and `{{...}}` substitutions: the long-token redaction skips anything with `/` or `\` (src/execution-backend/agent.ts:89-95). Over-redaction is accepted by design.
- `parseAgentReport` scans lines in reverse for the LAST `{...}` line, so wrappers can print human noise before the JSON line (src/execution-backend/agent.ts:115-121). `claude -p --output-format json` model ids come from `modelUsage` keys, picked by most input tokens (:135-146).
- The endpoint agent writes `result.md` only when: a body was extracted, `report.usage === undefined`, and the file does not exist yet; a write failure is swallowed (the accept layer fails closed on the missing file) (src/execution-backend.ts:1049-1058).
- `reconcileBatchOutcomes` splits on the newline BYTE on a Buffer before decode, so a giant combined stdout can never pass V8's one-string ceiling; the trailing part after the last newline is always dropped (empty or cut mid-write) (src/execution-backend/agent.ts:318-345). `runAgentBatchOutcomes` wraps the spawnSync in try/catch as a second stop — a native throw fails every job closed, never the process (:376-388).
- Probe cache: results are cached 60s per `${id}:${cwd}` in `backendProbePayload` only (`probeBackend` direct is uncached) (src/execution-backend.ts:1155-1214).
- Worker retry: re-allocation of a `failed`/`orphaned` scope reuses the same worker dir and id, bumps `retryCount`, clears `errors` (src/worker-isolation.ts:67-79). Worker ids are deterministic per task (`worker-<task>-0001`, `-0002`, ...) so replays match (src/worker-isolation/paths.ts:31-42).
- One corrupt `worker.json` never blanks a listing: `loadWorkerScopesFromDisk` skips it with a stderr line; direct `getWorkerScope` on the same file throws with context (src/worker-isolation.ts:299-315, :627-647).
- `reclaimOrphans` only acts on scopes with a positive `timeoutMs` and a parseable `createdAt`; it takes an injected `now` for deterministic tests (src/worker-isolation.ts:513-524).
- Container env pass-through skips `PATH` and `HOME` (the image gives its own) (src/execution-backend.ts:760-766).
- `bun` runs through the node-compatible path even when `bun` is installed — evidence stays byte-stable with `node`; only the provenance note differs (src/execution-backend.ts:129-139, :320-325).
- Empty command string in the policy check is denied as `empty command` (src/execution-backend.ts:1183-1186).
- Remote cache is keyed on URL(+ref), not content — a changed upstream is reused until `--refresh` (docs/remote-source-review.7.md:85-88). A corrupt git cache entry (no resolvable HEAD) falls through to a fresh clone (src/remote-source.ts:213-217). A one-entry top dir in an archive is stepped into with `lstat` so a top-level symlink is never treated as a dir (src/remote-source.ts:462-466).
- The drive blocks (refuses to spawn) rather than parks when no agent is configured: reason `agent backend not configured (set CW_AGENT_COMMAND/CW_AGENT_ENDPOINT or pass --agent-command/--agent-endpoint) — refusing rather than fabricating a completion` (src/drive.ts:199-207).

## Evidence

File:line pointers are carried inline on every claim above (relative to `plugins/cool-workflow/`). Key anchors: driver table src/execution-backend.ts:116-200; run gates :494-545; local execute :547-626; container :720-792; http delegation :821-876; agent process :915-995; agent endpoint :1002-1062; refusal envelope :1095-1126; child env :1167-1181; probe cache :1200-1214. Agent helpers src/execution-backend/agent.ts:44-390. Probes src/execution-backend/probes.ts:17-109. Config src/agent-config.ts:28-285. Profiles src/sandbox-profile.ts:35-573. Isolation src/worker-isolation.ts:61-743, src/worker-isolation/paths.ts:12-42. Accept path src/worker-accept/{validation.ts:38-113, telemetry-ledger.ts:22-142, acceptance.ts:15-120, verifier-completion.ts:13-82, blackboard-fanout.ts:9-89}. Remote source src/remote-source.ts:24-475; caller src/capability-core.ts:669-836. Children scripts/children/http-delegate-child.js:17-40, batch-delegate-child.js:25-85. Seam docs docs/execution-backends.7.md, docs/real-execution-backends.7.md, docs/agent-delegation-drive.7.md, docs/sandbox-profiles.7.md, docs/remote-source-review.7.md.

## Pinned by tests

- `test/execution-backends-smoke.js` — byte-stable envelopes across node/shell/bun; fail-closed refusals; provenance/attestation shape.
- `test/real-execution-backends-smoke.js` — delegating drivers really run; refusal codes (`delegation-target-missing`, `no-command`, `runtime-unavailable`, `delegation-failed`); remote happy path via a fake local runner.
- `test/execution-backend-agent-smoke.js` — agent driver through full dispatch; `preparedAgentOutcome` settle; canonical evidence; handle + reported model in provenance; `commandlessDelegate`; unconfigured refusal + probe transitions.
- `test/execution-backend-ci-smoke.js` — ci backend success path + refusals.
- `test/backend-registry-smoke.js` — `registerBackend` seam: a new driver appears in list/ids/descriptor/run.
- `test/agent-delegation-drive-smoke.js` — the sorted 7-id set; unconfigured agent probe == remote's unconfigured shape; stub-agent drive.
- `test/agent-stream-gate-smoke.js` — `shouldStreamAgentStderr` truth table per the man page.
- `test/sandbox-env-batch-hardening-smoke.js` — `buildChildEnv` filtering; batch child uses `job.env`; stdin caps; JSON.parse guards; `persistStderr` redaction.
- `test/agent-config-atomic-write-smoke.js` — `setAgentConfigFile` atomic temp → rename.
- `test/sandbox-profile-smoke.js`, `test/worker-isolation-smoke.js`, `test/worker-accept-path-architecture-smoke.js`, `test/worker-retry-count-smoke.js` — profile resolution/validation, scope lifecycle, accept-path order, retry counting.
- `test/remote-link-git-smoke.js`, `test/remote-link-archive-smoke.js`, `test/clones-gc-smoke.js`, `test/cli-handler-clones-smoke.js` — `--link` clone/archive flows, provenance events, cache reuse, zip-slip guard, credential non-leak, clones gc containment.
- `test/claude-p-agent-wrapper-smoke.js`, `test/codex-agent-wrapper-smoke.js`, `test/gemini-agent-wrapper-smoke.js`, `test/gemini-opencode-agent-wrapper-smoke.js`, `test/deepseek-agent-wrapper-smoke.js`, `test/opencode-agent-wrapper-smoke.js` — wrapper seam contracts.
- `test/quickstart-no-agent-smoke.js`, `test/run-all-agent-env-hermetic-smoke.js` — unconfigured-agent behavior; env hygiene in the test runner.

## Rebuild risks

1. Mixing the two layers: hashing `result.md` into the backend evidence triple, or putting the handle/attestation into `evidence`. The triple must hash the agent CHILD's stdout only, and provenance must never enter `evidence` (src/execution-backend.ts:878-886, :692-696).
2. Backfilling the model: writing `CW_AGENT_MODEL` (or the `{{model}}` policy value) as the attested/reported model. The attested id must come only from the agent's stdout report; absent ⇒ the exact string `unreported` (src/execution-backend.ts:975; src/worker-accept/verifier-completion.ts:57).
3. Quiet downgrade: running unsandboxed (or on a different backend) when the asked-for one is unready/unconfigured/unenforceable. Every such path must be a `refused` envelope with the exact code, and probe-unconfigured must be `unverified`, not refused (src/execution-backend.ts:494-545; src/execution-backend/probes.ts:95-109).
4. Shell use: any agent/child spawn through a shell string. Everything spawns argv-style `shell:false` but the `shell` driver itself, which has the control-character guard; substitution must go into discrete argv elements (src/execution-backend.ts:569-587, :951-958; src/remote-source.ts:224-235).
5. Env leaks: passing the full parent env to the agent child (must be `buildChildEnv` + the name-prefix re-allow list), or persisting/printing raw args (must pass `stripSecretArgs` first, in config AND handles AND evidence) (src/execution-backend.ts:945-949; src/execution-backend/agent.ts:66-99).
6. Delegate-host vs execute attestation: the dispatch path narrows every dimension but `write` to `attest` — getting this wrong changes recorded attestations for every default-backend run (src/execution-backend.ts:403-437).
7. Container semantics: treating exit 125 or a dead daemon as a command failure instead of a `runtime-unavailable` refusal, or skipping the `version --format {{.Server.Version}}` pre-flight (src/execution-backend.ts:738-745, :785-790).
8. Batch reconciliation: decoding the whole combined stdout as one string (V8 ceiling crash), failing ALL jobs when one line is corrupt, or letting a per-job maxBuffer cap stop scaling with job count (`34 MiB × jobs`) (src/execution-backend/agent.ts:318-390). Also the accept-path step order and its pre-mutation throws — reordering breaks replay + the hash-chained ledgers (src/worker-isolation.ts:322-341).
