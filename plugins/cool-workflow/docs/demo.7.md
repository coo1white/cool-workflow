# DEMO(7)

## NAME

`cw demo` — prove CW trust guarantees with one command

## SYNOPSIS

```text
node dist/cli.js demo tamper [--json]
node dist/cli.js demo bundle [--json]
```

## DESCRIPTION

`cw demo` is a self-contained proof of CW's central trust claims. It works
without an agent and without a network connection. Every run is hermetic
(fully self-contained) — it builds its own state, tampers with it in known
ways, and checks that the tampering is caught. Nothing is read from or
written to the real file system outside a short-term temp directory.

No agent is needed; both demos work when the setup has no agent at all.

## DEMO TAMPER

`cw demo tamper` proves that CW catches forged records offline — with only a
public key, no server. It:

1. Builds a signed telemetry ledger with three hops.
2. Tampers with it in three layers:
   - **Hashes**: Changes a record's data and recomputes the record hash to hide
     it. The hash chain breaks — the next record's `previousHash` does not
     match, so the chain is no longer valid.
   - **Signatures**: Inflates token counts and keeps the old signature. The
     signature does not match the new data — the verifier catches it.
   - **Findings**: Edits a signed finding (severity HIGH → LOW) after it was
     signed by the agent. The signature check on the ed25519 envelope fails
     because the signed bytes changed.
3. Verifies each tampered ledger with only the public key.

If all three forgeries are caught, the proof holds and the demo exits 0.
If any tamper goes undetected, the demo exits 1 — this is a regression in
the integrity guarantee.

## DEMO BUNDLE

`cw demo bundle` proves that exported report bundles are verifiable offline. It:

1. Builds a full telemetry chain, signs it, and exports a sealed portable
   bundle (archive bytes + telemetry chain + trust-audit chain + embedded
   public key).
2. Tampers with the bundle in two ways:
   - **Telemetry chain**: Forges a record in the chain. The archive's file
     digests stay valid (the archive was built from the tampered bytes), but
     `report verify-bundle` re-checks the chain and catches it.
   - **Signature + usage**: Inflates token counts and reseals. The signature
     check and hash chain both break.
3. Verifies each tampered bundle with `report verify-bundle`.

If all forgeries are caught with only the bundle's own public key, the proof
holds. No repo, no server, no key handed over.

## EXIT CODES

| Exit | Meaning |
| --- | --- |
| 0 | All tampering was caught — trust guarantees hold |
| 1 | A tamper went undetected — integrity guarantee regression |

## FILES

```text
src/telemetry-demo.ts
```

## SEE ALSO

report-verifiable-bundle.7.md — offline bundle verification in detail
trust-model.md — the trust model and its limits
security-trust-hardening.7.md — security and trust hardening
