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
it. Without `--output`, it is `<apps>/<app-id>`, where `<apps>` is the first
of these that is there: `$CW_APPS_DIR`, the `apps/` folder of the CW
checkout or installed package that is running, or `./apps`. For an
installed CW that is a folder inside the package itself, so give
`--output` (or set `CW_APPS_DIR`) to keep the app with your own project.

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
