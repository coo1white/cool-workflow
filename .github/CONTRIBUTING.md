# Contributing

Thanks for helping make Cool Workflow better.

The package is in `plugins/cool-workflow/`. Every command on this page is
run from that folder, unless the row says other. There is no `package.json`
at the repo root.

## What do you want to do?

Find your job in the left column. Start at the file or command in the
middle; the right column says where to go next.

| You want to | Start here | Then |
|---|---|---|
| Install from a clone | `bun install --frozen-lockfile && npm run build && npm link` | [`docs/reference.md`](../plugins/cool-workflow/docs/reference.md#install) — why bun, and what not to run |
| Do a first run | `cw -q "your question" -claude` in a git project | [`docs/reference.md`](../plugins/cool-workflow/docs/reference.md) — the loop at the top, then one part per step |
| Run the tests | `npm run test:fast` (quick) or `npm test` | [`test/README.md`](../plugins/cool-workflow/test/README.md#running) — every way to run them |
| Add a test | [`test/README.md`](../plugins/cool-workflow/test/README.md) | Unit test: `test/<the src/ folder>/<module>-<behavior>.test.mjs`. Smoke: `test/<name>-smoke.mjs` (found by itself). Shared set-up: [`test/helpers/`](../plugins/cool-workflow/test/helpers/) |
| Find what a command does | `cw help <command>` | [`docs/reference.md`](../plugins/cool-workflow/docs/reference.md) — one part per command, organized by what you do |
| See how the code is laid out | [`project/docs/README.md`](../plugins/cool-workflow/project/docs/README.md#the-layer-stack) | The layer stack, one command walked from end to end, and the decision records |
| Add a command | One row in [`src/wiring/commands.ts`](../plugins/cool-workflow/src/wiring/commands.ts) | The body in `src/shell/`; a part in [`docs/reference.md`](../plugins/cool-workflow/docs/reference.md); a `--json` shape pinned in `test/cli-command-surface-smoke.mjs`. `src/` stays at 10,000 lines or fewer (`npm run check`) |
| Fix a doc | The page itself | The user reference: [`docs/reference.md`](../plugins/cool-workflow/docs/reference.md). Engineering docs that never ship: [`project/docs/`](../plugins/cool-workflow/project/docs/README.md). The README: edit the root copy only; CI makes the npm copy |
| Cut a release | Not yours: the operator runs `npm run release -- X.Y.Z` | An agent only gets the version-bump PR ready: [`docs/reference.md`](../plugins/cool-workflow/docs/reference.md#release-operator-runbook) and "How work moves" in [`AGENTS.md`](../AGENTS.md) |
| Report a security problem | [`.github/SECURITY.md`](SECURITY.md#reporting-issues) | Do not put it in a public issue |
| Know the rules | [`AGENTS.md`](../AGENTS.md) | [`REVIEW.md`](../REVIEW.md) — what a reviewer looks at |

## The rules

The binding rules for all work in this repo are in `AGENTS.md`. Read it
first. A PR that goes against one of its hard rules is rejected in review,
whatever it does.

## Plugin packaging rules

- Keep the package manifest valid.
- Keep `dist/` committed, so users can run the plugin without putting in
  dev dependencies.
- Do not commit `node_modules/`, `.cw/`, local run data, or absolute paths
  from your machine.
- Take out local dependencies (`rm -rf node_modules`) before you make a
  package or a commit by hand.
- Keep the bundled app (`apps/architecture-review/workflow.js`) able to run on
  Node.js and Bun.
- Keep TypeScript source in `src/`, and build again before a release.

## Before you open a pull request

Run what CI will run:

```bash
cd plugins/cool-workflow
bun install --frozen-lockfile
npm run build
npm run check
npm run test:coverage          # the full smoke suite under the 80% coverage floor
npm run test:unit              # the unit tests, in folders that mirror src/
node ../../v2/conformance/run.mjs --bin dist/cli.js   # byte-exact CLI conformance
npm run release:check -- --skip-tests   # every other gate (dist, purity, manifests, lang policy, ...)
```

Paste the test summary into the PR text. Do not push to `main`: make a
branch, open a PR, and let green CI merge it.
