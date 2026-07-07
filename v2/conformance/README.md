# Conformance suite

This suite is the spec in test form. It says what the old build does,
as black-box checks. A new build is done when it goes green here.

## Rules for every case

1. Black box only. A case talks to the CLI through `lib.run(...)` and
   reads the files the CLI writes. It must NEVER read the source of any
   build, and never test inner structure.
2. Green on old first. A case that does not pass against the old build
   is wrong — the old build is the source of truth, not the case.
3. One case file = one behavior area. Name: `<area>-<what>.case.js`.
4. No network. No model calls. Where an agent is needed, use a fake
   agent script written into the case's own work dir, wired up with
   `CW_AGENT_COMMAND`.
5. Cases run in their own child process with a private work dir, HOME,
   CW_HOME and TMPDIR. Never write outside them.

## Run it

```bash
node run.js --bin ../../plugins/cool-workflow/dist/cli.js   # old build — must be 100%
node run.js --bin <new build cli.js>                        # new build — the goal
node run.js --bin ... --filter ledger                       # one area
```

## Why `run.js` looks like `test/run-all.js`

`run.js`'s discover-and-run shape is copied from the plugin's own
`test/*-smoke.js` runner, `plugins/cool-workflow/test/run-all.js`, on
purpose (see that file's own header note). This is by design, not an
accident to clean up: this suite is the net that judges every change to
the runtime, so it must never share code with the thing it judges. A bug
in a shared runner could weaken the net at the exact time it needs to
hold. Keep the copy; do not replace it with an `import`/`require` of
`test/run-all.js`.
