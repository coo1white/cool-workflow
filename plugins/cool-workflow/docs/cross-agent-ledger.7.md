# Cross-Agent Handoff Ledger

CW adds `cw ledger` — a way for two agents scoped to two separate repos to hand
each other a CHANGE PROPOSAL or a REVIEW VERDICT as verifiable data, not chat.
One side proposes or reviews; the other side verifies the entry fail-closed and
turns a proposal into a real pull request. Design notes:
[handoff-ledger](designs/handoff-ledger.md).

Each entry is a self-contained JSON object that carries its own sha256 content
digest. The producing side prints one; it reaches the other session by human
relay or a shared git repo (below); the consuming side runs `cw ledger verify`
(one entry) or `cw ledger list` (a whole directory) before acting. A tampered or
malformed entry is refused with a non-zero exit, so
`cw ledger verify <file> && open-pr` can never proceed on a lie.

Every verb is on both surfaces: the CLI (`cw ledger ...`) and MCP
(`cw_ledger_propose`, `cw_ledger_review`, `cw_ledger_verify`, `cw_ledger_list`),
so an agent can mint and check entries in-process, not only from a shell.

`cw ledger` is a NEW verb. It does not touch `cw handoff`, which is a separate
collaboration primitive (ownership transfer of a run/task) — see
[team-collaboration](team-collaboration.7.md).

## Why a ledger, not a shared folder

The two agents run as two separate cloud sessions. They share no filesystem, and
each is scoped to one repo at launch, so a local folder cannot be the channel.
The only medium both sides can durably reach is git/GitHub. `cw ledger` therefore
produces and consumes portable, self-verifying entries; how an entry crosses
(operator relay now, a shared handoff repo later) is transport, kept separate
from the verb.

## Mechanism vs policy

The MECHANISM is small and lives in the kernel (`src/ledger.ts`): build a
proposal or a review entry, seal it with a sha256 digest over its canonical
content, and verify that digest fail-closed. No run state, no network, no new
runtime dependency. The POLICY — which repos, who may propose, whether a verdict
blocks a merge — stays outside, in the operator's hands and the transport.

The digest is computed over a deterministic serialization (object keys sorted
recursively) of every field except `id` and `digest`, which are derived from it.
The `id` is content-addressed: `ldg-` + the first 16 hex chars of the digest.

## Commands

```
cw ledger propose --from <a> --to <b> --title <t> --rationale <r> \
                  [--files a.ts,b.ts] [--diff <patch>]
cw ledger review  --from <a> --to <b> --target <proposal-id|pr-ref> \
                  --verdict <approved|rejected> [--findings "a,b"]
cw ledger verify  [--file <path>]        # else reads the entry from stdin
cw ledger list    --dir <ledger-dir> [--dir <mirror-2> ...]   # verify a dir (or union of mirrors)
```

All write JSON to stdout (stdout is data). `propose` and `review` print a sealed
entry; `verify` prints a check report; `list` prints a per-entry report over a
directory.

## Git transport (T2a — shared handoff repo)

The two agents cannot share a local folder, but they can share a git repo both
are scoped to. The ledger rides on it with no git logic in the kernel — writing
is composition through files, and `git` is the operator's (or a wrapper's) step:

```
# Producing side (cool-workflow), inside the shared repo's working tree:
cw ledger propose --from cool-workflow --to chime \
  --title "Add retry" --rationale "flaky net" --files src/net.ts \
  > ledger/$(cw ledger propose ... | jq -r .id).json      # or any unique name
git add ledger/ && git commit -m "propose: add retry" && git push

# Consuming side (chime):
git pull
cw ledger list --dir ledger && echo "inbox verified — safe to act"
```

`cw ledger list` reads every `*.json` in the directory, verifies each entry, and
reports `allOk`. It is a **fail-closed inbox**: if any single entry is tampered,
malformed, or unreadable, `allOk` is `false` and the command exits `1`, so the
receiving side refuses the whole batch rather than acting on a mixed one.

### Inbox resolution — which proposals are still open

`cw ledger list` also derives a `resolution` summary so the inbox is
machine-actionable without opening each file. It pairs every proposal with the
review(s) whose `target` is that proposal's id and reports one of four states:

```json
"resolution": {
  "proposals": [
    { "id": "ldg-1de7c92172af1871", "title": "Add retry", "resolution": "approved", "reviews": ["ldg-…"] },
    { "id": "ldg-…", "title": "Rename thing", "resolution": "pending", "reviews": [] }
  ],
  "pending": 1, "approved": 1, "rejected": 0, "contested": 0
}
```

- `pending` — no verified review targets the proposal yet.
- `approved` / `rejected` — every verified review targeting it agrees.
- `contested` — verified reviews targeting it disagree (both an APPROVED and a
  REJECTED exist); the ledger REPORTS the disagreement, it does not pick a
  winner (mechanism, not policy — whether a verdict blocks a merge stays
  outside).

Only **verified** entries take part: a tampered review can never resolve a
proposal, so a proposal answered only by a failing review stays `pending`
(fail-closed). The fields are additive — the existing `entries[]` / `allOk` /
`count` output is byte-unchanged (POLA), with each entry now also carrying its
`title` (proposals) or `target`/`verdict` (reviews). The same `resolution` rides
on the mirror-union output and on the `cw_ledger_list` MCP tool.

### Mirrors — union-verifying several directories

`--dir` is repeatable. With two or more, `cw ledger list` **union-verifies** the
directories as mirrors of one ledger (e.g. the same handoff repo cloned from a
GitHub remote and one or more self-hosted Gitea remotes in different places):

```
cw ledger list --dir gh/ledger --dir gitea-eu/ledger --dir gitea-asia/ledger
```

The union is **conflict-free by construction**: entries are immutable and
content-addressed, so the same entry mirrored to several hosts collapses to one
result whose `dirs` records every mirror it was found in. It stays **fail-closed
across mirrors** — a tampered entry in ANY mirror sets `allOk:false` and exits
`1`. This is for redundancy and reachability, not load: the ledger's traffic is
tiny; multiple hosts guard against one being down or unreachable.

A single `--dir` keeps the original single-directory output (a `dir` field, no
`dirs`); two or more switch to the union shape (`dirs` plus a per-entry `dirs`).
The transport stays git-host-agnostic — adding a mirror is one more clone + one
more `--dir`, no code change.

## Entry shape

A proposal:

```json
{
  "kind": "proposal",
  "schemaVersion": 1,
  "from": "cool-workflow",
  "to": "chime",
  "title": "Add retry to the fetch path",
  "rationale": "the network is flaky under load",
  "targetFiles": ["src/net.ts"],
  "suggestedDiff": "@@ ... @@",
  "createdAt": "<iso>",
  "id": "ldg-<16 hex>",
  "digest": "sha256:<64 hex>"
}
```

A review is the same envelope with `kind: "review"`, plus `target` (the proposal
id or a PR ref), `verdict` (`APPROVED` | `REJECTED`), and `findings` (a list).

## Verification contract

`cw ledger verify` re-proves the entry and exits fail-closed:

- Not a JSON object, or non-JSON bytes → `ok:false`, code `ledger-bad-json` /
  `ledger-not-object`.
- Unknown `kind`, wrong `schemaVersion`, missing digest, missing a required
  field, or a bad `verdict` → `ok:false` with the matching code.
- Stored digest does not match a fresh digest of the content →
  `ok:false`, code `ledger-digest-mismatch`.
- `id` is not the content-addressed id for the digest (spoofed or absent) →
  `ok:false`, code `ledger-id-mismatch`. `id` is excluded from the digest, so it
  is bound to the content by this check — a forged entry cannot set its `id` to
  collide with a legitimate one and slip through the mirror-union de-duplication.

Any `ok:false` exits `1`. An intact entry exits `0` with `ok:true`.

## Example round-trip

```
# On the proposing side (cool-workflow):
cw ledger propose --from cool-workflow --to chime \
  --title "Add retry" --rationale "flaky net" \
  --files src/net.ts --diff "$(git diff)" > proposal.json

# The operator carries proposal.json to the chime session, which checks it:
cw ledger verify --file proposal.json && echo "safe to open a PR"

# The reviewing side hands a verdict back:
cw ledger review --from chime --to cool-workflow \
  --target ldg-1de7c92172af1871 --verdict approved \
  --findings "tests pass,scope ok" > verdict.json
cw ledger verify --file verdict.json
```

## Roadmap

Stage 1 shipped the CLI verbs (human relay). Stage 2 adds the MCP surface and
the git-as-ledger transport (`cw ledger list` over a shared repo). Still open:
the operator creates the shared handoff repo and scopes both agent environments
into it. See [handoff-ledger](designs/handoff-ledger.md).
