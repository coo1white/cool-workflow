# GitHub Showcase Repo Research

This note captures the evidence used for the draft README and Wiki pages in this
directory. It is not a public positioning page; it is the claim table behind the
draft.

## Evidence Read

- Root user README: `README.md`
- Package README and metadata: `plugins/cool-workflow/README.md`,
  `plugins/cool-workflow/package.json`
- Docs index and generated source map:
  `plugins/cool-workflow/docs/index.md`,
  `plugins/cool-workflow/docs/project-index.md`
- First-run and core-flow docs:
  `plugins/cool-workflow/docs/getting-started.md`,
  `plugins/cool-workflow/docs/agent-delegation-drive.7.md`,
  `plugins/cool-workflow/docs/end-to-end-golden-path.7.md`,
  `plugins/cool-workflow/docs/run-registry-control-plane.7.md`,
  `plugins/cool-workflow/docs/trust-model.md`,
  `plugins/cool-workflow/docs/cli-mcp-parity.7.md`
- Release and launch context: `CHANGELOG.md`, `RELEASE.md`,
  `plugins/cool-workflow/docs/launch/launch-kit.md`,
  `plugins/cool-workflow/docs/launch/pre-launch-checklist.md`
- Tests used as behavioral evidence:
  `plugins/cool-workflow/test/quickstart-smoke.js`,
  `plugins/cool-workflow/test/end-to-end-golden-path-smoke.js`,
  `plugins/cool-workflow/test/vendor-manifest-load-smoke.js`,
  `plugins/cool-workflow/test/audit-verify-smoke.js`,
  `plugins/cool-workflow/test/run-import-tamper-failclosed-smoke.js`,
  `plugins/cool-workflow/test/run-export-restore-resume-smoke.js`,
  `plugins/cool-workflow/test/run-export-restore-rerun-smoke.js`
- Commands run locally from `plugins/cool-workflow`:
  `node scripts/cw.js list`,
  `node scripts/cw.js app list --json`,
  `node scripts/cw.js app show architecture-review --json`,
  `node scripts/cw.js app show architecture-review-fast --json`,
  `node scripts/cw.js demo tamper`,
  `node scripts/cw.js demo tamper --json`,
  `node scripts/cw.js backend probe agent --json`,
  `node scripts/cw.js audit verify`,
  `node scripts/golden-path.js --json --cleanup`

## Claim Table

| Claim | Evidence | Publish |
| --- | --- | --- |
| CW is an auditable TypeScript/Node workflow control-plane for agent work. | `package.json` description; both READMEs; docs index. | Yes |
| CW delegates execution to external agents and does not embed a model SDK or hold an API key. | Root README; `agent-delegation-drive.7.md`; `quickstart-smoke.js` red-line assertions. | Yes |
| The fastest proof is `npx cool-workflow demo tamper`, with no repo clone or agent required. | Root README; launch checklist; local `node scripts/cw.js demo tamper` run. | Yes |
| A real review writes durable run state and a report under `.cw/runs/<run-id>/`. | Root README; `quickstart-smoke.js`; `end-to-end-golden-path.7.md`; local golden-path JSON output. | Yes |
| `architecture-review` is the default quickstart app and has 14 tasks; `architecture-review-fast` has 6 tasks. | Local `node scripts/cw.js app list --json`; `quickstart-smoke.js`; project index. | Yes |
| CW fails closed when no agent is configured. | Root README; `quickstart-smoke.js`; agent delegation docs. | Yes |
| Telemetry verification proves recorded integrity and signed attribution, not the original truth of a reported number. | `trust-model.md`; `demo tamper` output. | Yes, with limitation stated. |
| `audit verify` is a fail-closed trust-audit chain gate and has MCP parity. | `capability-registry.ts`; `audit-verify-smoke.js`; `multi-agent-trust-policy-audit.7.md`; CLI missing-run-id check. | Yes |
| Run export/import/verify supports recovery across machines or directories. | `run-registry-control-plane.7.md`; `run-export-restore-resume-smoke.js`; `run-export-restore-rerun-smoke.js`. | Yes |
| CLI and MCP share a capability registry, and `--json` payloads are parity-gated where declared identical. | `cli-mcp-parity.7.md`; capability registry references; package scripts. | Yes |
| Generated vendor manifests exist for multiple agent hosts and are boot-tested. | `manifest/README.md`; generated plugin directories; `vendor-manifest-load-smoke.js`; CHANGELOG 0.1.81. | Yes |
| CW is production-ready for all agent workflows. | Not supported; docs repeatedly mark honest limits and early integration needs. | No |
| The cryptographic record independently proves token usage was true. | `trust-model.md` explicitly says it does not. | No |

## Drafting Notes

- The root README is already user-oriented and polished. The showcase README is a
  reviewable alternative, not an in-place rewrite.
- Draft links are relative to their draft locations under `docs/`. If a draft is
  applied to root `README.md` or a real GitHub Wiki, links should be adjusted for
  that target.
- No screenshots or new generated images were created. The draft reuses the
  existing README promo image at `docs/assets/cool-workflow-readme-promo.png`.
