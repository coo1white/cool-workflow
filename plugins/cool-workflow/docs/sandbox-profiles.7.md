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

New in 0.3.3: the agent child also gets the network and trust vars a
vendor CLI needs to get to its API, when they are set: `HTTP_PROXY`,
`HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY` (and the lowercase forms),
`NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE`, `SSL_CERT_DIR`, and every `CLAUDE_*`
var (for example `CLAUDE_CONFIG_DIR`, which the claude CLI reads for its
login). Without them, an agent behind a proxy was turned away (`403 Request
not allowed`). A proxy URL may have a password in it; these vars go only to
the agent command the operator gave, and only their names are kept in the
`worker.agent-env` audit event, never the values. A name in the policy's
`deny` list is still taken out. `NODE_USE_ENV_PROXY` is passed through
too, when you set it.

**Proxy and CA for the other children (also new in 0.3.3).**

- The `local` backend (`node`, `bun` and `shell` tasks) and the
  `container` backend (`docker`/`podman run -e`) now pass the same proxy and
  CA vars, but only under a profile that lets the network through
  (`network.mode` is not `none`, as in `default` and `workspace-write`).
  Up to 0.3.2 they kept only `PATH` and `HOME`, so a task that used the
  network failed behind a proxy. Under `readonly` and `locked-down` (network
  `none`) nothing changes. The `remote` and `ci` backends send their env to
  a remote runner, so they never get these vars: a proxy URL may hold a
  password.
- Node's own `fetch` reads `HTTP(S)_PROXY` only when `NODE_USE_ENV_PROXY=1`
  is set (Node 22.21+ and 24.5+; on an older Node the proxy is not used).
  So when a proxy var is set, CW now sets `NODE_USE_ENV_PROXY=1` for the
  children it starts to run `fetch`: the HTTP agent (`CW_AGENT_ENDPOINT`,
  one at a time or in a concurrent round), the `remote` and `ci` backends,
  and the download of an archive `--repo` URL. Up to 0.3.2 those children
  went straight to the endpoint and did not use the proxy. A
  `NODE_USE_ENV_PROXY` you set yourself (for example `0`) is kept. Node's
  "experimental" note about it is kept out of their stderr.

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

**The agent sandbox, `CW_AGENT_SANDBOX=srt` (new in 0.3.3, opt-in).** CW can
run each agent command inside Anthropic's sandbox runtime, `srt`
(`@anthropic-ai/sandbox-runtime`; bubblewrap on Linux and WSL, Seatbelt on
macOS, and a proxy that lets through only listed hosts). CW does not enforce
anything itself here: it DELEGATES to `srt`, run as an outside program,
never a package dependency, the way it delegates the model to a vendor CLI.

- Set `CW_AGENT_SANDBOX=srt` (unset, empty or `off` changes nothing). CW
  uses `CW_SRT_BIN`, else `srt` on `PATH`, and needs version 0.0.81:
  `npm i -g @anthropic-ai/sandbox-runtime@0.0.81`, and on Linux and WSL
  `sudo apt-get install bubblewrap socat`.
- Each agent run becomes `srt -s <settings> -- <agent> <args...>` (the
  `--` keeps an agent argument such as `-s x` from being read as srt's),
  in a single hop and in a concurrent round alike. The settings come from
  the worker's profile:
  - writes: only the profile's `writePaths`, the worker's own folder
    (`result.md`, `logs/`), the temp folder, and the vendor CLI's own state
    paths (`sandbox.vendors` in `scripts/agents/builtin-templates.json`, for
    example `~/.claude`);
  - reads: everything but `~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.config/gh`,
    `~/.config/gcloud`, `~/.docker`, `~/.kube`, `~/.netrc` and `~/.cw-keys`
    (the release signing key). A profile `readPaths` entry at or inside one
    of them keeps that one readable; a broader one (the repo being `$HOME`)
    does not;
  - network: only the vendor's API hosts (the same templates data) plus a
    comma list in `CW_AGENT_SANDBOX_HOSTS`; an agent of your own gets only
    that list. srt sends allowed hosts through your `HTTPS_PROXY`.
- Fail closed: an unknown value, no `srt`, a different srt version, or an
  srt that cannot start its sandbox (no bubblewrap) refuses the hop with the
  reason. The agent is never run without the sandbox it was asked to have.
- Each sandboxed hop's handle records `sandboxEnforcedBy: "srt 0.0.81"`,
  and a drive writes it as a `worker.agent-sandbox` trust-audit event
  (`decision: "enforced"`, with `enforcedBy` and the profile id). The
  settings file, in the temp folder, is removed once the hop ends.
- `cw doctor` shows an `agent-sandbox` row while it is set, and
  `cw doctor --conformance` runs your agent through srt, so you can check
  its hosts on your own login before you rely on it.

With it on, "stopping reads outside `readPaths`" (for the secret folders
above), "stopping writes before CW takes a result" and "network
restrictions" move from host-required to enforced by srt.

## FILES

```text
.cw/runs/<run-id>/state.json
.cw/runs/<run-id>/dispatches/<dispatch-id>.json
.cw/runs/<run-id>/workers/<worker-id>/worker.json
.cw/runs/<run-id>/workers/<worker-id>/manifest.json
.cw/runs/<run-id>/feedback/  (made only if a feedback record is written)
.cw/runs/<run-id>/report.md
```

## FAILURE MODES

Unknown requested profiles fail closed with `sandbox-profile-not-found`.

Bad profile files fail validation with `sandbox-profile-invalid`.

Denied worker output writes make `sandbox-write-denied` feedback. The worker
output paths (`result.md`, `artifacts/`, `logs/`) are checked on the real path
as well as the written path: when `result.md`, or a folder between the run
folder and it, is a symlink that points outside those paths, the write is
refused with `sandbox-write-denied` and the message "write path resolves
through a symlink outside sandbox profile <id>: <path> -> <real path>". Both
sides are compared as real paths, so a run under a symlinked temp root (macOS
`/var` -> `/private/var`) is not refused. `cw result` makes the same check on
the worker's `result.md` before it copies the operator file there, and so
does the drive before it writes a result-cache hit or a sub-workflow result
there; a refused drive write is a failed hop (retry, then park). Runtime
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
