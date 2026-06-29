# FIX(7)

## NAME

`cw fix` — give back the fix commands for all setup problems

## SYNOPSIS

```text
node dist/cli.js fix
node dist/cli.js fix --json
```

## DESCRIPTION

`cw fix` runs the same setup checks as `cw doctor`, but gives back only the
fix commands — one numbered step for every check that has a problem. No
running check detail, no status glyphs; just the directions you need to put
things right.

When the output is empty ("No fixes needed."), the setup is clean and nothing
needs doing.

Like `cw doctor`, the command only reads — it never makes a file or does a
fix on its own. You are meant to run the fix commands yourself.

If any check has status `fail`, the command exits with code 1.

## OPTIONS

`--json`
: Give back the full doctor report as a stable JSON object, with the same shape
as `cw doctor --json`. The `checks` array carries every fix string.

## EXIT CODES

| Exit | Meaning |
| --- | --- |
| 0 | No fixes needed — all checks ok or only warnings |
| 1 | One or more checks have status `fail` |

## SEE ALSO

cw doctor — the full setup check with detail for every check
