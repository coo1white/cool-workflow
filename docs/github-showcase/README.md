<!--
Draft note: this file is written to render from docs/github-showcase/.
Adjust relative links before applying it as the root README.
-->

<div align="center">

# Cool Workflow

**Point an AI coding agent at a repo. Get a saved, cited report and an audit trail you can re-verify.**

[![CI](https://img.shields.io/github/actions/workflow/status/coo1white/cool-workflow/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/coo1white/cool-workflow/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/cool-workflow?style=flat-square&label=npm&color=cb3837)](https://www.npmjs.com/package/cool-workflow)
[![downloads](https://img.shields.io/npm/dm/cool-workflow?style=flat-square&label=downloads)](https://www.npmjs.com/package/cool-workflow)
[![provenance](https://img.shields.io/badge/npm-provenance-3178C6?style=flat-square)](https://www.npmjs.com/package/cool-workflow)
[![license](https://img.shields.io/badge/license-BSD--2--Clause-blue?style=flat-square)](../../LICENSE)

![Cool Workflow turns AI agent repo questions into saved, cited, tamper-evident reports.](../assets/cool-workflow-readme-promo.png)

</div>

Cool Workflow, or CW, is a zero-runtime-dependency TypeScript/Node control-plane
for agent workflows. It does not run a model. It delegates each worker to the
agent command or HTTP endpoint you configure, records what happened as durable
files under `.cw/`, verifies the result, and writes a report you can inspect
after the chat window is gone.

The first useful proof takes about 30 seconds and needs no agent:

```bash
npx cool-workflow demo tamper
```

That command builds a real signed telemetry ledger, forges it three ways (incl.
editing a signed finding), and catches all three offline. Look for `VERDICT:
tamper-evidence holds` in stdout.

## Quick Start

Run a real repository review with your own agent:

```bash
npx cool-workflow quickstart architecture-review \
  --repo /path/to/your/project \
  --question "What are the main risks in this codebase?" \
  --agent-command builtin:claude
```

CW plans the app, dispatches workers, asks the configured agent to write each
`result.md`, verifies the outputs, and prints the saved `reportPath`.

If no agent is configured, CW stops with `status: blocked`. It still writes the
run state and triage report, but it does not invent a completion.

The report lands under your target repo:

```text
<repo>/.cw/runs/<run-id>/
  state.json
  report.md
  audit/
  telemetry.json
  workers/
  results/
  commits/
```

## What You Can Run

| Job | What it produces |
| --- | --- |
| `architecture-review` | A cited architecture and risk report for a repository. |
| `architecture-review-fast` | A shorter six-worker architecture review for faster first results. |
| `pr-review-fix-ci` | PR review, CI diagnosis, and optional fix workflow. |
| `research-synthesis` | Evidence-backed synthesis over local or cited sources. |
| `release-cut` | A gated release workflow with review, checks, and release notes. |

List the installed apps:

```bash
cw app list
```

The same runtime is exposed through MCP tools for agent hosts. CLI and MCP
capabilities share one registry, and declared JSON payloads are parity-checked.

## Why It Exists

Most agent runs disappear into scrollback. CW makes the run a file-backed object:

```text
workflow app -> plan -> dispatch -> isolated workers
  -> results -> verifier gate -> commit/checkpoint -> report
```

Because the control-plane only delegates, your model credentials stay with your
agent. CW records the command, output envelope, provenance, audit events, and
telemetry verdicts. The thing that spends tokens is not the thing that keeps the
books.

## Trust Model

CW gives you mechanisms to re-check the record:

```bash
cw telemetry verify <run-id>
cw telemetry verify <run-id> --pubkey <public.pem>
cw audit verify <run-id>
```

Telemetry verification re-proves the recorded hash chain and, when a public key
is supplied, re-runs ed25519 checks for attested usage records. This proves
record integrity and signed attribution. It does not prove that the original
executor reported a true number. The honest limits are documented in
[Trust Model & Limitations](../../plugins/cool-workflow/docs/trust-model.md).

## Resume, Restore, Replay

CW runs are durable. You can pause and continue:

```bash
cw quickstart architecture-review \
  --repo /path/to/project \
  --question "What should I audit?" \
  --agent-command builtin:claude \
  --resume

cw quickstart architecture-review --run <run-id> --resume
```

You can also move a run archive to another directory or machine:

```bash
cw run export <run-id> --output run.cw-archive.json
cw run inspect-archive run.cw-archive.json
cw run import run.cw-archive.json --target /path/to/restored-repo
cw run verify-import <run-id> --cwd /path/to/restored-repo --strict
```

The restore path re-checks file digests, the manifest digest, telemetry when
present, and the restored trust-audit chain.

## Work From Source

```bash
git clone https://github.com/coo1white/cool-workflow.git
cd cool-workflow/plugins/cool-workflow
npm install
npm run build
npm test
```

High-signal checks:

```bash
npm run golden-path
npm run manifest:load-check
npm run release:check
```

`release:check` is non-destructive. It builds, type-checks, runs tests, checks
manifest drift, verifies parity, and runs release-readiness gates.

## Design Constraints

- Zero runtime dependencies.
- Node.js 18 or newer.
- No model SDK inside CW.
- Vendor-specific agent behavior lives in wrappers or config, not the core.
- stdout is data; diagnostics go to stderr.
- Invalid or unverifiable input fails closed instead of silently falling back.

## Docs

- [Getting Started](../../plugins/cool-workflow/docs/getting-started.md)
- [Project Index](../../plugins/cool-workflow/docs/project-index.md)
- [Agent Delegation Drive](../../plugins/cool-workflow/docs/agent-delegation-drive.7.md)
- [Run Registry / Control Plane](../../plugins/cool-workflow/docs/run-registry-control-plane.7.md)
- [CLI <-> MCP Parity](../../plugins/cool-workflow/docs/cli-mcp-parity.7.md)
- [Trust Model & Limitations](../../plugins/cool-workflow/docs/trust-model.md)

## License

BSD-2-Clause. See [LICENSE](../../LICENSE). Built by COOLWHITE LLC.
