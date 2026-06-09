# Dogfood One Real Repo

CW v0.1.16 proves the release workflow against the real Cool Workflow
repository. The proof uses the canonical `release-cut` app, records isolated
worker outputs, scores a release candidate, selects it only with verifier
evidence, creates a verifier-gated CW state commit, and renders trust audit
provenance.

## Dry-Run Command

From the package directory:

```bash
cd plugins/cool-workflow
npm run dogfood:release
```

The command targets the repository two directories above the package, uses
`release-cut`, sets `version=0.1.18`, `previousVersion=0.1.17`, the current git
branch, and `dryRun=true`. It writes a machine-readable summary to:

```text
.cw/runs/<run-id>/dogfood-summary.json
```

The summary includes the run id, report path, audit summary path, provenance
counts, worker ids, candidate id, score id, selection id, commit or checkpoint
id, command log paths, and the release verdict.

## Real Evidence

The full dry-run collects real repository evidence from:

```bash
git status --short --branch
node scripts/version-sync-check.js
npm run build
npm run check
npm test
npm run fixture-compat
npm run canonical-apps
npm run golden-path
npm run release:check
npm pack --dry-run --json
```

Each command log is written under the worker `logs/` directory and cited in the
worker `cw:result` evidence array. The release verdict worker carries the full
set of command locators into the release candidate, score, selection, and
commit/checkpoint provenance.

## Inspect The Run

Use the standard operator commands:

```bash
node scripts/cw.js status <run-id>
node scripts/cw.js graph <run-id>
node scripts/cw.js report <run-id> --show
node scripts/cw.js worker summary <run-id>
node scripts/cw.js candidate summary <run-id>
node scripts/cw.js feedback summary <run-id>
node scripts/cw.js commit summary <run-id>
```

Inspect trust records:

```bash
node scripts/cw.js audit summary <run-id>
node scripts/cw.js audit provenance <run-id>
node scripts/cw.js audit provenance <run-id> --candidate dogfood-release-0.1.18
node scripts/cw.js audit provenance <run-id> --commit <commit-id>
```

The report answers why the candidate is trusted by showing sandbox profiles,
host attestations, evidence provenance, candidate scoring, acceptance rationale,
and the verifier-gated commit.

The dogfood command remains a local release-engineering script rather than a new
MCP tool because it composes existing first-class CW capabilities: `release-cut`
planning, dispatch, worker manifests/output, candidate scoring/selection,
commits, reports, and audit/provenance. MCP parity is preserved for the
inspectable state through the existing worker, candidate, commit, operator
report, and audit tools.

## Smoke Mode

`npm test` and `npm run release:check` run:

```bash
node test/dogfood-release-smoke.js
```

The smoke test executes `scripts/dogfood-release.js --smoke --json`. It still
uses the real repository, `release-cut`, worker manifests, trust audit records,
candidate scoring, selection, verifier-gated commit, and a report, but keeps the
command set smaller to avoid recursive release checking.

## Promote To Real Release Actions

Dry-run mode never creates tags, pushes, publishes packages, or mutates a
marketplace. Real actions are separate maintainer commands after the dogfood
run passes:

```bash
npm run dogfood:release
npm run release:check
git status --short --branch
git tag v0.1.18
git push origin main --tags
```

Package publish and plugin marketplace updates should be separate visible
steps. If future execute flags are used, they must be explicit, for example
`--execute --tag --confirm-release-actions=0.1.18`. The script refuses tag,
push, or publish flags in dry-run mode and refuses execute mode without the
target-version confirmation.

## Safety Gates

The dogfood command holds the candidate and writes an explicit checkpoint if
any evidence command fails, version sync is incomplete, release docs are
missing, audit records are unavailable, or verifier evidence is absent. A
selected candidate requires score evidence and a verified verifier node; a
verifier-gated commit requires the selected candidate, score, evidence, sandbox
profile, worker, and acceptance rationale.

This is intentionally boring release engineering: local-first, inspectable,
scriptable, and fail-closed.

## Architecture-Review Agent-Delegation Dogfood (v0.1.38)

`scripts/dogfood-architecture-review.js` dogfoods the v0.1.38 Agent Delegation
Drive: the `architecture-review` app driven end-to-end by the `agent` backend,
with zero hand-written `result.md`.

It splits into two halves, exactly like the release dogfood above:

- **`--smoke` (CI-verifiable).** A hermetic STUB agent (no live binary, no second
  repo, no network, no model SDK) drives the real app to a committed audited
  report. `node scripts/dogfood-architecture-review.js --smoke --json` emits
  `{ ok: true, mode: "smoke" }` with a `reportPath` and `auditSummaryPath` that
  exist, the Verdict node accepted, and `audit.byKind["worker.agent-delegation"]
  >= 1`. This is asserted under `npm test` (`test/dogfood-release-smoke.js`).

- **Live full-drive (MAINTAINER-RUN, OUT OF CI).** With a REAL configured agent
  (`CW_AGENT_COMMAND`, e.g. `claude -p {{input}}` / `codex exec`, or
  `--agent-command`) against ONE real external repository:

  ```bash
  CW_AGENT_COMMAND="claude -p {{input}}" \
    node scripts/dogfood-architecture-review.js --repo /path/to/real/repo \
    --question "Audit this repo's architecture and rank the real risks."
  ```

  This drives plan → dispatch → agent-fulfill → accept/verify → commit for every
  worker the planner emits, produces the committed audited risk report, and writes
  a `docs/dogfood/architecture-review-<repo>.md` provenance note recording the repo
  name and the agent-REPORTED model id. It depends on a live external agent binary
  and a second repository, which CI cannot have (CI is node/npm/git-only and
  hermetic), so it is **explicitly OUT of CI** — a maintainer bar run out-of-band,
  exactly like the "Promote To Real Release Actions" above. The CI/release gate is
  strictly the stub `--smoke` path.

  The model runs in the external agent's process, never inside CW: this script
  spawns the agent and records its attested output; it imports no model SDK and
  holds no API key.
