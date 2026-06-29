# INIT(7)

## NAME

`cw init` — scaffold a new workflow definition from nothing

## SYNOPSIS

```text
node dist/cli.js init <workflow-id> [--title TITLE] [--output PATH] [--force]
```

## DESCRIPTION

`cw init` makes a new workflow definition file — a `.workflow.js` file filled
with a simple template. The template has a basic run shape: one step with a
sandbox profile, one evidence gate, and the hooks you need to add your own
steps.

This is how you start a new workflow app from zero. After `init`, you have a
real file you can edit to make your own run shape.

The workflow id you give is turned into a safe file name (spaces become dashes,
special signs are taken out). By default, the file is written to the current
working directory, but you can point it somewhere else with `--output`.

If a file of that name is already there, the command refuses to overwrite it
unless you pass `--force`.

## OPTIONS

`--title TITLE`
: A human name for the workflow. If not given, a title is made from the id.

`--output PATH`
: Where to write the workflow file. Default is `<id>.workflow.js` in the
current directory.

`--force`
: Overwrite an existing file. Without this flag, the command fails if the
file already exists.

## EXIT CODES

| Exit | Meaning |
| --- | --- |
| 0 | Workflow file written |
| 1 | Missing workflow id, invalid id, or file exists without `--force` |

## FILES

```text
src/orchestrator.ts (init method)
src/workflow-app-framework.ts (template renderer)
```

## SEE ALSO

cw list — see all workflow apps you have
cw info <id> — read the shape of a workflow app
workflow-app-framework.7.md — the full framework for writing workflow apps
pipeline-verbs.7.md — plan, dispatch, result (the pipeline engine)
