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
| Install from a clone | `bun install --frozen-lockfile && npm run build && npm link` | [`docs/getting-started.md`](../plugins/cool-workflow/docs/getting-started.md) — why bun, and what not to run |
| Do a first run | `cw doctor --onramp`, then `cw demo tamper` | [`docs/getting-started.md`](../plugins/cool-workflow/docs/getting-started.md#one-run-end-to-end) — one run, end to end |
| Run the tests | `npm run test:fast` (quick) or `npm test` | [`test/README.md`](../plugins/cool-workflow/test/README.md#running) — every way to run them |
| Add a test | [`test/README.md`](../plugins/cool-workflow/test/README.md) | Unit test: `test/<the src/ folder>/<module>-<behavior>.test.mjs`. Smoke: `test/<name>-smoke.mjs` (found by itself, then `npm run sync:project-index`). Shared set-up: [`test/helpers/`](../plugins/cool-workflow/test/helpers/) |
| Find what a command does | `cw help <command>` | [`docs/index.md`](../plugins/cool-workflow/docs/index.md#find-by-command) — "Find by command", one row per verb |
| See how the code is laid out | [`project/docs/README.md`](../plugins/cool-workflow/project/docs/README.md#the-layer-stack) | The layer stack, one command walked from end to end, and the decision records |
| Add a command | One row in [`src/wiring/capability-table/`](../plugins/cool-workflow/src/wiring/capability-table/) | The body in `src/shell/commands/<name>-cli.ts`; a section in a `docs/*.7.md` man page; `npm run gen:parity && npm run parity:check`. How it fits: [`docs/capability-topology-registry.7.md`](../plugins/cool-workflow/docs/capability-topology-registry.7.md#adding-a-capability) |
| Fix a doc | The page itself | Man pages that go to users: [`docs/`](../plugins/cool-workflow/docs/index.md). Engineering docs that never ship: [`project/docs/`](../plugins/cool-workflow/project/docs/README.md). The README: edit the root copy only; CI makes the npm copy |
| Cut a release | Not yours: the operator runs `npm run release -- X.Y.Z` | An agent only gets the version-bump PR ready: [`docs/release-tooling.7.md`](../plugins/cool-workflow/docs/release-tooling.7.md) and "Shipping a release" in [`AGENTS.md`](../AGENTS.md) |
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
- Keep workflow definitions in `workflows/*.workflow.js` able to run on
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
npm run release:check -- --skip-tests   # every other gate (parity, manifests, index, lang policy, ...)
```

Paste the test summary into the PR text. Do not push to `main`: make a
branch, open a PR, and let green CI merge it.
