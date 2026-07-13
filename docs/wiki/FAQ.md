# FAQ

## Does CW Run The Model?

No. CW hands worker execution to an outside agent command or endpoint. It
records and checks the files and metadata that come back, but it does not
import a model SDK, hold an API key, or call a model API. See the
[Mental Model](Mental-Model.md) for why this line is the point of CW, not a
gap.

## Do I Need An Agent To Try It?

Not for the demo:

```bash
npx cool-workflow demo tamper
```

You need an agent for live review workflows such as `architecture-review`.

## What Happens If No Agent Is Configured?

CW returns a blocked result. It writes the state and a report you can use to
work out what is missing, but it does not act as if the work was completed.

## Where Is My Report?

Reports live under the repo that was reviewed:

```text
<repo>/.cw/runs/<run-id>/report.md
```

The same directory holds `state.json`, audit logs, telemetry, worker scopes,
results, nodes, candidates, and commits.

## What Does The Cryptography Prove?

It proves two things, when a public key is given: the record was not changed
after it was written, and the signed usage came from the holder of that key.
It does not prove the number that was first reported was true. A signer who
lies can still sign a lie; CW can prove who signed it, and whether the saved
record changed after that.

Read the full limit statement in
`plugins/cool-workflow/docs/trust-model.md` before you put weight on a green
verdict. The Wiki summary is [Trust And Audit](Trust-And-Audit.md).

## Can A Local Writer Re-Chain A Whole Log?

Yes, and the trust model says so openly. The local hash chain catches part
edits, damage, removal, and unchained changes. But a writer who controls the
whole local log can rewrite it and chain it again — unless there is an
outside anchor or a second party. CW treats that as an honest ceiling, not a
detail to hide.

## Is The Architecture Review Read-Only?

The documented `architecture-review` quickstart uses readonly worker
profiles. Other workflow apps can ask for other sandbox profiles, such as
`workspace-write`, and those requests are recorded in manifests and run
state.

## Which App Should I Start With?

Use `architecture-review` for the documented full review, or
`architecture-review-fast` when you want a shorter foreground pass. See
[Workflow Apps](Workflow-Apps.md).

## How Do I Script CW?

Use `--json` or `--format json` on CLI commands where they exist. MCP tools
offer the same runtime through `cw_*` JSON-RPC tools.

See [Commands or API](Commands-or-API.md) and
[MCP And Manifests](MCP-And-Manifests.md).

## Can I Move A Run To Another Machine?

Yes. Use `cw run export`, `cw run inspect-archive`, `cw run import`, and
`cw run verify-import`. See [Recovery And Restore](Recovery-And-Restore.md).

## Why Are There So Many Docs?

CW treats man-page-style docs as part of the contract. A runtime feature
should ship with its own doc and smoke test, so the deep material lives in
`plugins/cool-workflow/docs/` instead of making the README do everything.

## What Is The License?

BSD-2-Clause.
