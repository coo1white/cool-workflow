# Trust Audit Anchor

CW v0.2.1 adds the Trust Audit Anchor: a way to see when the END of a run's
trust-audit log was cut off. The hash chain in `audit/events.jsonl` lets
`cw audit verify` see an edited event, a removed middle event, a bad line, and
a mixed-era forgery. But one tamper shape gets past a pure chain walk: take
the last N lines off the file, and what is left is a shorter but fully
consistent chain — verify stays green. The anchor closes that hole, and it
does so without changing any old output byte.

## Design Discipline

- Mechanism, not policy: the kernel gives you two small parts — a read of the
  chain head, and a check against a head you saved earlier. WHEN you save a
  head (after a run, before you publish, at export time) is your policy.
- Fail-closed: a saved head that is not on the chain, or an event count that
  comes up short, makes verify exit non-zero with the distinct check code
  `trust-audit-truncated`. A bad `--expect-head` / `--expect-count` value is
  an error, never a check silently made weaker.
- POLA: with no anchor flags, `cw audit verify` output is byte-for-byte what
  it was before this feature (no `anchor` key, same checks, same exit rules).
- Reuse: the anchor rides on the existing eventHash chain — no new file, no
  new state, no new hash form. `cw audit head` is a read-only projection.
- Parity: `audit.head` is on both front doors (`cw audit head` and the MCP
  tool `cw_audit_head`); the anchor args are on both `cw audit verify` and
  `cw_audit_verify` (`expectHead` / `expectCount`).

## CLI

```text
node dist/cli.js audit head <run-id>
# -> { "schemaVersion": 1, "runId": "...", "eventCount": 87,
#      "headHash": "sha256:..." }

node dist/cli.js audit verify <run-id> --expect-head <hash> --expect-count <n>
# green: verified true, "anchor": { ..., "satisfied": true }, exit 0
# cut tail: verified false, checks carry trust-audit-truncated, exit 1
```

The head is the hash the NEXT appended event will link from: the last event's
`eventHash`, or the run's genesis hash when the log is empty. Save the pair
`{headHash, eventCount}` somewhere the log's writer cannot reach — a CI
variable, a note in your PR, the output of `cw run export` (the export
manifest hashes the event log bytes, so an export IS an anchor in file form).

## How the check works

`verifyTrustAudit` walks the chain as before, and keeps the trail of head
hashes it saw (genesis, then the hash after each event). With an anchor:

- `expectCount`: the walked log must have at least that many events. Fewer =
  `trust-audit-truncated` (check name `anchor-count`).
- `expectHead`: the saved head must be ON the trail. A log that was cut and
  then padded back with new events reaches the old count, but the new events
  link from an earlier point — the old head is no longer on the trail, so
  this still fails (check name `anchor-head`).

## Compatibility

Trust Audit Anchor is introduced in CW v0.2.1. Fields are additive and
optional; older run state loads unchanged. A plain `cw audit verify` keeps
its exact old output. The `anchor` key appears in the JSON only when the
caller passed an anchor flag.

## See Also

security-trust-hardening(7), cli-mcp-parity(7), report-verifiable-bundle(7)

0.2.2
