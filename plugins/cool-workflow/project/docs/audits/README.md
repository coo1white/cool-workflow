# Historical Architecture-Audit Verdicts

Raw, as-recorded verdicts from CW's own architecture-review runs against this
repository. They are kept verbatim as audit records — findings listed here may
already be fixed.

| File | Produced at | Status |
|---|---|---|
| [architecture-review-verdict.md](architecture-review-verdict.md) | v0.1.38 (first agent-delegation drive) | historical record |
| [architecture-review-verdict-v0.1.39.md](architecture-review-verdict-v0.1.39.md) | v0.1.39 | historical record |

For the current, fully citation-verified self-audit, see
[`examples/audits/self-audit-cool-workflow-v0.2.6.md`](../../examples/audits/self-audit-cool-workflow-v0.2.6.md)
— every finding was independently re-checked against the tree, and every citation resolves
(run `project/docs/scripts/verify-audit-cites.js` against it yourself). The earlier
[`self-audit-cool-workflow-v0.1.42.md`](../../examples/audits/self-audit-cool-workflow-v0.1.42.md)
is kept as a historical snapshot; its citations predate the core/shell `src/` split and no
longer resolve.
The publishing workflow for audits like these is documented in
[`docs/publishing-audits.md`](../publishing-audits.md). Newer live-run
provenance notes land under
[`plugins/cool-workflow/docs/dogfood/`](../../../docs/dogfood/).
