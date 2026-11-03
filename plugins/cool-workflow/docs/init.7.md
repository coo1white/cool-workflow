# INIT(7)

## NAME

`cw init` — scaffold a new workflow app from nothing

## SYNOPSIS

```text
node dist/cli.js init <app-id> [--title TITLE] [--output DIR] [--force] [--json]
```

## DESCRIPTION

`cw init` makes a new workflow app: a folder with two files, made from a
simple template.

- `app.json` — the app's manifest (id, title, inputs, sandbox profile).
- `workflow.js` — the run shape: one step with a sandbox profile, one
  evidence gate, and the hooks you need to add your own steps.

The new manifest is checked with the same rules as `cw app validate`. This
is how you start a new workflow app from zero; after `init` you edit the
two files to make your own run shape.

The app id you give is turned into a safe name (spaces become dashes,
special signs are taken out). The folder is `--output DIR` when you give
it. Without `--output`, it is `$CW_APPS_DIR/<app-id>` when `CW_APPS_DIR`
is set, and else `./apps/<app-id>` in the folder you run the command in
(new in 0.3.3, a changed default). Up to 0.3.2 the default was the `apps/`
folder of the CW checkout or installed package that was running; for an
installed CW that is inside the package, where it may not be writable and
the next upgrade wipes it. The operator's yes:
`project/docs/intent/2026-10-16-release-gate-ci.md`, "`cw init` writes to
./apps by default (2026-11-02)".

Run from that same folder, `cw plan <app-id>` finds the new app, and
`cw app list` (and `cw list`) show it next to the bundled apps (also new in
0.3.3; up to 0.3.2 they listed only the first apps folder found). An id
that is also a bundled app's id is refused by the list ("Duplicate workflow
app id ..."), never shown twice.

To list the apps in `./apps`, CW reads each `app.json` alone and never runs
its `workflow.js`, so in `cw app list --json` their `phases` and `taskCount`
are `null`; `cw app show <app-id>` (or `cw plan <app-id>`) loads the app and
runs its code. An `app.json` there that is not a CW manifest (no
`"schemaVersion": 1`, such as an Expo `apps/mobile/app.json`) is skipped; a
CW manifest that is not valid is still refused. The operator's choice:
`project/docs/intent/2026-10-16-release-gate-ci.md`, "Operator decisions for
0.3.3, fourth set".

If `app.json` or `workflow.js` is already in that folder, the command
refuses to overwrite it unless you pass `--force`. A system folder (such as
`/usr` or `/etc`) is always refused.

## OPTIONS

`--title TITLE`
: A human name for the app. If not given, a title is made from the id.

`--output DIR`
: The folder to write `app.json` and `workflow.js` into. It is made if it
is not there.

`--force`
: Overwrite an existing `app.json` / `workflow.js`. Without this flag, the
command fails if either is already there.

`--json`
: Print `{"id", "manifestPath", "entrypointPath"}`.

## EXIT CODES

| Exit | Meaning |
| --- | --- |
| 0 | App folder written |
| 1 | Missing or invalid id, files there without `--force`, a system folder, or a template that fails validation |

## FILES

```text
src/shell/workflow-app-loader.ts (initWorkflowApp, the templates)
```

## SEE ALSO

cw list — see all workflow apps you have
cw info <id> — read the shape of a workflow app
workflow-app-framework.7.md — the full framework for writing workflow apps
pipeline-verbs.7.md — plan, dispatch, result (the pipeline engine)
