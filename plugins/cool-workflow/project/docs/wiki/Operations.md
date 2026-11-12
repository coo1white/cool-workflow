# Operations

*For day-to-day upkeep: local checks, agent configuration, restore, and
release checks. Aimed at people running CW on real work.*

## Local Verification

From `plugins/cool-workflow`:

```bash
npm run build
npm test
npm run release:check
```

`release:check` changes nothing — it only checks. It builds, type-checks,
runs tests, and checks the canonical apps, golden-path behavior, CLI/MCP
parity, manifest drift, and that all version numbers agree.

Run focused checks:

```bash
npm run golden-path
npm run manifest:load-check
npm run parity:check
npm run gen:manifests -- --check
```

## Manifests

The source of truth is:

```text
plugins/cool-workflow/manifest/plugin.manifest.json
```

Regenerate vendor outputs:

```bash
npm run gen:manifests
```

Check for drift:

```bash
npm run gen:manifests -- --check
```

Generated plugin manifests and MCP configs are adapters. They should not fork
runtime behavior.

For the vendor target list and MCP parity model, see
[MCP And Manifests](MCP-And-Manifests.md).

## Agent Configuration

CW delegates to the agent you configure. Common routes are:

```bash
CW_AGENT_COMMAND="claude -p {{input}}"
CW_AGENT_COMMAND="codex exec {{input}}"
CW_AGENT_ENDPOINT="https://example.internal/agent"
```

The bundled Claude wrapper used by the README quickstart is:

```bash
--agent-command builtin:claude
```

Which model runs is your choice, not CW's. The model written into the record
is what the outside agent reports back; CW does not overwrite it with an
operator hint.

Check that the agent you configured truly runs and keeps CW's agent
contract (`cw-agent/1`) — this makes one short model call:

```bash
cw doctor --conformance
```

### Time limits

| Setting | What it does |
| --- | --- |
| `CW_AGENT_TIMEOUT_MS` (or `--agent-timeout-ms`) | Most time one agent run may take; 600000 ms (10 minutes) by default. Past it, the agent and every process it started are stopped, and the worker parks on the first try (from 0.3.3). |
| `CW_AGENT_IDLE_TIMEOUT_MS` | Opt-in (new in 0.3.3). Stops an agent that has written nothing, on stdout or stderr, for this long; the worker parks on the first try. Unset or `0` means off. Pick a value well above the longest quiet time your agent has — a model may think for minutes between two steps. |

### Proxy and CA settings

From 0.3.3, the agent gets these settings when you set them: `HTTP_PROXY`,
`HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY` (and the lowercase forms),
`NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE`, `SSL_CERT_DIR`, and every `CLAUDE_*`
setting. Before, an agent behind a proxy was turned away (`403 Request not
allowed`). Only the names, never the values, go into the audit record, as a
proxy URL may have a password in it. `node`, `bun`, `shell`, and `container`
tasks get them too, but only under a sandbox profile that lets the network
through. For CW's own HTTP calls (an HTTP agent endpoint, the `remote` and
`ci` backends), CW sets `NODE_USE_ENV_PROXY=1` when a proxy is set. Full
rules: `cw man sandbox-profiles`.

### Run the agent in a sandbox

From 0.3.3 CW can run each agent inside Anthropic's sandbox runtime, `srt`
(bubblewrap on Linux and WSL, Seatbelt on macOS). It is opt-in:

```bash
npm i -g @anthropic-ai/sandbox-runtime@0.0.81
sudo apt-get install bubblewrap socat        # Linux and WSL only
export CW_AGENT_SANDBOX=srt
cw doctor                                    # shows an agent-sandbox row
cw doctor --conformance                      # runs your agent through srt one time
```

Under `srt` the agent may write only to its own worker folder, the temp
folder, the paths its profile names, and its own CLI's state folder; it may
not read `~/.ssh`, `~/.aws`, `~/.gnupg`, and other secret folders; and it may
reach only its vendor's API hosts (add more with `CW_AGENT_SANDBOX_HOSTS`, a
comma list). If `srt` is missing, is a different version, or cannot start
its sandbox, the agent is not run at all — never run without the sandbox it
was asked to have. Full rules: `cw man sandbox-profiles`.

## Restore And Recovery

Export a run:

```bash
cw run export <run-id> --output run.cw-archive.json
```

Inspect before restoring:

```bash
cw run inspect-archive run.cw-archive.json
```

Restore:

```bash
cw run import run.cw-archive.json --target /path/to/target-repo
cw run verify-import <run-id> --cwd /path/to/target-repo --strict
```

For stricter import behavior, set:

```bash
CW_REQUIRE_ARCHIVE_INTEGRITY=1
```

That refuses archives missing the top-level integrity block before any write.

For the operator flow and failure modes, see
[Recovery And Restore](Recovery-And-Restore.md).

## Metrics And Cost

```bash
cw metrics show <run-id>     # one run
cw metrics summary           # this repo's runs (add --scope home for every repo)
```

Every number is worked out from the run's own state — times from saved
times, rates from saved results. There is no metrics database. A rate with
no samples is `n/a`, never a made-up 0% or 100%. Token use is what the agent
reported (and signed, where keys are set); if it reported nothing, it is
`unreported`, never 0. CW puts no price on that use: cost is `unpriced`
when use was reported and `unreported` when it was not. Full rules:
`cw man observability-cost-accounting`.

## Old Run State

A run made by an older CW still loads. Check one before you put weight on
it:

```bash
cw state check <run-id>                  # dry run: what migration it needs
cw migration list                        # every known step from old to new
cw migration check <run-id>              # can it be moved to this version?
cw migration prove <run-id>              # move it there and back, and see nothing is lost
```

Nothing is written unless you say `--write`. State from a newer CW, or state
CW cannot make sense of, is refused, never quietly loaded. Fields of the
removed multi-agent family (`multiAgent`, `blackboard`, `candidates`) are kept
as data. Full rules: `cw man release-and-migration` and
`cw man contract-migration-tooling`.

## Release Flow

First check the release machine. It takes a few seconds and runs no tests:

```bash
cd plugins/cool-workflow
npm run release:doctor -- X.Y.Z
```

It reports every problem at once, each with the command that fixes it: an old
or wrong branch, changed files, a reviewer command that is not there, a signing
key that cannot be read, a private git email, `gh` not signed in, or a tag that
is already there. Then cut the release:

```bash
npm run release -- X.Y.Z
```

`npm run release` runs the same checks first, then the gate, the independent
review, the signed verdict, the tag, and the npm publish. The review step is
given to your configured agent command or endpoint. Do not write the verdict
file by hand.

CI goes through the same flow (with a stub reviewer and no key) on every pull
request that changes release tooling, with the npm that comes with Node 24 and
with the newest npm, so a break shows up there and not in a real cut.

## Operational Checklist

Before treating a run as evidence:

1. Confirm the report path is under the intended repo.
2. Run `cw telemetry verify <run-id>` when telemetry exists.
3. Run `cw audit verify <run-id>` for trust-audit integrity.
4. If the run was restored, run `cw run verify-import <run-id> --strict`.
5. Keep the original `.cw/runs/<run-id>/` directory or exported archive with the
   report you share.
