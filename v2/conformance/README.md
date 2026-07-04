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
