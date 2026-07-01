# Cross-Agent Handoff Ledger

CW adds `cw ledger` — a way for two agents scoped to two separate repos to hand
each other a CHANGE PROPOSAL or a REVIEW VERDICT as verifiable data, not chat.
One side proposes or reviews; the other side verifies the entry fail-closed and
turns a proposal into a real pull request. Design notes:
[handoff-ledger](designs/handoff-ledger.md).

This is stage 1 (human-relay transport): each entry is a self-contained JSON
object that carries its own sha256 content digest. The producing side prints
one; the operator carries it to the other session; the consuming side runs
`cw ledger verify` before acting. A tampered or malformed entry is refused with
a non-zero exit, so `cw ledger verify <file> && open-pr` can never proceed on a
lie.

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
```

All three write JSON to stdout (stdout is data). `propose` and `review` print a
sealed entry; `verify` prints a check report.

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

Stage 1 is CLI-only, human-relay. Later cycles add the MCP surface (so an agent
can call it in-process) and the git-as-ledger transport (entries committed to a
shared handoff repo both agents are scoped to). Each lands as its own reviewed
cycle with tests. See [handoff-ledger](designs/handoff-ledger.md).
