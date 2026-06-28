# SANDBOX-PROFILES(7)

## NAME

Sandbox Profiles - named, durable worker policy contracts for Cool Workflow

## SYNOPSIS

```text
node dist/cli.js sandbox list
node dist/cli.js sandbox show readonly
node dist/cli.js sandbox validate ./site-sandbox.json
node dist/cli.js dispatch <run-id> --sandbox readonly
node dist/cli.js worker manifest <run-id> <worker-id>
```

## DESCRIPTION

A sandbox profile is a CW policy contract. It says what the agent host lets a
worker read, write, execute, get to over the network, and take in through
environment variables.

By itself it is not a container, jail, chroot, seatbelt profile, packet filter,
or OS process sandbox. CW does profile validation, deterministic path
normalization, worker result acceptance, and durable feedback for denied worker
output. The agent host has to do OS-level file access, process execution,
network access, and environment filtering.

**IMPORTANT**: Under the default `node` backend, a sandbox profile's
`execute`, `network`, and `env` policy is **attested, not enforced**. CW
validates the policy, records it in the worker manifest, and attests that
these limits were declared — but the actual enforcement of command execution
restrictions, network isolation, and environment variable filtering is
DELEGATED to the host runtime. For full enforcement, use the `container`
backend (`--backend container`) with Docker/Podman, or apply OS-level
sandboxing to the agent process. Without OS enforcement, a worker under a
`locked-down` profile can still run arbitrary commands and access the network.

CW also now (v0.1.95) applies `buildChildEnv(policy)` as a baseline for agent
spawns — only `PATH`, `HOME`, explicit `expose` entries, and well-known
`CW_*` + LLM provider API key environment variables pass through. The
operator's other process environment is not inherited by default.

The design goal is simple:

```text
named policy -> resolved worker manifest -> host enforcement -> CW acceptance
```

Profiles are picked at dispatch time and kept in run state, worker records,
dispatch manifests, worker manifests, feedback records, and reports.

## BUNDLED PROFILES

`default`
: Keeps the same Worker Isolation behavior. Workers may read the workspace
  and write only accepted worker output paths, unless more `allowedPaths`
  come from older APIs.

`readonly`
: Workers may read the workspace and write only worker-local output paths.
  Network access is denied by profile. CW still needs the host to do
  read-only mounts or an equal OS policy.

`workspace-write`
: Workers may read and write the workspace, and worker-local output paths too.
  Use this only for workers that are meant to change repository files.

`locked-down`
: Workers may read only `input.md` and write only `result.md`. Command,
  network, and inherited environment access are all denied by policy.

## PROFILE SHAPE

Profile files use schema version `1`:

```json
{
  "schemaVersion": 1,
  "id": "site-readonly",
  "title": "Site Readonly",
  "readPaths": ["$cwd"],
  "writePaths": [],
  "workerOutput": { "result": true, "artifacts": true, "logs": true },
  "execute": { "mode": "none" },
  "network": { "mode": "none" },
  "env": { "inherit": false, "expose": ["PATH"] }
}
```

The path tokens you may use are `$cwd`, `$runDir`, `$workerDir`, `$inputPath`,
`$resultPath`, `$artifactsDir`, and `$logsDir`. Relative paths are worked out
from the run workspace. Empty paths, control characters, unknown tokens, and
`..` traversal are turned away.

`execute.mode` and `network.mode` are `none`, `allowlist`, or `any`.
Allowlisted commands or network targets are exact strings. Environment variable
names have to use normal shell identifier syntax.

## ENFORCEMENT

CW-enforced:

- profile existence and profile-file validation
- deterministic path resolution
- worker output acceptance against effective write paths
- rejected worker scope, error StateNode, and ErrorFeedback on denied output

Host-required:

- stopping reads outside `readPaths`
- stopping writes before CW takes a result
- command execution restrictions
- network restrictions
- environment variable filtering

Worker manifests have both lists as `sandbox.enforcedByCW` and
`sandbox.hostRequired`. Do not put forward CW Sandbox Profiles as OS-level
sandboxing unless the agent host truly puts OS policy to work.

## FILES

```text
.cw/runs/<run-id>/state.json
.cw/runs/<run-id>/dispatches/<dispatch-id>.json
.cw/runs/<run-id>/workers/<worker-id>/worker.json
.cw/runs/<run-id>/workers/<worker-id>/manifest.json
.cw/runs/<run-id>/feedback/
.cw/runs/<run-id>/report.md
```

## FAILURE MODES

Unknown requested profiles fail closed with `sandbox-profile-not-found`.

Bad profile files fail validation with `sandbox-profile-invalid`.

Denied worker output writes make `sandbox-write-denied` feedback. Runtime
helpers also give `sandbox-read-denied`, `sandbox-network-denied`, and
`sandbox-command-denied` for hosts that want to note down those decisions through
CW.

CW never quietly drops a requested profile down to `default`.

## COMPATIBILITY

Sandbox Profiles come in with CW v0.1.8. The legacy `allowedPaths` field
stays in worker scopes and manifests as the effective write-path alias for
older callers. New hosts should read `sandboxPolicy.readPaths` and
`sandboxPolicy.writePaths`, then put worker output allowances from
`sandboxPolicy.workerOutput` to work.
0.1.51
