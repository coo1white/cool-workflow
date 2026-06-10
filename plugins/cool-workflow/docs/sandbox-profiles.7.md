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

A sandbox profile is a CW policy contract. It tells the agent host what a
worker may read, write, execute, access over the network, and receive through
environment variables.

It is not a container, jail, chroot, seatbelt profile, packet filter, or OS
process sandbox by itself. CW enforces profile validation, deterministic path
normalization, worker result acceptance, and durable feedback for denied worker
output. The agent host must enforce OS-level file access, process execution,
network access, and environment filtering.

The design goal is simple:

```text
named policy -> resolved worker manifest -> host enforcement -> CW acceptance
```

Profiles are selected at dispatch time and stored in run state, worker records,
dispatch manifests, worker manifests, feedback records, and reports.

## BUNDLED PROFILES

`default`
: Preserves existing Worker Isolation behavior. Workers may read the workspace
  and write only accepted worker output paths unless additional `allowedPaths`
  are supplied by older APIs.

`readonly`
: Workers may read the workspace and write only worker-local output paths.
  Network access is denied by profile. CW still relies on the host to enforce
  read-only mounts or equivalent OS policy.

`workspace-write`
: Workers may read and write the workspace, plus worker-local output paths.
  Use this only for workers expected to modify repository files.

`locked-down`
: Workers may read only `input.md` and write only `result.md`. Command,
  network, and inherited environment access are denied by policy.

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

Supported path tokens are `$cwd`, `$runDir`, `$workerDir`, `$inputPath`,
`$resultPath`, `$artifactsDir`, and `$logsDir`. Relative paths are resolved
from the run workspace. Empty paths, control characters, unknown tokens, and
`..` traversal are rejected.

`execute.mode` and `network.mode` are `none`, `allowlist`, or `any`.
Allowlisted commands or network targets are exact strings. Environment variable
names must use normal shell identifier syntax.

## ENFORCEMENT

CW-enforced:

- profile existence and profile-file validation
- deterministic path resolution
- worker output acceptance against effective write paths
- rejected worker scope, error StateNode, and ErrorFeedback on denied output

Host-required:

- preventing reads outside `readPaths`
- preventing writes before CW accepts a result
- command execution restrictions
- network restrictions
- environment variable filtering

Worker manifests include both lists as `sandbox.enforcedByCW` and
`sandbox.hostRequired`. Do not present CW Sandbox Profiles as OS-level
sandboxing unless the agent host actually applies OS policy.

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

Malformed profile files fail validation with `sandbox-profile-invalid`.

Denied worker output writes create `sandbox-write-denied` feedback. Runtime
helpers also provide `sandbox-read-denied`, `sandbox-network-denied`, and
`sandbox-command-denied` for hosts that want to record those decisions through
CW.

CW never silently downgrades a requested profile to `default`.

## COMPATIBILITY

Sandbox Profiles are introduced in CW v0.1.8. The legacy `allowedPaths` field
remains in worker scopes and manifests as the effective write-path alias for
older callers. New hosts should read `sandboxPolicy.readPaths` and
`sandboxPolicy.writePaths`, then apply worker output allowances from
`sandboxPolicy.workerOutput`.
0.1.51
