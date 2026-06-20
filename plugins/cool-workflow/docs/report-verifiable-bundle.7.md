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

The MECHANISM is three small additions to the existing export/verify path:

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

3. `cw report bundle <run>` is the PRODUCER counterpart: it exports a sealed
   bundle (step 1) and then immediately self-verifies it (step 2), returning the
   archive path and the verification verdict together. It fails closed — a solo
   operator never hands off a report whose bundle does not verify (for example, no
   trust key configured under `--strict-signatures`). `--extract-report` also
   writes the human-readable `report.md` next to the bundle so the shippable pair
   is produced in one command. It is pure composition; it spawns nothing.

`cw quickstart <app> --bundle [--with-trust-key K]` folds step 3 into the
one-command entry: after the drive reaches `status: complete`, it seals the run
with `reportBundle` (anchored to the run's own repo) and returns the verdict as
`result.bundle`. It is gated on completion — a blocked/partial run is **never**
sealed (the operator gets a `hint`, not a half-shipped artifact) — and the CLI
exits non-zero when `result.bundle.ok` is false. `quickstart` stays `cli-only`;
MCP hosts compose `cw_run_drive_step` + `cw_report_bundle` for the same outcome.

Because the README headline runs quickstart cross-directory (your shell cwd is not
the `--repo`), the run is resolved from its own repo, but the bundle's OUTPUT —
the `.cwrun.json` and any `--extract-report` — lands in **your cwd**, not the
analyzed repo (so `cw quickstart … --bundle --extract-report out.md && send out.md`
works and the repo's working tree is never polluted). `result.bundle.archivePath`
and `result.bundle.reportExtractedTo` report the absolute paths.

The POLICY is fail-closed and self-describing:

- Key precedence is **bundle > `--pubkey` > `CW_AGENT_ATTEST_PUBKEY`**, so a bundle
  with an embedded key verifies the same on any machine; the override/env only
  apply when the bundle omits a key.
- `ok` is true only when the archive bytes, the telemetry chain, and the
  trust-audit chain all verify, no attested signature failed re-verification, AND
  the report ⇄ result cross-check holds.
- **Report ⇄ result ⇄ signature cross-check** (`reportFindingsVerified`) — the
  FORWARD guarantee: every SIGNED finding is present in the report and unaltered.
  Driven by the signature-verified, result-COVERING ledger records (not the archive's
  `run.tasks` list, which is bound by nothing). For each such record: (1) its
  `resultDigest` is anchored by the executor's ed25519 signature — a usage-only
  (4-field) signature is excluded, so an injected digest is never trusted
  (`coversResult` required); (2) the matching completed task's **restored result file
  must hash to that signed digest** (`result-missing` / `result-digest-mismatch:<task>`
  otherwise) — so an edited, missing, dropped, or substituted result is caught because
  the signed digest does not move; (3) `report.md` embeds the result at the task's own
  `### <taskId>` section, body-first (`report-result-mismatch:<task>` otherwise) — so
  an edited report, or a decoy copy buried elsewhere, fails. Editing the report breaks
  (3); editing the result breaks (2); editing **both** to one consistent lie still
  breaks (2). Any failure ⇒ `report-findings`, `ok:false`.
- **Scope (read this).** The guarantee is FORWARD only: each of the agent's *signed*
  findings is in the report unaltered. It does **not** assert the report contains
  *only* signed findings. CW holds no key to sign the rendered report (it delegates;
  it never signs), and the telemetry ledger chain is self-recomputable, so the report
  MAY carry additional **unsigned content** — prose, an executive summary, ordering,
  or extra sections — and a determined local re-chainer can **omit** a signed finding
  (a shorter, self-consistent history). Verify the findings you act on against the
  signed results; do not read more into a green verdict than "the signed findings are
  present and unaltered." Closing report-completeness fully needs an external
  append-only anchor (declined by design here); see the [Trust Model](trust-model.md).
- **Trust level** (`trustLevel`): `"signed"` means the agent's signed findings are
  present and unaltered — at least one **result-covering** signature re-verified
  against a key, none failed, and the forward cross-check held. A usage-only (4-field)
  signature, an unverifiable one (no key), or a tampered signed finding all yield
  `"unsigned"`. It attests the signed findings, **not** report exhaustiveness.
- A bundle with attested telemetry but no available key DEGRADES by default
  (`signatureKeyProvided: false`, the intact chain still decides `ok`).
  `--strict-signatures` refuses such a bundle instead. `--require-signatures` is
  stronger: it refuses any bundle whose `trustLevel` is `"unsigned"` (closing the
  fail-open where an unsigned-but-intact bundle returned `ok: true`).
- `--extract-report <path>` writes the bundle's `report.md` out for a human to
  read alongside the machine verdict. If extraction is requested but the bundle
  has no `report.md` (or the write fails), that is a failure, not a silent no-op:
  a `extract-report` / `report-md-unavailable` check is recorded and `ok` is
  false — so a producer never ships a green verdict with no report attached.

## Fail closed

`cw report verify-bundle` exits non-zero whenever `ok` is false, so
`cw report verify-bundle <file> && ship` cannot pass on a forgery. This holds even
for a telemetry chain forged so that every archive file digest still matches: the
file-digest layer (`inspect-archive`) would wave it through, but the embedded hash
chain breaks at the next record and the signature re-verification rejects inflated
usage. A missing, unreadable, or schema-unsupported bundle is also `ok: false`.

## Usage

```
# See it in 30 seconds, hermetic — no agent, no API key, no repo:
npx cool-workflow demo bundle
#   -> builds a sealed bundle, forges it two ways, and shows verify-bundle
#      catching both offline with only the embedded public key.

# Run the review AND get a shippable, client-verifiable bundle from ONE command:
cw quickstart architecture-review --repo . --question "What are the risks?" \
  --agent-command "claude -p" --bundle --with-trust-key ./trust-pub.pem
#   -> after the drive COMPLETES, the run is sealed into a self-verified bundle and
#      the verdict is folded into the quickstart JSON (result.bundle). Exits non-zero
#      if that bundle would not verify. A run that did not complete is never sealed.

# Produce-and-prove from an existing run: export sealed + self-verify + emit the report.
cw report bundle <run-id> --with-trust-key ./trust-pub.pem \
  --output report.cwrun.json --extract-report report.md
#   -> exits non-zero if the produced bundle would not verify (don't ship it).

# Or the two steps separately:
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
