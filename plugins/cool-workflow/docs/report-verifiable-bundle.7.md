# Verifiable Report Bundle

A bundle is one file, `<run-id>.cwrun.json`, that holds a run's report, its
results, its receipts and its telemetry ledger, with a digest for each
file. Anyone can check it offline with one command: no source repo, no
`.cw` tree, no key handed over on the side.

## Commands

```
cw report bundle <run-id> [--output FILE] [--with-trust-key PEM] [--extract-report FILE]
cw report verify-bundle <bundle> [--pubkey PEM] [--strict-signatures] [--require-signatures] [--extract-report FILE] [--json]
```

- `cw report bundle` writes the bundle (default: `<run-id>.cwrun.json` in the
  folder you ran `cw` in) and then verifies it at once. It exits 1 when the
  bundle it made would not verify, so a bad bundle is never handed on.
  `--with-trust-key` embeds an ed25519 PUBLIC key (default:
  `CW_AGENT_ATTEST_PUBKEY`); CW never exports a private key.
- `cw report verify-bundle` checks a bundle and exits 1 whenever `ok` is
  false, so `cw report verify-bundle <file> && ship` cannot pass on a forgery.
  It writes nothing except the `--extract-report` file, which must lie under
  the current folder.

## What verify-bundle checks

1. **Archive bytes.** Every file's sha256 and the manifest digest match.
2. **Telemetry ledger.** `telemetry.json` is the run's telemetry ledger: one
   record per agent hop, each hash-chained to the one before. The chain is
   recomputed; a broken link fails. A bundle with no `telemetry.json`
   passes this check.
3. **Signatures.** Each signed telemetry record is re-checked with ed25519.
   Key precedence: `--pubkey` > the bundle's embedded key >
   `CW_AGENT_ATTEST_PUBKEY`. A `--pubkey` that differs from the embedded key
   fails (`trust-key-mismatch`).
4. **Report ⇄ result ⇄ signature.** For each record whose signature covers a
   result digest, the result file must hash to that digest, and `report.md`
   must embed the result under its own `### <taskId>` section. Editing the
   report, the result, or both to one consistent lie fails.
5. **Receipts.** Each `receipts/<id>.json` must be intact and must record
   exit 0.

`trustLevel` is `"signed"` only when at least one result-covering signature
re-verified, none failed, and check 4 held. Otherwise it is `"unsigned"`.
With no key, signatures are not checked and the intact chain still decides
`ok`; `--strict-signatures` refuses that case, and `--require-signatures`
refuses any `"unsigned"` bundle.

## Scope

The guarantee is forward only: each signed finding is in the report,
unaltered. It does not say the report holds only signed findings. CW holds
no key to sign the rendered report, and the ledger chain can be recomputed
by someone with local write access, who could drop a signed finding and
re-chain. Read a green verdict as "the signed findings are present and
unaltered", nothing more. See the [Trust Model](trust-model.md).

## --json

`cw report bundle --json` prints `schemaVersion, runId, archivePath,
trustKeyEmbedded, verification, ok` (plus `reportExtractedTo` when asked).
`verification` and `cw report verify-bundle --json` print `schemaVersion,
archivePath, runId, ok, archiveOk, telemetryVerified, trustKeySource,
signatureKeyProvided, signaturesChecked, signaturesReverified,
signaturesFailed, trustLevel, reportFindingsVerified, failedChecks` (plus
`reportExtractedTo`).

See also [Security / Trust Hardening](security-trust-hardening.7.md).
