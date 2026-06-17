# Verifiable Report Bundle

CW v0.1.85 adds the Verifiable Report Bundle: a way to hand someone a run's report
that they can check themselves, OFFLINE, with one command — no source repo, no
pre-existing `.cw` tree, and no key passed on the side.

Before this, a run could be exported to a portable `<id>.cwrun.json` archive
([Run Registry / Control Plane](run-registry-control-plane.7.md)) and its bytes
re-proven with `cw run inspect-archive`. But two things stopped a stranger from
fully verifying it:

- The ed25519 PUBLIC key that re-checks the signed telemetry came only from
  `--pubkey` or the `CW_AGENT_ATTEST_PUBKEY` environment variable — it did not
  travel with the archive.
- `inspect-archive` proves the archive's own file digests, not the telemetry hash
  chain or the signatures. Re-proving those meant `cw run import` into a real
  `.cw` tree and then `cw run verify-import` — too much to ask of a recipient.

The Verifiable Report Bundle closes both gaps without a new archive format.

## Mechanism vs Policy

The MECHANISM is two small additions to the existing export/verify path:

1. `cw run export <run> --with-trust-key <pem-or-path>` embeds the operator's
   ed25519 PUBLIC key into the archive under a new optional `trust` block
   (`{ publicKeyPem, algorithm: "ed25519" }`). Only a public key is ever embedded;
   CW never exports a private key. The flag defaults to `CW_AGENT_ATTEST_PUBKEY`,
   so one configured key both attests at record-time and travels with the export.
   A raw inline PEM begins with `-----`, which the CLI parses as a flag — so the
   CLI form takes a key FILE PATH; an inline PEM is accepted programmatically and
   via the environment variable.

2. `cw report verify-bundle <bundle>` verifies the bundle SELF-CONTAINED and
   OFFLINE. It reuses the existing verifiers end to end: `inspectArchive` for the
   archive bytes, then a restore into a throwaway temp dir (auto-removed) so
   `verifyImportedRun` re-proves the telemetry hash chain and the trust-audit
   chain, then `verifyTelemetrySignatures` re-runs ed25519 over each attested hop
   using the key the bundle carries. It writes nothing to any registry.

The POLICY is fail-closed and self-describing:

- Key precedence is **bundle > `--pubkey` > `CW_AGENT_ATTEST_PUBKEY`**, so a bundle
  with an embedded key verifies the same on any machine; the override/env only
  apply when the bundle omits a key.
- `ok` is true only when the archive bytes, the telemetry chain, and the
  trust-audit chain all verify AND no attested signature failed re-verification.
- A bundle with attested telemetry but no available key DEGRADES by default
  (`signatureKeyProvided: false`, the intact chain still decides `ok`).
  `--strict-signatures` refuses such a bundle instead.
- `--extract-report <path>` writes the bundle's `report.md` out for a human to
  read alongside the machine verdict.

## Fail closed

`cw report verify-bundle` exits non-zero whenever `ok` is false, so
`cw report verify-bundle <file> && ship` cannot pass on a forgery. This holds even
for a telemetry chain forged so that every archive file digest still matches: the
file-digest layer (`inspect-archive`) would wave it through, but the embedded hash
chain breaks at the next record and the signature re-verification rejects inflated
usage. A missing, unreadable, or schema-unsupported bundle is also `ok: false`.

## Usage

```
# Export a run sealed with the operator's public key (key file on the CLI).
cw run export <run-id> --with-trust-key ./trust-pub.pem --output report.cwrun.json

# Anyone, anywhere, offline — no repo, no key handed over, no install beyond npx:
npx cool-workflow report verify-bundle report.cwrun.json
npx cool-workflow report verify-bundle report.cwrun.json --extract-report report.md
npx cool-workflow report verify-bundle report.cwrun.json --strict-signatures --json
```

The same capability is on the MCP surface as `cw_report_verify_bundle`, so an agent
host re-verifies a bundle through the identical core entry.

See also [Security / Trust Hardening](security-trust-hardening.7.md) and the trust
model's honest ceiling: a signature proves non-repudiable attribution to the key
holder, not ground-truth measurement.
