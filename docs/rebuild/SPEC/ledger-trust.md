# ledger-trust

## Scope (one line)

The trust layer of CW: the cross-agent handoff ledger (`src/ledger.ts`), the hash-chained telemetry ledger (`src/telemetry-ledger.ts`), the ed25519 usage/result attestation (`src/telemetry-attestation.ts`), the hash-chained trust-audit event log (`src/trust-audit.ts`), evidence grounding and confidence (`src/evidence-grounding.ts`), the evidence adoption reasoning chain (`src/evidence-reasoning.ts`), the result/evidence gates (`src/verifier.ts`, `src/gates.ts`), and the tamper/bundle demos (`src/telemetry-demo.ts`). One level out: `src/run-export.ts` (`verifyReportBundle`), `src/cli/handlers/ledger.ts`, `src/cli/handlers/maintenance.ts`, `src/cli/handlers/operator.ts`, `src/cli/handlers/audit.ts`, `src/capability-core.ts`, `src/mcp/tool-call.ts`, `src/worker-accept/telemetry-ledger.ts`.

## The signing model (read this first)

- The AGENT (the executor) signs. It has the ed25519 PRIVATE key. It signs a canonical payload that binds `{usage, runId, taskId, promptDigest}` and, when it covers the result, `resultDigest` (`src/telemetry-attestation.ts:63-78,185-193`).
- CW VERIFIES. It holds ONLY the operator-given PUBLIC key. It can verify but can not forge, and it never calls a model to measure usage itself (`src/telemetry-attestation.ts:9-24`).
- `signTelemetry` is an executor-side helper. The CW runtime never calls it; it is kept in the same file only so signer and verifier share one canonical form (`src/telemetry-attestation.ts:179-193`).
- Honest ceiling: a good signature proves the usage came from the keyholder, unchanged in transit. It does not prove the number is true. A keyholder can sign a lie, but the lie is then bound to its signer (`src/telemetry-attestation.ts:16-22`).

## Public surface

### CLI: `cw ledger` (src/cli/handlers/ledger.ts)

| Verb | Takes | Does | Returns |
| --- | --- | --- | --- |
| `cw ledger propose --from <a> --to <b> --title <t> --rationale <r> [--files a,b] [--diff <patch>]` | required string flags; `--files` comma list; `--diff` a unified patch | builds a sealed proposal entry with `computeLedgerDigest`; the diff bytes are passed through with NO trim (a trimmed patch is corrupt) | sealed proposal JSON on stdout, exit 0 (`src/cli/handlers/ledger.ts:31-47`) |
| `cw ledger review --from <a> --to <b> --target <id> --verdict approved\|rejected [--findings "a,b"]` | `--verdict` is upper-cased; any other value throws `--verdict must be "approved" or "rejected".` | builds a sealed review entry | sealed review JSON, exit 0 (`src/cli/handlers/ledger.ts:48-63`) |
| `cw ledger verify [--file <path>]` | a file path, else the entry is read from stdin (fd `0`) | fail-closed check of one entry | `LedgerVerifyResult` JSON; exit 1 when `ok:false`; non-JSON input prints a structured `ledger-bad-json` refusal and exits 1 (`src/cli/handlers/ledger.ts:64-88`) |
| `cw ledger apply [--file <path>]` | same input forms as `verify` | verifies FIRST, then lets the `suggestedDiff` out — only when `ok:true` | `LedgerApplyResult` JSON; exit 1 when `ok:false` (`src/cli/handlers/ledger.ts:89-112`) |
| `cw ledger list --dir <d> [--dir <d2> ...]` | `--dir` may be given more than once | one dir: read + verify every `*.json` in it; 2+ dirs: union-verify mirrors | `LedgerListResult` or `LedgerUnionResult` JSON; exit 1 when `allOk:false` (`src/cli/handlers/ledger.ts:113-129`) |

Any other subcommand throws `Usage: cw ledger propose|review|verify|apply|list [options]` (`src/cli/handlers/ledger.ts:131`).

### CLI: `cw telemetry verify` (src/cli/handlers/maintenance.ts:56-73)

`cw telemetry verify <run-id> [--pubkey <pem-or-path>] [--json]`

- Re-proves the run's `telemetry.json` chain: `prevHash` linkage plus an independent recompute of every `recordHash` (`src/capability-core.ts:1181-1215`, `src/telemetry-ledger.ts:184-224`).
- With `--pubkey` (or env `CW_AGENT_ATTEST_PUBKEY`): also RE-RUNS the ed25519 check over each record the ledger marks `attested`, using the raw `reportedUsage` stored on the record (`src/capability-core.ts:1186-1196`, `src/telemetry-attestation.ts:257-318`).
- A supplied key that resolves to nothing adds a failed check `{name:"signature-key", code:"telemetry-pubkey-unreadable"}` and `verified` goes false (`src/capability-core.ts:1193-1195`).
- Exit 1 when `verified:false`. An absent ledger is `present:false` / `verified:true` and exits 0 (`src/cli/handlers/maintenance.ts:64-68`).
- Other subcommands throw `Usage: cw telemetry verify <run-id> [--pubkey <pem-or-path>] [--json]` (`src/cli/handlers/maintenance.ts:71`).

### CLI: `cw audit verify` (src/cli/handlers/audit.ts:19-30)

`cw audit verify <run-id>` — re-proves the trust-audit event chain (`verifyTrustAudit`), prints JSON `{schemaVersion:1, runId, present, verified, eventCount, chained, unchained, corruptLines, failedChecks}` (`src/capability-core.ts:1224-1250`), exit 1 when `verified:false`. An absent/empty chain is `verified:true`, exit 0. `cw audit summary` embeds the same `integrity` field but always exits 0 (a reader, not a gate).

### CLI: `cw demo tamper|bundle [--json]` (src/cli/handlers/maintenance.ts:75-100)

- `cw demo tamper` runs `runTamperDemo()`: hermetic, ephemeral ed25519 keypair, private tmpdir, no network, no model. Exit 1 when `proven:false`.
- `cw demo bundle` runs `runBundleDemo()`: same discipline for the portable bundle. Exit 1 when `proven:false`.
- Other subcommands throw `Usage: cw demo tamper|bundle [--json]`.

### CLI: `cw report verify-bundle` and `cw report bundle` (src/cli/handlers/operator.ts:19-41)

- `cw report verify-bundle <path> [--pubkey <pem-or-path>] [--extract-report <path>] [--strict-signatures] [--require-signatures]` — offline, self-contained verify of a `.cwrun.json` bundle. Always prints the `ReportBundleVerification` JSON. Exit 1 when `ok:false`. The path may come as the positional or `--archive`/`--path`/`--file`/`--bundle` (`src/capability-core.ts:421-433`).
- `cw report bundle <run-id> [--with-trust-key <pem-or-path>] [--output <p>] [--extract-report <p>] [--strict-signatures] [--require-signatures]` — export sealed, then self-verify at once. Prints `ReportBundleResult` JSON. Exit 1 when `ok:false` (`src/capability-core.ts:396-415`).

### MCP tools (src/mcp/tool-definitions.ts, src/mcp/tool-call.ts)

| Tool | Maps to | Note |
| --- | --- | --- |
| `cw_ledger_propose` | `buildLedgerProposal` | `files` is a comma string; `createdAt` is now (`src/mcp/tool-call.ts:351-360`) |
| `cw_ledger_review` | `buildLedgerReview` | same verdict check and message as the CLI (`src/mcp/tool-call.ts:361-372`) |
| `cw_ledger_verify` | `verifyLedgerEntry(args.entry)` | takes the entry OBJECT (`src/mcp/tool-call.ts:373-374`) |
| `cw_ledger_apply` | `applyLedgerProposal(args.entry)` | (`src/mcp/tool-call.ts:375-376`) |
| `cw_ledger_list` | `listLedgerEntries` / `unionLedgerEntries` | `dirs` array of 2+ takes the union path (`src/mcp/tool-call.ts:377-382`) |
| `cw_telemetry_verify` | `telemetryVerify` | takes `runId`, optional `pubkey` (`src/mcp/tool-definitions.ts:1002-1006`) |
| `cw_audit_verify` | `auditVerify` | (`src/mcp/tool-definitions.ts:399`) |
| `cw_report_verify_bundle` | `runVerifyReportBundle` | (`src/mcp/tool-definitions.ts:871-880`) |
| `cw_report_bundle` | `reportBundle` | (`src/mcp/tool-definitions.ts:881-887`) |

`demo` is CLI-only (`src/capability-core.ts:1252-1262` comment).

### Env vars

| Var | Effect |
| --- | --- |
| `CW_AGENT_ATTEST_PUBKEY` | The operator trust PUBLIC key (inline PEM or a `.pem` path). Used at record time (`src/agent-config.ts:105`), at `telemetry verify` time (`src/capability-core.ts:1191`), as the default seal key for `run export` / `report bundle` (`src/capability-core.ts:291`), and as the last-place key for `verify-bundle` (`src/run-export.ts:484-491`). |
| `CW_REQUIRE_RESOLVABLE_EVIDENCE` | Default ON (unset/empty = true): file-style evidence locators must exist on disk. `0`/`false`/`no`/`off` = shape-only check. A value with `url` in it also turns on URL-reach checks (`src/evidence-grounding.ts:56-66`). |
| `CW_REQUIRE_ARCHIVE_INTEGRITY` | `1`/`true`/`yes`/`on`: refuse an archive whose top-level `integrity` block is absent, at import and at inspect (`src/run-export.ts:361-362,831-833`). |

### Exported functions (kernel, callable by other modules)

- `src/ledger.ts`: `computeLedgerDigest`, `buildLedgerProposal`, `buildLedgerReview`, `verifyLedgerEntry`, `applyLedgerProposal`, `listLedgerEntries`, `unionLedgerEntries`, `resolveLedgerInbox`. Pure except the two directory readers; no run state, no network.
- `src/telemetry-ledger.ts`: `telemetryLedgerPath`, `loadTelemetryLedger` (throws `TelemetryLedgerCorruptError` on a corrupt file), `genesisPrevHash`, `computeRecordHash`, `reportedUsageDigest`, `appendTelemetryAttestation`, `verifyTelemetryLedger`, const `TELEMETRY_LEDGER_SCHEMA_VERSION = 1`.
- `src/telemetry-attestation.ts`: `stableStringify`, `canonicalTelemetryPayload`, `normalizeReportedUsage`, `verifyTelemetryAttestation`, `resolveTrustPublicKey`, `signTelemetry` (executor-side), `verifyTelemetrySignatures`.
- `src/trust-audit.ts`: `trustAuditGenesis`, `verifyTrustAudit`, `ensureTrustAudit`, `recordTrustAuditEvent`, `recordSandboxPathDecision`, `recordSandboxPolicyDecision`, `recordHostAttestation`, `setAuditEventCache`, `clearAuditEventCache`, `listTrustAuditEvents`, `searchAuditEvents`, `summarizeTrustAudit`, `refreshTrustAudit`, `workerTrustAudit`, `normalizeEvidence`, `evidenceProvenance`, `validateAcceptanceRationale`, `buildAcceptanceRationale`, const `CORRELATION_ID_FIELDS` (19 pass-through id fields, `src/trust-audit.ts:226-246`), const `TRUST_AUDIT_SCHEMA_VERSION = 1`.
- `src/evidence-grounding.ts`: `isGroundedEvidence`, `hasGroundedEvidence`, `requireResolvableEvidence`, `requireUrlReachability`, `resolveEvidenceLocator`, `unresolvedFileEvidence`, `computeEvidenceConfidence`, `computeEvidenceConfidenceTiers`, `maxEvidenceConfidence`, `extractEvidenceContent`.
- `src/evidence-reasoning.ts`: `buildEvidenceReasoningReport`, `reasoningCriticalNodeIds`, `reasoningDir`, `refreshEvidenceReasoning`, `loadEvidenceReasoningIndex`, `showEvidenceReasoning`, `normalizeEvidenceReasoningForEval`, `formatEvidenceReasoningReport`, const `EVIDENCE_REASONING_SCHEMA_VERSION = 1`.
- `src/verifier.ts`: `assertTaskCanComplete`, `parseResultEnvelope`, `taskRequiresEvidence`, `validateResultEnvelope`, `validateRunGates`.
- `src/gates.ts`: `emptyCaptureWarning`, `sandboxProfileForCandidate`.
- `src/telemetry-demo.ts`: `runTamperDemo`, `runBundleDemo`, `formatTamperDemo`, `formatBundleDemo`, `formatTelemetryVerify`.

## Exact outputs

### Hash form — two different helpers

- `sha256(value)` from `src/execution-backend/util.ts:13-15` gives the PREFIXED form: `` `sha256:${hex}` ``. Used by both hash chains, `promptDigest`, `resultDigest`, `reportedUsageDigest`, and the ledger digest.
- `sha256Bytes` in `src/run-export.ts:922-924` gives BARE hex (no prefix). Used for archive file digests only. Do not mix the two.

### Handoff ledger entry (src/ledger.ts)

Sealed proposal (field set exactly):

```json
{
  "kind": "proposal",
  "schemaVersion": 1,
  "from": "cool-workflow",
  "to": "chime",
  "title": "Add retry",
  "rationale": "flaky net",
  "targetFiles": ["src/net.ts"],
  "suggestedDiff": "@@ ... @@",
  "createdAt": "<iso>",
  "id": "ldg-<first 16 hex of digest>",
  "digest": "sha256:<64 hex>"
}
```

A review has `target`, `verdict` (`APPROVED` | `REJECTED`), `findings` (string list) in place of `title`/`rationale`/`targetFiles`/`suggestedDiff` (`src/ledger.ts:121-148`).

- `digest` = sha256 over `stableStringify` (object keys sorted at every level) of every field EXCEPT `id` and `digest` (`src/ledger.ts:90-108`).
- `id` = `ldg-` + first 16 hex chars of the digest (`src/ledger.ts:110-114`).
- A missing `suggestedDiff` on build becomes the empty string `""` (`src/ledger.ts:130`).

`verifyLedgerEntry` result shape:

```json
{
  "ok": false,
  "id": "<string or null>",
  "kind": "<string or null>",
  "checks": [{ "name": "structure", "pass": true }, { "name": "digest", "pass": false, "code": "ledger-digest-mismatch", "detail": "..." }],
  "failedChecks": [{ "name": "digest", "code": "ledger-digest-mismatch", "detail": "..." }]
}
```

Check names run in this order and stop at the first failure: `structure`, `kind`, `schema`, `digest-present`, `fields` (with a `verdict` check inside for reviews), `digest`, `id` (`src/ledger.ts:159-215`). Failure codes, exact:

| Code | When |
| --- | --- |
| `ledger-not-object` | entry is not a JSON object (`src/ledger.ts:172`) |
| `ledger-unknown-kind` | `kind` not `proposal`/`review` (`src/ledger.ts:176`) |
| `ledger-bad-schema` | `schemaVersion` is not `1` (`src/ledger.ts:179`) |
| `ledger-missing-digest` | `digest` absent or not a string (`src/ledger.ts:182`) |
| `ledger-missing-field` | a required content field is absent (`src/ledger.ts:188`) |
| `ledger-bad-verdict` | review `verdict` not `APPROVED`/`REJECTED` (`src/ledger.ts:191-193`) |
| `ledger-digest-mismatch` | stored digest != recomputed; detail is `` `stored digest does not match content (recomputed ${recomputed})` `` (`src/ledger.ts:196-199`) |
| `ledger-id-mismatch` | `id` is not `deriveId(digest)` (`src/ledger.ts:208-211`) |
| `ledger-bad-json` | CLI-side only: input bytes are not JSON (`src/cli/handlers/ledger.ts:78,102`) |

`applyLedgerProposal` result: `{ ok, id, kind, diff, failedChecks }`. `diff` is non-null ONLY when `ok:true`. Extra codes: `ledger-not-a-proposal` (entry is a review; detail `apply expects a proposal entry, not a review`), `ledger-empty-diff` (detail `proposal carries no suggestedDiff to apply`) (`src/ledger.ts:233-247`).

`listLedgerEntries` result (single dir):

```json
{
  "dir": "<path>",
  "count": 2,
  "allOk": true,
  "entries": [{ "file": "<basename>.json", "id": "ldg-...", "kind": "proposal", "from": "a", "to": "b", "title": "...", "target": null, "verdict": null, "ok": true, "failedChecks": [] }],
  "resolution": { "proposals": [{ "id": "ldg-...", "title": "...", "resolution": "pending", "reviews": [] }], "pending": 1, "approved": 0, "rejected": 0, "contested": 0 }
}
```

Extra per-entry codes: `ledger-dir-unreadable` (the dir itself; the failure entry's `file` is the dir path), `ledger-entry-not-regular` (a `*.json` that is not a plain file), `ledger-bad-json` (unreadable/unparseable file) (`src/ledger.ts:310-346`). Files are read in sorted name order.

`unionLedgerEntries` (2+ dirs): same shape but with top-level `dirs` (array) and per-entry `dirs` (the mirrors it was seen in). Verified entries de-duplicate by content-addressed `id`; failing entries are kept once per occurrence (`src/ledger.ts:369-391`).

Resolution states: `pending` (no verified review targets it), `approved`/`rejected` (all verified reviews targeting it agree), `contested` (verified reviews disagree). Only VERIFIED entries take part; a tampered review never resolves a proposal (`src/ledger.ts:400-428`).

### Telemetry ledger record (src/telemetry-ledger.ts, src/types/observability.ts:30-61)

One record (`telemetry.json` `records[]` item):

```json
{
  "schemaVersion": 1,
  "runId": "<run id>",
  "recordId": "tel-001",
  "recordedAt": "<iso>",
  "workerId": "w-map",
  "taskId": "map:server-api",
  "promptDigest": "sha256:<hex>",
  "reportedUsageDigest": "sha256:<hex>",
  "reportedUsage": { "input_tokens": 2117, "output_tokens": 1911 },
  "usageSignature": "<base64 or absent>",
  "resultDigest": "sha256:<hex, only when the signature covered the result>",
  "attestation": "attested",
  "attestationReason": "<optional>",
  "prevHash": "sha256:<hex>",
  "recordHash": "sha256:<hex>"
}
```

- Genesis: `prevHash` of record 1 = `sha256("cw-telemetry-ledger:" + runId)` (`src/telemetry-ledger.ts:74-77`).
- `recordId` = `tel-` + chain position, zero-padded to 3 (`tel-001`, `tel-002`, ...) — the POSITION, never a clock (`src/telemetry-ledger.ts:112-116`).
- `recordHash` = `sha256(stableStringify({...}))` over exactly: `schemaVersion, runId, recordId, recordedAt, workerId, taskId, promptDigest, reportedUsageDigest, [reportedUsage only if present], usageSignature || null, [resultDigest only if present], attestation, attestationReason || null, prevHash` (`src/telemetry-ledger.ts:79-104`). The two `[...]` keys are OMITTED (not `null`) when absent, so old usage-only records hash byte-identical.
- `reportedUsageDigest(undefined)` = digest of the string `null` (`src/telemetry-ledger.ts:106-110`).
- `attestation` is one of `attested` | `unattested` | `absent` (`src/types/observability.ts:97`).

`verifyTelemetryLedger` returns `{ present, verified, records, checks, attested, unattested, absent }`. Check names/codes, exact:

- corrupt file: `{ name: "ledger-load", pass: false, code: "telemetry-ledger-corrupt" }`, `present:true`, `verified:false` (`src/telemetry-ledger.ts:186-198`);
- per link: `` `chain-link[${i}]` `` with code `telemetry-chain-broken` on a bad `prevHash` (`src/telemetry-ledger.ts:206-213`);
- per record: `` `record-hash[${i}]` `` with code `telemetry-digest-mismatch` on a recompute miss (`src/telemetry-ledger.ts:214-222`);
- empty/absent ledger: `present:false`, `verified:true`, zero checks (`src/telemetry-ledger.ts:203-205`).

### Attestation verify (src/telemetry-attestation.ts)

The exact signed bytes: `stableStringify({ usage: usage ?? null, runId, taskId, promptDigest, [resultDigest only when given] })` — keys come out sorted (`promptDigest`, `resultDigest`, `runId`, `taskId`, `usage`) because `stableStringify` sorts (`src/telemetry-attestation.ts:63-78`). Signature = `crypto.sign(null, payload, privateKey)` base64 (raw ed25519, no digest arg) (`src/telemetry-attestation.ts:185-193`); verify = `crypto.verify(null, ...)` (`src/telemetry-attestation.ts:139-140`).

`verifyTelemetryAttestation(usage, signatureB64, trustPublicKeyPem, ctx)` returns `{ status, reason?, algorithm?, coversResult? }` and never throws. Exact reasons:

| Status | Reason string (exact) |
| --- | --- |
| `absent` | `agent reported no usage` |
| `unattested` | `reported usage carries no signature` |
| `unattested` | `no trust key configured (set agent attestPublicKey / CW_AGENT_ATTEST_PUBKEY)` |
| `unattested` | `` `trust key unreadable: ${message}` `` |
| `unattested` | `signature is empty` |
| `unattested` | `signature is not valid base64` |
| `unattested` | `` `verification error: ${message}` `` |
| `unattested` | `signature does not match reported usage (tampered, replayed, or wrong key)` |
| `attested` | (no reason; `algorithm:"ed25519"`; `coversResult:true` only when the FIRST, result-carrying arm matched) |

(`src/telemetry-attestation.ts:111-159`.) Two-arm check: try the payload WITH `resultDigest` first; on a miss, retry WITHOUT it (old 4-field signers still verify). A new signer that covered the result fails BOTH arms when the result was edited (`src/telemetry-attestation.ts:143-152`).

`verifyTelemetrySignatures(records, pem)` returns `{ keyProvided, checked, reverified, failed, resultBound, checks }`. Per-record check name is `` `signature[${i}]` ``; codes, exact:

| Code | Pass | When |
| --- | --- | --- |
| `signature-unchecked-no-key` | true (informational) | no key given (`src/telemetry-attestation.ts:270-272`) |
| `telemetry-usage-unavailable` | false | record claims `attested` but stores no raw `reportedUsage` (`src/telemetry-attestation.ts:274-280`) |
| `telemetry-usage-digest-mismatch` | false | stored `reportedUsageDigest` != digest of stored `reportedUsage` (`src/telemetry-attestation.ts:281-287`) |
| `telemetry-pubkey-unreadable` | false | verify reason starts `trust key unreadable` (`src/telemetry-attestation.ts:308-314`) |
| `telemetry-signature-mismatch` | false | any other non-`attested` outcome (`src/telemetry-attestation.ts:314`) |

`resultBound` gets `{taskId, resultDigest}` ONLY when the signature re-verified AND `coversResult` is true — a 4-field signature never anchors a result digest, even if one is on the record (`src/telemetry-attestation.ts:297-305`).

### `cw telemetry verify` JSON (src/telemetry-demo.ts:55-76, src/capability-core.ts:1197-1215)

```json
{
  "schemaVersion": 1, "runId": "...", "present": true, "verified": true,
  "records": 3, "attested": 2, "unattested": 1, "absent": 0,
  "signatureKeyProvided": false, "signaturesChecked": 2,
  "signaturesReverified": 0, "signaturesFailed": 0,
  "failedChecks": [{ "name": "...", "code": "..." }]
}
```

`verified` = chain verified AND (key input, if any, was readable) AND `signaturesFailed === 0` (`src/capability-core.ts:1204`).

Human render (`formatTelemetryVerify`, `src/telemetry-demo.ts:79-97`), byte-exact lines:

- no ledger: `` `telemetry: run ${runId} has no attestation ledger (nothing to verify)` ``
- head line one of:
  - `` `✓ VERIFIED — ${records} record(s), chain intact, every hash recomputed independently` ``
  - `✗ VERIFICATION REFUSED — supplied public key was unreadable`
  - `` `✗ TAMPERING DETECTED — ${n} check(s) failed` ``
- tally: `` `   attested ${a} · unattested ${u} · absent ${b}` ``
- signature line (one of): `\n   signatures: public key unreadable; ed25519 re-check refused`; `` `\n   signatures: ${reverified}/${checked} re-verified against the supplied public key` `` plus `` ` · ${failed} FAILED` `` when failed>0; `` `\n   signatures: ${checked} attested record(s) — chain-proven only; pass --pubkey to re-verify ed25519 offline` ``
- each failed check: `` `   ✗ ${name}  ${code || ""}` ``
- whole output starts `` `telemetry verify ${runId}\n` ``.

### `cw demo tamper` (src/telemetry-demo.ts:122-262)

Fixed inputs: three hops `w-map`/`map:server-api` (attested), `w-assess`/`assess:security` (unattested), `w-verdict`/`verdict:synthesis` (attested); usages `{input_tokens:2117,output_tokens:1911}`, `{1840,1502}`, `{980,770}`; `now` pinned to `2026-01-01T00:00:00.000Z`; `runId` = `demo-tamper-run`; key = fresh ephemeral ed25519 per run (`src/telemetry-demo.ts:133-139,148-157`).

The THREE forge cases it must catch:

1. LEDGER layer — flip `records[1].attestation` `"unattested"` → `"attested"` AND recompute that record's `recordHash` (the attacker re-seals the local hash). The per-record digest check passes; the chain check fails at the NEXT record (`chain-link[2]`: `telemetry-chain-broken`) because record 2 was linked to the OLD hash (`src/telemetry-demo.ts:186-205`). Tamper text, exact: `` `forged record[1] verdict "unattested" -> "attested" AND recomputed its recordHash to cover the edit` ``.
2. SIGNATURE layer — multiply hop-0's `output_tokens` by 10, keep the original signature. `verifyTelemetryAttestation` returns `unattested` with reason `signature does not match reported usage (tampered, replayed, or wrong key)` (`src/telemetry-demo.ts:207-227`). Tamper text: `` `inflated record[0] reported output_tokens 1911 -> 19110, reused the original ed25519 signature` ``.
3. RESULT layer — the executor signs a 5-field payload with `resultDigest = sha256("Finding: auth bypass in login() — severity HIGH")`; the finding is then edited `HIGH` → `LOW`; CW re-derives the digest from the edited text, so BOTH payload arms fail (`src/telemetry-demo.ts:229-252`). Tamper text: `` `edited the agent's signed finding "severity HIGH" -> "severity LOW" after it was signed` ``.

`proven` is true only when the clean baseline verified, every signed hop's signature verified, and EVERY layer went `before.verified:true` → `after.verified:false` with at least one failure (`src/telemetry-demo.ts:256-259`). Result JSON: `{ schemaVersion:1, runId:"demo-tamper-run", workers:3, trustKey:"ephemeral-ed25519", baseline:{ledgerVerified, signaturesValid, records}, layers:[{layer, tamper, before:{verified,detail}, after:{verified,detail}, failures}], proven }`.

Human render (`formatTamperDemo`, `src/telemetry-demo.ts:100-120`) — key exact lines: first line `` `cw demo tamper — tamper-evidence proof (hermetic, ephemeral-ed25519 key)` ``; per layer `` `▶ ${LAYER} tamper` ``, `` `  edit:   ${...}` ``, `` `  before: ✓ verified — ...` ``, `` `  after:  ✗ DETECTED — ...` `` (or `✓ (UNDETECTED!)`); verdict `VERDICT: tamper-evidence holds ✓ — every forgery was caught offline, with only the public key. No server was trusted.` or `VERDICT: PROOF FAILED ✗ — a tamper went undetected. This is a regression in the integrity guarantee.`

### `cw demo bundle` (src/telemetry-demo.ts:295-423)

Builds a real run tree under a tmpdir (`.cw/runs/demo-bundle-run`), signs the same three hops, writes a `report.md`, exports a sealed bundle with the ephemeral public key, and forges it TWO ways: (a) CHAIN — same verdict-flip-and-reseal as tamper layer A, re-exported so every archive file digest is valid; only the embedded chain breaks; (b) SIGNATURE — inflate the last attested hop's tokens AND reseal both `reportedUsageDigest` and `recordHash`, so the chain stays valid and only the ed25519 re-verify fails (`src/telemetry-demo.ts:345-390`). Result JSON: `{ schemaVersion:1, runId:"demo-bundle-run", workers:3, trustKey:"ephemeral-ed25519", baseline:{ok, telemetryVerified, signaturesReverified}, layers, proven }`. Human verdict lines: `VERDICT: bundle verification holds ✓ — every forgery caught offline with only the bundle's embedded public key. No repo, no server, no key handed over.` / `VERDICT: PROOF FAILED ✗ — a forged bundle verified. This is a regression in the bundle guarantee.`

### `cw report verify-bundle` JSON (src/types/report-bundle.ts:9-36, src/run-export.ts:438-636)

```json
{
  "schemaVersion": 1, "archivePath": "...", "runId": "... or null",
  "ok": true, "archiveOk": true,
  "telemetryVerified": true, "trustAuditVerified": true,
  "trustKeySource": "bundle", "signatureKeyProvided": true,
  "signaturesChecked": 2, "signaturesReverified": 2, "signaturesFailed": 0,
  "trustLevel": "signed", "reportFindingsVerified": true,
  "reportExtractedTo": "<optional>",
  "failedChecks": [{ "name": "...", "code": "..." }]
}
```

- Key precedence: bundle-embedded key > `--pubkey` > `CW_AGENT_ATTEST_PUBKEY`; `trustKeySource` is `bundle` | `argument` | `environment` | `none` (`src/run-export.ts:484-491`).
- `ok` = archive bytes ok AND telemetry chain AND trust-audit chain AND `signaturesFailed === 0` AND report-findings ok AND no strict/extract/require shortfall (`src/run-export.ts:614-622`).
- `trustLevel` = `"signed"` only when at least one result-COVERING signature re-verified, none failed, and the report cross-check held; else `"unsigned"` (`src/run-export.ts:597-598`).
- Report ⇄ result ⇄ signature cross-check: driven by `sig.resultBound` (never `run.tasks`); per bound record, failures are recorded under name `report-findings` with codes `` `result-missing:${taskId}` ``, `` `result-digest-mismatch:${taskId}` ``, `` `report-result-mismatch:${taskId}` `` (`src/run-export.ts:541-559`). The report match requires the result body right after the task's own `### <taskId>` heading plus a `Result: <path>` line (`src/run-export.ts:424-436`).
- Other failure codes: `signature-key-required` (strict + attested records + no key), `signatures-required` (`--require-signatures` + `trustLevel:"unsigned"`), `report-md-unavailable` (extract asked but not fulfilled), `path-outside-working-directory` (extract target escapes `cwd`), `restore` (import threw; `code` is the throw message) (`src/run-export.ts:564-608`).
- Verification restores into a tmpdir `cw-verify-bundle-*` and removes it in a `finally` (`src/run-export.ts:493,576`).

### Trust-audit chain (src/trust-audit.ts)

- Genesis: `sha256("cw-trust-audit:" + runId)` (`src/trust-audit.ts:67-70`).
- `eventHash` = `sha256(stableStringify(JSON.parse(JSON.stringify(event sans eventHash))))` — the JSON round-trip drops `undefined`-valued keys so the record-time hash equals the parsed-from-disk hash (`src/trust-audit.ts:72-86`).
- Event id: `` `audit-${safeFileName(kind)}-${count padded to 4}` `` — the chain position, no clock (`src/trust-audit.ts:673-679`).
- `verifyTrustAudit` codes: `trust-audit-corrupt-line` (a line that does not parse; counted, `verified:false`), `` `event-hash[${i}]` ``/`trust-audit-digest-mismatch`, `` `chain-link[${i}]` ``/`trust-audit-chain-broken`, and `unchained-events`/`trust-audit-unchained-event` when a hash-less line is mixed into a chained log (`src/trust-audit.ts:117-154`). A log that is ALL legacy (no hashes at all) verifies as `unchained` counts, not a failure.
- `recordTrustAuditEvent` appends durably (fsync) one JSON line to `audit/events.jsonl`, then refreshes `summary.json` + `index.json` (`src/trust-audit.ts:287-337`).
- Metadata scrub: keys matching `/secret|token|password|credential|authorization|api[_-]?key/i` become `"[redacted]"`; string array items with `=` keep only the part before `=` (`src/trust-audit.ts:694-709`).

### Evidence gates (src/evidence-grounding.ts, src/verifier.ts)

- Grounded shapes: a URL (`/^[a-z][a-z0-9+.-]*:\/\//i`), a path (has `/` or `\`), a file-ext locator (`/\.[A-Za-z0-9]{1,12}(?::\d+(?:-\d+)?)?$/`), or a `namespace:value` token (`/^[A-Za-z][A-Za-z0-9_.-]*:\S/`). Bare prose fails (`src/evidence-grounding.ts:27-45`).
- Confidence tiers, in order: `ungrounded` < `grounded` < `resolvable` < `verified`. `verified` is NEVER auto-given — only explicit host attestation sets it (`src/evidence-grounding.ts:113-147`, `src/trust-audit.ts:534-536`).
- `extractEvidenceContent("file.ts:42", baseDirs)` returns line 42 (1-indexed) of the file, or the first 200 chars with no line number; `undefined` when it can not read — it never makes content up (`src/evidence-grounding.ts:149-173`).
- `taskRequiresEvidence`: true for `requiresEvidence` tasks or ids matching `/^verify[:/]/i`, `/^verdict[:/]/i`, `/^synthesis[:/]/i` (`src/verifier.ts:30-37`).
- `validateResultEnvelope` throws, exact messages:
  - `` `Task ${task.id} requires grounded cw:result evidence (a path-like locator, URL, or namespace:value token — not free text)` `` (`src/verifier.ts:41-45`)
  - `` `Task ${task.id} finding ${finding.id} severity ${sev} requires grounded evidence (a path-like locator, URL, or namespace:value token)` `` for P0/P1/P2 findings (`src/verifier.ts:85-89`)
  - `` `Task ${task.id} has a finding without id` ``; `` `Task ${task.id} finding ${id} has invalid classification` `` (classification must be `real|conditional|non-issue|unknown`) (`src/verifier.ts:78-84`)
  - `` `Task ${task.id} result violates declared schema: ...` `` (first 5 violations, then `` ` (+N more)` ``) (`src/verifier.ts:53-59`).
- `assertTaskCanComplete` throws `` `Phase gate blocked task ${task.id}; current runnable phase is ${name || "none"}` `` and `` `Task ${task.id} cannot be completed from status ${status}` `` (`src/verifier.ts:7-17`).
- `validateRunGates` throws `` `Verdict gate blocked ${task.id}; phase ${name} is not complete` `` when a completed verdict/synthesis task has an incomplete earlier phase (`src/verifier.ts:62-75`).
- The commit gate reuses the same grounding: codes `commit-verifier-missing-evidence`, `commit-verifier-evidence-ungrounded`, `commit-verifier-evidence-unresolvable` (`src/commit.ts:359-390`); the worker accept path adds `worker-evidence-unresolvable` under strict mode (`src/worker-accept/validation.ts:75-95`).
- `emptyCaptureWarning` reads the verifier node's source result node (`inputs.inputNodeId`, else first parent) and returns its `metadata.captureWarning` string — the no-false-green gate both selection and commit share (`src/gates.ts:29-36`).

### Evidence reasoning — fail closed to `unexplained` (src/evidence-reasoning.ts)

- A chain step with a decision but no recorded reason renders rationale `{ "status": "unexplained" }`; an adopted/rejected item with NO decision step at all gets one explicit unexplained step — the gap is shown, never guessed away (`src/evidence-reasoning.ts:182-186,418-435`).
- Roll-up rule: `explained` ONLY when every decision-bearing step is explained; ANY unexplained decision step makes the whole chain `unexplained`; no decision steps = `not-applicable` (`src/evidence-reasoning.ts:716-723`).
- Unexplained reason text, exact: `` `${gate}: no recorded rationale for ${decision} adoption` `` (`src/evidence-reasoning.ts:190-192`).
- Freshness: `absent` (no persisted index), `valid`, or `stale` (persisted `sourceFingerprint` differs) (`src/evidence-reasoning.ts:91-93`). `nextAction` strings: `` `cw multi-agent reasoning ${run.id} --refresh` `` (stale/absent), `` `... --json` `` (unexplained > 0), else `` `cw multi-agent evidence ${run.id} --json` `` (`src/evidence-reasoning.ts:96-100`).
- Fingerprint: `sha256:` + first 32 hex of a sha256 over the sorted chain lines (`src/evidence-reasoning.ts:762-774`).
- Human render header lines: `` `Evidence Adoption Reasoning: ${runId}` ``, `` `Freshness: ${status}` ``, section `Adoption Rationale`, tally line `` `  chains=${..}; explained=${..}; unexplained=${..}; n/a=${..}; adopted=${..}; rejected=${..}` ``, at most 60 chains then `` `  ... ${n} more` ``, then `Next Action` (`src/evidence-reasoning.ts:646-677`).
- Malformed or unreadable score records are SKIPPED at read; the score gate then fails closed (`src/evidence-reasoning.ts:743-760`).

## Files on disk

| Path (under `.cw/runs/<run-id>/`) | Format | Writer |
| --- | --- | --- |
| `telemetry.json` | `{ schemaVersion:1, runId, records:[TelemetryAttestationRecord] }`; append-only; each write is temp→fsync→rename (`writeJson … {durable:true}`) | `appendTelemetryAttestation` (`src/telemetry-ledger.ts:25-27,133-161`) |
| `audit/events.jsonl` | one JSON `TrustAuditEvent` per line; durable append (fsync); never rewritten | `recordTrustAuditEvent` (`src/trust-audit.ts:277-337`) |
| `audit/summary.json` | `TrustAuditSummary` (with `integrity`) ; durable | `summarizeTrustAudit` (`src/trust-audit.ts:413-512`) |
| `audit/index.json` | `{ schemaVersion:1, runId, events:[flat rows] }`; omits `scoreId` from the correlation ids; durable | `summarizeTrustAudit` (`src/trust-audit.ts:489-509,265`) |
| `reasoning/index.json` | `EvidenceReasoningIndex` with `id:"evidence-reasoning-index"` | `refreshEvidenceReasoning` (`src/evidence-reasoning.ts:529-567`) |
| `reasoning/report.json` | the full report, freshness forced `valid` | same (`src/evidence-reasoning.ts:565`) |
| `reasoning/chain-<safe-id>.json` | one `EvidenceReasoningChain` per evidence id | same (`src/evidence-reasoning.ts:539-549`) |
| `import-manifest.json` | written by `importRun`; read by `verifyImportedRun` | (`src/run-export.ts:206-216,380-382`) |

Outside the run dir:

- A handoff ledger directory holds one `<any-name>.json` per entry; writing it is the operator's `cw ledger propose > dir/x.json` plus git — the kernel only READS (`src/ledger.ts:249-255`).
- Bundles are single-file `*.cwrun.json` JSON archives with base64 file bodies, an `integrity` block, and an optional `trust: { publicKeyPem, algorithm: "ed25519" }` block (`src/run-export.ts:109-155`).
- Tmpdirs: `cw-verify-bundle-*`, `cw-tamper-demo-*`, `cw-bundle-demo-*` under `os.tmpdir()`; all removed after use unless `keepDir`/`dir` was passed (`src/run-export.ts:493`, `src/telemetry-demo.ts:149,254,296,392`).

## Invariants and error behavior

1. CW holds NO private key, ever. Only the agent signs; CW and any third party verify with the public half. `resolveTrustPublicKey` loads public keys only (`src/telemetry-attestation.ts:9-24,161-177`).
2. Default is honest: no signature ⇒ `unattested`; no usage ⇒ `absent`. Usage is never silently recorded as trusted (`src/telemetry-attestation.ts:23-24,117-124`).
3. Absent vs corrupt is a hard split. An absent `telemetry.json` is an empty chain (verifies clean, `present:false`). A PRESENT but unparseable one is corrupt: reads report `telemetry-ledger-corrupt`, and an APPEND THROWS `TelemetryLedgerCorruptError` — it never re-genesises over a poisoned file (`src/telemetry-ledger.ts:29-72,184-198`).
4. Verify never trusts a stored hash: every `recordHash`, `eventHash`, and ledger `digest` is recomputed independently (`src/telemetry-ledger.ts:180-183`, `src/trust-audit.ts:113-116`, `src/ledger.ts:196-199`).
5. Chain-verify alone trusts the stored `attested` verdict (it is protected by the chain); the ed25519 re-check is opt-in via a key. With a key, an `attested` record that can not be re-checked (no raw usage / digest mismatch / bad signature) FAILS — a forged signature can not ride a green chain (`src/telemetry-attestation.ts:196-212,266-316`).
6. Fail-closed exit codes: `ledger verify|apply|list`, `telemetry verify`, `audit verify`, `demo tamper|bundle`, `report verify-bundle`, `report bundle` all set exit 1 on their false verdict, so `... && ship` can not pass on a lie (`src/cli/handlers/ledger.ts:86,110,127`, `src/cli/handlers/maintenance.ts:67,85,94`, `src/cli/handlers/audit.ts:28`, `src/cli/handlers/operator.ts:30,39`).
7. The diff can only escape a VERIFIED proposal. `applyLedgerProposal` gives `diff:null` for a tampered entry, a review, or an empty diff (`src/ledger.ts:227-247`). The kernel never runs `git`.
8. The inbox is all-or-nothing: `allOk:false` if ANY entry in ANY mirror fails; a tampered review never resolves a proposal (it stays `pending`) (`src/ledger.ts:307-309,362-368,393-399`).
9. `id` is outside the ledger digest but bound by the `ledger-id-mismatch` check, so a spoofed id can not slip through union de-duplication (`src/ledger.ts:202-212`).
10. Trust-audit era rule: one run is written by one code version, so a log is all-chained or all-legacy; ONE hash-less line inside a chained log is treated as a forgery (`trust-audit-unchained-event`) (`src/trust-audit.ts:145-152`).
11. Append order is the chain order; `recordId`/event id are chain positions, not clock values, so replay is reproducible (`src/telemetry-ledger.ts:112-116`, `src/trust-audit.ts:673-679`).
12. Durability: telemetry writes and audit appends are fsync-backed; summary/index are written durably so a crash can not leave them past the log (`src/telemetry-ledger.ts:159`, `src/trust-audit.ts:330-334,486-509`).
13. The evidence gate fails closed: a required-evidence result without one grounded locator throws (the drive parks the hop); severity P0–P2 findings need grounded evidence; strict mode also demands file locators resolve on disk (`src/verifier.ts:39-60,77-90`, `src/evidence-grounding.ts:104-109`).
14. The reasoning chain fails closed to `unexplained`: a decision with no recorded reason is shown as a gap, never invented; one unexplained decision step marks the whole chain (`src/evidence-reasoning.ts:182-186,716-723`).
15. Honest limit of the local chains: a determined local writer who re-chains the WHOLE log with the same sha256 is NOT caught; the only crypto anchor is the agent's signature over usage/result. Closing that needs an external append-only anchor, which CW by design can not mint for itself (`src/trust-audit.ts:23-46`, `src/run-export.ts:589-596`).
16. Bundle key precedence is bundle > argument > environment, so a sealed artifact verifies the same on every machine (`src/run-export.ts:415,484-491`).
17. The opt-in `requireAttestedTelemetry` gate rejects a delegated hop whose verdict is not `attested` BEFORE any accept-side mutation, with error code `telemetry-unattested-blocked` (`src/worker-accept/telemetry-ledger.ts:46-59`). Default off.

## Edge cases

- `cw ledger verify`/`apply` read stdin when `--file` is absent (`fs.readFileSync(file || 0, "utf8")`) (`src/cli/handlers/ledger.ts:69,94`). Read errors throw `` `Cannot read ledger entry from <src>: <msg>` ``.
- The propose `--diff` is tested trimmed for presence but passed through verbatim — the trailing newline `git apply` needs is kept (`src/cli/handlers/ledger.ts:38-42`).
- `listLedgerEntries` on an unreadable dir returns ONE failure entry whose `file` is the dir path, code `ledger-dir-unreadable`, `count:0`, `allOk:false` (`src/ledger.ts:311-317`). A `*.json` that is a symlink/dir (not a plain file) fails `ledger-entry-not-regular` (`src/ledger.ts:322-325`).
- The same entry mirrored into N dirs collapses to one union row whose `dirs` lists every mirror; content-addressing makes the union conflict-free (`src/ledger.ts:348-391`).
- Usage-only (4-field) records omit `resultDigest` and `reportedUsage` keys from the hash input, so pre-upgrade ledgers hash byte-identical — do NOT hash them as `null` (`src/telemetry-ledger.ts:91-95,148-152`).
- `stableStringify` in `src/telemetry-attestation.ts:54-61` maps a top-level `undefined` to `"null"`; the copy in `src/ledger.ts:92-100` does not have that guard. Both sort keys recursively.
- The trust-audit `eventHash` binds the PERSISTED form: nested `undefined` values are dropped by the JSON round-trip before hashing, else record-time and verify-time hashes differ and legitimate events false-fail (`src/trust-audit.ts:77-86`).
- `verifyTrustAudit` walks FILE (append) order; `listTrustAuditEvents` sorts by `createdAt` then `id` — the two orders are distinct on purpose (`src/trust-audit.ts:94-97,394,728-730`).
- A per-request event-log cache exists (`setAuditEventCache`/`clearAuditEventCache`); when set, reads are memoized by event-log path (`src/trust-audit.ts:376-397`).
- `resolveTrustPublicKey` accepts an inline PEM (detected by `BEGIN` + `KEY` substrings) or a file path; anything unreadable resolves to `undefined` (⇒ `unattested`, never a throw) (`src/telemetry-attestation.ts:161-177`).
- `normalizeReportedUsage` accepts snake_case and camelCase token keys (`input_tokens`, `inputTokens`, `promptTokens`, ...); an unreported bucket stays `undefined`, never 0 (`src/telemetry-attestation.ts:84-107`).
- The record-time verifier binds `resultDigest = sha256(rawResult)` computed by CW from the ACCEPTED result bytes; the record stores that digest ONLY when `coversResult` was true, so an injected digest is never stored as signed (`src/worker-accept/telemetry-ledger.ts:34-45,100-104`).
- `verifyReportBundle` never throws: a missing, unreadable, non-JSON, or wrong-schema bundle is `ok:false` with structured checks and no tmpdir (`src/run-export.ts:462-464`, `src/run-export.ts:321-345`).
- `--extract-report` that can not be fulfilled (no `report.md` in the bundle, or a write failure) fails with `report-md-unavailable` — a requested-but-absent output is a failure, not a no-op (`src/run-export.ts:602-608`).
- Report anchor search walks EVERY `### <taskId>` heading, so a stray heading inside another result body can not mis-anchor the check (`src/run-export.ts:424-436`).
- Demo runs are hermetic and near-deterministic: fixed hops, fixed `DEMO_NOW`, only the ephemeral keypair varies and never leaves the function (`src/telemetry-demo.ts:133-157`).
- `emptyCaptureWarning` falls back from `inputs.inputNodeId` to the first parent, so it works no matter which ingest path built the node (`src/gates.ts:29-36`).

## Evidence

All pointers are relative to `plugins/cool-workflow/` and are given inline above, per claim. Primary files: `src/ledger.ts:1-429`; `src/telemetry-ledger.ts:1-225`; `src/telemetry-attestation.ts:1-319`; `src/trust-audit.ts:1-731`; `src/evidence-grounding.ts:1-174`; `src/evidence-reasoning.ts:1-867`; `src/verifier.ts:1-92`; `src/gates.ts:1-49`; `src/telemetry-demo.ts:1-424`. Wiring: `src/cli/handlers/ledger.ts:1-133`; `src/cli/handlers/maintenance.ts:56-100`; `src/cli/handlers/operator.ts:19-41`; `src/cli/handlers/audit.ts:19-30`; `src/capability-core.ts:396-433,1181-1262`; `src/mcp/tool-call.ts:350-382`; `src/mcp/tool-definitions.ts:398-399,642-666,871-887,1002-1006`; `src/run-export.ts:100-155,384-636`; `src/worker-accept/telemetry-ledger.ts:22-142`; `src/worker-accept/validation.ts:60-95`; `src/commit.ts:359-390`; `src/types/observability.ts:26-97`; `src/types/trust.ts:36-102`; `src/types/report-bundle.ts:7-48`; `src/execution-backend/util.ts:13-15`; `src/agent-config.ts:105`. Man pages: `docs/cross-agent-ledger.7.md`, `docs/demo.7.md`, `docs/report-verifiable-bundle.7.md`, `docs/security-trust-hardening.7.md`, `docs/evidence-adoption-reasoning-chain.7.md`, `docs/verifier-gated-commit.7.md`, `docs/multi-agent-trust-policy-audit.7.md`.

## Pinned by tests

- `test/ledger-verify-smoke.js` — propose/review/verify round-trip; tampered/malformed entry exits non-zero.
- `test/ledger-apply-smoke.js` — verified diff round-trips and applies; tampered/review/diff-less/non-JSON each exit 1 with `diff:null`.
- `test/ledger-resolution-smoke.js` — inbox resolution states; tampered review keeps a proposal `pending`; list output stays additive.
- `test/telemetry-ledger-smoke.js` — chain append/genesis; clean chain verifies; verdict edit caught by digest mismatch.
- `test/telemetry-attestation-smoke.js` — signed usage ⇒ `attested`; tampered usage ⇒ `unattested`; the verify spine.
- `test/telemetry-verify-signatures-smoke.js` — `--pubkey` re-runs ed25519; a forged signature no longer rides a green chain.
- `test/telemetry-fail-closed-smoke.js` — opt-in `require-attested-telemetry` rejects non-attested hops pre-mutation.
- `test/tamper-evidence-demo-smoke.js` — `cw demo tamper` catches all three forgeries; exit-code contract.
- `test/demo-bundle-smoke.js` — `cw demo bundle` catches both bundle forgeries.
- `test/report-verify-bundle-smoke.js` — offline self-contained bundle verify; fail-closed on a chain forged past the file digests.
- `test/report-bundle-smoke.js` — produce-and-prove `report bundle`.
- `test/audit-verify-smoke.js` — `cw audit verify` exit-code contract; absent chain exits 0.
- `test/freebsd-audit-fixes-smoke.js` — `verifyTrustAudit` chain logic (per `test/audit-verify-smoke.js` header).
- `test/verify-import-audit-chain-smoke.js` — restore re-proves the trust-audit chain.
- `test/run-import-tamper-failclosed-smoke.js` — tampered archives refused at import.
- `test/verifier-gated-commit-smoke.js` — commit gate evidence rules.
- `test/evidence-adoption-reasoning-smoke.js` — fail-closed `unexplained`, freshness, determinism.
- `test/evidence-content-extraction-smoke.js` — `extractEvidenceContent` line reads.
- `test/security-trust-hardening-smoke.js`, `test/multi-agent-trust-policy-audit-smoke.js`, `test/telemetry-attest-wrap-smoke.js`, `test/telemetry-metrics-coverage-smoke.js`, `test/quickstart-bundle-smoke.js`, `test/readme-trust-claim-smoke.js` — nearby trust surfaces that lean on these modules.

## Rebuild risks

1. **Two hash spellings.** `sha256()` (chains, digests) returns `sha256:<hex>` WITH the prefix; archive file digests (`sha256Bytes`) are BARE hex. Mixing them breaks every chain and every archive check at once (`src/execution-backend/util.ts:13-15`, `src/run-export.ts:922-924`).
2. **Key omission vs null.** In `recordHashInput` and `canonicalTelemetryPayload`, absent `reportedUsage`/`resultDigest` keys are OMITTED, while `usageSignature`/`attestationReason` become `null`. Getting one of these wrong changes every record hash and breaks back-compat with old ledgers (`src/telemetry-ledger.ts:81-100`, `src/telemetry-attestation.ts:64-78`).
3. **The 4-field fallback and `coversResult`.** Verify must try the 5-field payload first, retry 4-field on a miss, and set `coversResult` ONLY on a first-arm match; `resultBound` must exclude 4-field matches even when a `resultDigest` sits on the record — else an injected digest gets trusted (`src/telemetry-attestation.ts:139-158,297-305`).
4. **Absent vs corrupt telemetry ledger.** Reading them the same way was a real bug: a corrupt overlay verified green and an append re-genesised over it. Append must THROW on corrupt; verify must report `telemetry-ledger-corrupt` with `present:true` (`src/telemetry-ledger.ts:29-72,184-198`).
5. **The eventHash JSON round-trip.** Hash the persisted form (`JSON.parse(JSON.stringify(...))`), or events with nested `undefined` false-fail as `trust-audit-digest-mismatch` (`src/trust-audit.ts:77-86`).
6. **The `id` binding check on ledger entries.** `id` is outside the digest; without the `ledger-id-mismatch` check a forged entry can spoof another entry's id and get dropped in union de-duplication (`src/ledger.ts:202-212`).
7. **Exit-code and "nothing to prove" rules.** Every verify verb exits 1 on its false verdict, but absent chains/ledgers are `verified:true` exit 0, and `demo`'s exit hangs on `proven`, not on `verified`. Flipping any of these breaks `&&`-gated operator flows (`src/cli/handlers/maintenance.ts:64-95`, `src/cli/handlers/audit.ts:22-28`).
8. **The verify-bundle cross-check driver.** It must iterate `sig.resultBound` (signature-anchored), never `run.tasks` (unbound data an attacker can edit); and the mixed chained/unchained trust-audit rule must stay a failure (`src/run-export.ts:527-559`, `src/trust-audit.ts:145-152`).
