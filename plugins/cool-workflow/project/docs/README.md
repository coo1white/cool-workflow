# project/docs — the map

The engineering docs of CW: plans, records, audits, and the wiki copy. They
never ship (they are outside the npm `files` list). The reference that does
ship, the contract for users, is [`../../docs/reference.md`](../../docs/reference.md).

Every entry in this folder has one line below.

New to the code? After the folder list come three parts: "The layer
stack", "Walk one command: `cw -q`", and "Decision records".

## Plans and records

| Entry | What it is |
|---|---|
| [`BACKLOG.md`](BACKLOG.md) | Ideas that do not yet help a user get, read, or check a receipt; one row each, deleted when it ships or is dropped. |
| [`ARCHITECTURE_PLAN.md`](ARCHITECTURE_PLAN.md) | The small set of architecture changes still planned. |

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

## The layer stack

The code is in [`../../src/`](../../src/), in four layers. A layer may
import the layers under it, and never one over it.

```text
   cw  (scripts/cw.js -> dist/cli.js)
        |
   src/cli/      argv -> one command, then print its text or JSON
        v
   src/wiring/   the command table (commands.ts): every command, once, as
                 data, with a lazy load of the shell module that does it
        v
   src/shell/    the work with the outside: files, the .cw/ run folder,
                 processes, git, agents, the clock
        v
   src/core/     decisions and data only: pure functions, no files, no
                 processes, no network. It imports only core/ and node: parts
```

| Layer | What it holds | May import |
|---|---|---|
| [`cli/`](../../src/cli/) | Reads argv, finds the command in the table, prints the output | `core`, `shell`, `wiring`, `cli` |
| [`wiring/`](../../src/wiring/) | The command table: one row per command | `core`, `shell`, `wiring` |
| [`shell/`](../../src/shell/) | Everything with a side effect: run store, drive, worker accept, report, bundle, receipts, agent spawn | `core`, `shell` |
| [`core/`](../../src/core/) | Pure rules and data: run state, plan, drive decisions, commit gate, hashes, formats | `core` only |

Three checks keep the rule true:

- [`test/core/layer-direction.test.mjs`](../../test/core/layer-direction.test.mjs)
  (`npm run test:unit`): `core/` imports only `core/` and `node:` parts.
- [`scripts/purity-gate.mjs`](../../scripts/purity-gate.mjs)
  (`npm run purity:check`, run by `release:check`, so by CI): checks every
  layer, and checks that `core/` does not get at files, processes,
  `process.env` or the clock. It is a ratchet: the breaks there are today
  are listed in [`scripts/purity-baseline.json`](../../scripts/purity-baseline.json),
  a new break fails, and a fixed break has to come out of the list.
- [`scripts/size-check.mjs`](../../scripts/size-check.mjs) (`npm run
  check`): `src/` stays at 5,000 lines or fewer.

## Walk one command: `cw -q`

What happens on `cw -q "<question>" -claude`, the core path of
`AGENTS.md`:

1. [`scripts/cw.js`](../../scripts/cw.js) loads `dist/cli.js`, made from
   [`src/cli.ts`](../../src/cli.ts), which calls `main` in
   [`src/cli/entry.ts`](../../src/cli/entry.ts).
2. `entry.ts` turns `-claude` into `--agent-command builtin:claude` and
   finds the ask row in [`src/wiring/commands.ts`](../../src/wiring/commands.ts).
3. The row's handler is in
   [`src/shell/commands/pipeline-cli.ts`](../../src/shell/commands/pipeline-cli.ts).
   It plans the run (`core/pipeline/plan.ts`, from
   `apps/architecture-review/`), then drives it (`shell/drive.ts`): each
   phase spawns the agent (`agent-config.ts`, `execution-backend/agent.ts`),
   takes each `result.md` back through the accept gates (`worker.ts`), and
   saves state (`run-store.ts`, `fs-atomic.ts`, `telemetry-ledger-io.ts`).
4. At the end it makes one verifier-gated commit (`commit.ts`, gated by
   `core/pipeline/commit-gate.ts`) and writes `.cw/runs/<id>/report.md`
   and `report.html` (`report.ts`).
5. The decisions on the way (what is next, retry or park, if a result
   may be taken) are pure functions in `src/core/`, so they can be tested
   with no files and no agent.

`cw --resume --run <id>` goes the same way from the saved `state.json`.

## Decision records

Why the tree is the way it is. A plan for a big change is in its PR text
(see the root `AGENTS.md`); the older intent, sdlc and rebuild files are in
git history.

| Record | What it decided |
|---|---|
| [`ARCHITECTURE_PLAN.md`](ARCHITECTURE_PLAN.md) | The architecture changes still planned |
