# Getting Started

*This page is for people changing CW itself. To USE `cw`, see the wiki
[Getting Started](https://github.com/coo1white/cool-workflow/wiki/Getting-Started).*

Start from a new clone:

```bash
cd plugins/cool-workflow
bun install --frozen-lockfile
npm run build
npm link         # puts the `cw` command on your PATH
cw version
```

This checkout is set up with bun (one tool, one lockfile: `bun.lock`).
Do not run `npm install`, `pnpm install`, or `yarn install` here. Nothing
stops them at install time: `package.json` has no `preinstall` (or other
install-time) script, because `package.json` goes out in the npm package,
and a script there would run on every user's install as well. From 0.2.8 to
0.3.2 such a guard did that, and `npm i cool-workflow` and
`npx cool-workflow` were broken by it. The bun rule is now kept by the test
gate and CI: `test/package-manager-gate-smoke.mjs` goes red when it sees a
`package-lock.json` (or another second lockfile), npm's
`node_modules/.package-lock.json`, or an install-time script, and CI puts in
the pinned bun and runs `bun install --frozen-lockfile`.
`test/npm-local-install-smoke.mjs` makes certain that a user's local install
and `npx` keep working.

No `npm link`? Every `cw <args>` line on this page also works as
`node scripts/cw.js <args>` from this directory.

## Check your setup first (`cw doctor`)

Like `brew doctor`, this names any setup problem and the fix for it before you
start a run:

```bash
cw doctor          # human-readable
cw doctor --json   # stable payload for scripts
cw fix             # only the fix commands
```

It checks the Node version (v22.13+), whether an agent backend is set up (and
its binary is on `$PATH`), whether `git` is there (for commit provenance),
whether the working-dir `.cw` state is writable, and whether every run there
loads. It is read-only — it makes nothing on disk. It exits non-zero only on a
blocking problem; a missing agent is a warning (`cw demo tamper` and `cw check`
still work).

## One run, end to end

```bash
cw demo tamper                      # the trust checks, no agent needed
cw check -- npm test                # a receipt that your tests passed
cw -q "What are the risks here?" -claude
cw report --show                    # read the newest run's report
cw report bundle --output report.cwrun.json
cw report verify-bundle report.cwrun.json
```

`cw -q` plans the run, hands each task to your agent, takes a result only
when its evidence holds, makes one verifier-gated commit, and writes the
report. If a run stops before the end — an agent error, a Ctrl-C, a lost
session — take it up again from where it stopped:

```bash
cw --resume --run <run-id>
```

That is the whole loop: ask → report → bundle → verify → resume. Each
command's own page is listed in [the docs index](index.md#find-by-command).

## While you change CW

Run the smallest check that fits the change:

```bash
npm run check               # tsc and the src/ size limit (10,000 lines)
npm run build
node test/<nearest>-smoke.mjs
npm run test:unit
npm test                    # a fast sample of 35 smokes (npm run test:gate runs them all)
```

When a test run is slow, make a read-only timing report:

```bash
npm run test:ci -- --json-summary "$TMPDIR/cw-test-summary.json"
```

Use the `slowest` list in that file to choose one test-speed cycle. This is a
guide, not a release gate.

For a manifest change, also run:

```bash
npm run gen:manifests -- --check
```

Before you cut a release, run the full dry-run gate:

```bash
npm run release:check
```

The release check does not damage anything. It builds, type-checks, checks
the src/ size, runs tests, verifies docs, and checks that the version numbers
are in agreement. It does not tag, push, or publish.
