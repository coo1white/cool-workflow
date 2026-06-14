# FAQ

## Does CW Run The Model?

No. CW delegates worker execution to an external agent command or endpoint. It
records and verifies the resulting files and metadata, but it does not import a
model SDK, hold an API key, or call a model API.

## Do I Need An Agent To Try It?

Not for the demo:

```bash
npx cool-workflow demo tamper
```

You need an agent for live review workflows such as `architecture-review`.

## What Happens If No Agent Is Configured?

CW returns a blocked result. It writes state and a triage report, but it does not
pretend the work completed.

## Where Is My Report?

Reports live under the reviewed repository:

```text
<repo>/.cw/runs/<run-id>/report.md
```

The same directory contains `state.json`, audit logs, telemetry, worker scopes,
results, nodes, candidates, and commits.

## What Does The Cryptography Prove?

It proves record integrity and signed attribution for reported usage when a
public key is supplied. It does not prove the original reported number was true.
A dishonest signer can still sign a lie; CW can prove who signed it and whether
the recorded ledger changed afterward.

Read the full limit statement in
`plugins/cool-workflow/docs/trust-model.md` before relying on a green verdict.
The Wiki summary is [Trust And Audit](Trust-And-Audit.md).

## Can A Local Writer Re-Chain A Whole Log?

The trust model documents that limitation. Local hash chains detect partial
edits, corruption, removal, and unchained changes. A writer who controls the
whole local log can rewrite and re-chain it unless there is an external anchor or
second party. CW treats that as an honest ceiling, not a marketing detail to hide.

## Is The Architecture Review Read-Only?

The documented `architecture-review` quickstart uses readonly worker profiles.
Other workflow apps can request other sandbox profiles, such as
`workspace-write`, and those requests are recorded in manifests and run state.

## Which App Should I Start With?

Use `architecture-review` for the documented full review, or
`architecture-review-fast` when you want a shorter foreground pass. See
[Workflow Apps](Workflow-Apps.md).

## How Do I Script CW?

Use `--json` or `--format json` on CLI commands where available. MCP tools expose
the same runtime through `cw_*` JSON-RPC tools.

See [Commands or API](Commands-or-API.md) and
[MCP And Manifests](MCP-And-Manifests.md).

## Can I Move A Run To Another Machine?

Yes. Use `cw run export`, `cw run inspect-archive`, `cw run import`, and
`cw run verify-import`. See [Recovery And Restore](Recovery-And-Restore.md).

## Why Are There So Many Docs?

CW treats man-page-style docs as part of the contract. Runtime features should
ship with matching docs and smoke tests, so advanced material lives in
`plugins/cool-workflow/docs/` instead of making the README do everything.

## What Is The License?

BSD-2-Clause.
