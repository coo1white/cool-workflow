# project/docs — the map

The engineering docs of CW: plans, records, audits, and the wiki copy. They
never ship (they are outside the npm `files` list). The man pages that do
ship, the contract for users, are in [`../../docs/`](../../docs/).

Every entry in this folder has one line below;
`test/docs-layout-smoke.js` fails when an entry and this list do not
agree.

## Plans and records

| Entry | What it is |
|---|---|
| [`intent/`](intent/) | One intent + spec file per program, named `YYYY-MM-DD-<slug>.md`. A program's file joins `YYYY-MM-archive.md` when its closing PR has merged. |
| [`sdlc/`](sdlc/) | Stage 3 plans (`<program>/plan.md`) for programs from the operator's `~/Developer/sdlc/` pipeline. |
| [`BACKLOG.md`](BACKLOG.md) | Ideas that serve no North Star track yet; one row each, deleted when it ships or is dropped. |
| [`ARCHITECTURE_PLAN.md`](ARCHITECTURE_PLAN.md) | The small set of architecture changes still planned. |
| [`rebuild/`](rebuild/) | The v2 rebuild: `PLAN.md`, `DESIGN_MINIMAL_KERNEL.md`, `CUTOVER.md`, and `SPEC/`, the pinned behavior of each kernel part (byte-exact). |

## Proof

| Entry | What it is |
|---|---|
| [`audits/`](audits/) | Receipts and verdicts, append-only; never cleaned up. |
| [`publishing-audits.md`](publishing-audits.md) | How to make a cited audit of a repo and put it out with care. |
| [`scripts/`](scripts/) | `verify-audit-cites.js`, which checks every citation in an audit resolves. |
| [`benchmark.md`](benchmark.md) | A measured benchmark run, with its date and CW version. |

## For readers

| Entry | What it is |
|---|---|
| [`wiki/`](wiki/) | The copy of the GitHub wiki pages; published by hand after a release. |
| [`assets/`](assets/) | Images for the README, the wiki, and the launch demo. |

Worked audit examples are in [`../examples/`](../examples/).
