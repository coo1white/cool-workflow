# Agent sandbox: run the agent inside `srt`, opt-in

Intent and spec in ONE file (the shape of `2026-09-02-backlog-six-rows.md`).

## Intent

CW's sandbox profiles say what a worker may read, write and reach, but
`docs/sandbox-profiles.7.md` is plain that CW only checks the profile and the
paths of what it accepts: stopping reads, writes, commands and the network
is "host-required", and `cw doctor` says it "cannot verify that host
enforcement". In practice only each vendor CLI's own limits apply (claude's
`--allowedTools Read,Grep,Glob`, codex's `read-only`), and a user's own agent
command (a review wrapper, say) runs with none.

This program closes that gap without making CW an execution engine: CW
DELEGATES the enforcement to Anthropic's sandbox runtime, `srt`
(`@anthropic-ai/sandbox-runtime`, Apache-2.0; bubblewrap on Linux and WSL,
Seatbelt on macOS, a host-allowlist proxy for the network), run as an outside
program, the same way it delegates the model to a vendor CLI. Zero runtime
dependencies stays true: `srt` is never in `package.json`.

The operator's yes (2026-11-02): asked whether CW needs a sandbox like
sandbox-runtime / yokoten, the operator agreed to the plan put to them (opt-in
`CW_AGENT_SANDBOX=srt`, fail closed, profile translated to srt settings,
audit what enforced it) and chose to ship it in 0.3.3: "我建议放v0.3.3",
"这样才算是一个大版本"; then "别问我了，都按照你的推荐迭代" for the rest.
Nothing here changes a default, so no POLA exception is needed.

## Measured facts (2026-11-02)

Machines: the cloud session container (Linux 6.18, Ubuntu noble, root) and
the operator's WSL (Ubuntu; bubblewrap 0.9.0-1ubuntu0.3, socat
1.8.0.0-4ubuntu0.1). `srt` 0.0.81.

1. With no bwrap/socat, `srt echo hello` fails closed: "Sandbox dependencies
   not available: bubblewrap (bwrap) not installed, socat not installed". The
   container had neither until `apt-get update && apt-get install bubblewrap
   socat`.
2. `srt "echo hello"` (the README's quoted form) does NOT work in 0.0.81 on
   either machine: the whole string is one program name ("echo hello: command
   not found"). argv form (`srt echo hello`) and `srt -c "<shell>"` work. CW
   spawns argv-style, so: `srt -s <settings.json> <binary> <args...>`.
3. No settings file: reads ALLOWED everywhere (a file under `$HOME` was read);
   writes DENIED everywhere, cwd and /tmp too ("Read-only file system");
   network DENIED (srt's proxy answers 403).
4. With `{denyRead:[$HOME/x], allowWrite:[<dir>/out], allowedDomains:[host]}`:
   the denied dir reads as missing; writes inside `allowWrite` work and
   elsewhere fail; a node child (as an agent wrapper is) runs and writes its
   result into `allowWrite`; the allowed host is reached, others get 403.
5. Upstream proxy: srt takes `HTTPS_PROXY`/`HTTP_PROXY`/`NO_PROXY` from its own
   env as its parent proxy ("Parent proxy configured: https=http://127.0.0.1:
   <port>/"); an allowed host through it gave HTTP 200. So srt needs the proxy
   vars in its env, which CW's agent env already passes (#820, #831).
6. bubblewrap ran nested inside the cloud container (no
   `enableWeakerNestedSandbox`).
7. srt's network allowlist has no "allow all": entries are names or
   `*.name` wildcards. So under srt the agent's network is always a list.
8. `srt -s <file> node agent.js -p ... -s x` takes the agent's `-s x` as its
   OWN settings path ("Error: x does not exist. Refusing to run with the
   built-in defaults"); `srt -s <file> -- node agent.js ... -s x` passes
   every agent arg through. So CW puts `--` before the agent's argv.
9. The bundled `readonly` and `default` profiles have empty `writePaths`:
   the worker's own folder is allowed through `workerOutput`. So the srt
   `allowWrite` must add the worker folder, or the agent cannot write its
   `result.md` (found by the fake-srt smoke).
10. With the real srt 0.0.81 in the cloud container, one CW agent hop under
    `readonly` wrote its `result.md`; its write into the repo and its read
    of a fake `~/.ssh/id_test` were both stopped, and CW took the result.

## Paths weighed (complexity / upkeep / cost / can it be undone)

- **Chosen: run `srt` as an outside program, opt-in.** Small (a settings
  builder plus one argv wrap at the two spawn points), upkeep is the pinned
  version and the per-vendor host lists, no cost to users who do not opt in,
  undone by unsetting one env var.
- **Turned down: CW's own bubblewrap/Seatbelt backends** (yokoten kept these
  as `YOKOTEN_FENCE=own`). Much larger, a second sandbox to keep correct on
  three OSes, and it would make CW an enforcement engine rather than a
  delegator. Hard to undo once users rely on it.
- **Turned down: a dependency on the srt npm package.** Breaks the zero
  runtime dependency red line.
- **Turned down: on by default.** srt is a 0.0.x research preview, needs
  bubblewrap and socat, and the vendor host lists are not yet measured on a
  real login; a default that breaks a working agent is worse than none.

## Spec

- `CW_AGENT_SANDBOX=srt` (unset, empty or `off` = today's behaviour, byte for
  byte). Any other value is refused with the list of allowed values.
- `srt` is found as `CW_SRT_BIN` when set, else `srt` on `PATH`; its
  `--version` must be the pinned version (`0.0.81`). Missing, wrong version,
  or `srt` cannot start its sandbox: the hop is refused with one line that
  says what to install, and never runs unsandboxed (fail closed).
- Settings come from the worker's resolved sandbox profile, written to a temp
  file per spawn:
  - `allowWrite`: the profile's `writePaths`, the temp folder, and the
    vendor's own state paths (data, not code: `sandbox.write` in
    `scripts/agents/builtin-templates.json`).
  - `denyRead`: a fixed list of secret folders under `$HOME` (`.ssh`, `.aws`,
    `.gnupg`, `.config/gh`, `.config/gcloud`, `.docker`, `.kube`, `.netrc`,
    `.cw-keys`), minus any the profile's `readPaths` name.
  - `allowedDomains`: the vendor's API hosts (`sandbox.hosts` in the
    templates file) plus `CW_AGENT_SANDBOX_HOSTS` (comma list) for a custom
    agent; empty means no network.
- Both spawn points use it: the serial agent path and the batch child's jobs.
- The worker's trust audit records which tool enforced the hop (`srt
  0.0.81`) next to the forwarded env names.
- `cw doctor` shows an `agent-sandbox` row when the variable is set (srt
  found, version, bwrap/socat on Linux), and `cw doctor --conformance` runs
  the agent through srt, so a user can check the host lists on their own
  login before relying on it.

## Acceptance

- A smoke with a fake `srt` on PATH proves the argv wrap, the settings file,
  the fail-closed refusals, and that unset means unchanged.
- A smoke that runs the real `srt` when bwrap and socat are present (skipped,
  and saying so, when not) proves a write outside `allowWrite` is stopped and
  a denied secret folder cannot be read.
- `docs/sandbox-profiles.7.md` ENFORCEMENT says what moves from
  "host-required" to "enforced by srt" when it is on.

## Architecture snapshot diff (claims this program makes stale)

(filled by the closing PR)

## What this spec got wrong (recorded at close)

(filled by the closing PR)

## Status ledger

| Step | State | PR |
|---|---|---|
| Intent + measured facts (this file) | in this PR | |
| Settings builder, fail-closed resolution, argv wrap (serial + batch) | in this PR | |
| Doctor row, man page | in this PR | |
| Real-srt smoke (skips without bwrap/socat) | in this PR | |
| Trust-audit record of what enforced the hop (`worker.agent-sandbox`, `enforcedBy: srt 0.0.81`); settings-file cleanup | done (found by the 0.3.3 release review) | |
| Operator check on WSL with `-claude` and `cw doctor --conformance` | | |
