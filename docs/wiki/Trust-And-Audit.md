# Trust And Audit

CW's trust story is intentionally narrow: it proves record integrity and signed
attribution where configured. It does not prove that an executor's original
self-report was true.

## Try The Demo

```bash
npx cool-workflow demo tamper
```

The demo builds a signed ledger and forges it in three ways:

| Layer | Forgery | Expected result |
| --- | --- | --- |
| Ledger | Change a recorded verdict and recompute that record hash. | The downstream hash chain breaks. |
| Signature | Inflate reported tokens and reuse the old ed25519 signature. | Signature verification fails. |
| Result | Edit a signed finding (severity HIGH → LOW) after signing; CW re-derives sha256(result) so the signature no longer joins the payload. | Signature verification fails. |

For automation:

```bash
npx cool-workflow demo tamper --json
```

The JSON includes `proven: true` when all three tamper cases are caught.

## Verify A Real Run

```bash
cw telemetry verify <run-id>
cw telemetry verify <run-id> --pubkey <public.pem>
cw audit verify <run-id>
```

| Command | What it checks |
| --- | --- |
| `cw telemetry verify <run-id>` | Recomputes the telemetry ledger chain and record hashes. |
| `cw telemetry verify <run-id> --pubkey <public.pem>` | Also re-runs ed25519 attribution checks for attested usage. |
| `cw audit verify <run-id>` | Re-proves the trust-audit event chain for sandbox, policy, and commit-gate decisions. |

## What A Green Check Means

A passing telemetry verification can support these claims:

- the recorded ledger is internally consistent,
- recorded attested usage was signed by the holder of the configured private key,
- the signature is bound to the recorded run, task, and prompt digest,
- the verification can be re-run offline with the public key.

It does not prove:

- the reported usage number was true at the source,
- the signer was honest,
- a single local party supplied independent third-party attestation,
- the agent output was correct, secure, or useful.

## Fail-Closed States

CW uses explicit states instead of silent promotion:

| State | Meaning |
| --- | --- |
| `attested` | Usage was signed and verified against the configured public key. |
| `unattested` | Usage exists but cannot be verified as signed by the expected key. |
| `absent` | No usage was reported. |
| `blocked` | Work could not proceed, for example because no agent is configured. |
| `parked` | A worker failed or retried to a stop point rather than being fabricated. |

## The Single-Party Limit

If the same operator runs CW, controls the machine, and holds the only signing
key, a green result proves internal consistency and attribution to that key. It
does not create an independent second party.

For stronger assurance, pair CW with an external anchor, a separate signer, or a
separate executor that the local operator cannot rewrite.

## Source Docs

The full trust statement lives in:

- `plugins/cool-workflow/docs/trust-model.md`
- `plugins/cool-workflow/docs/security-trust-hardening.7.md`
- `plugins/cool-workflow/docs/multi-agent-trust-policy-audit.7.md`
