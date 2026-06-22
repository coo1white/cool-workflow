// `cw clones` handler — carved out of the command-surface god-dispatch. The
// remote-source clone cache (v0.1.91): `list` inspects the cached checkouts that
// `--link`/URL reviews populate; `gc` reclaims them (TTL sweep, or --all). Pure
// filesystem work — no network, no run registry, no runner needed.
import { gcClones, listClones } from "../../capability-core";
import { parseArgv } from "../../orchestrator";
import { formatClonesGc, formatClonesList } from "../format";
import { printJson, wantsJson } from "../io";

type ParsedArgs = ReturnType<typeof parseArgv>;

/** `cw clones list [--json] | clones gc [--older-than-days N] [--all] [--json]`. */
export function handleClones(args: ParsedArgs): void {
  const [subcommand] = args.positionals;
  switch (subcommand) {
    case "list": {
      const result = listClones(args.options);
      if (wantsJson(args.options)) printJson(result);
      else process.stdout.write(`${formatClonesList(result)}\n`);
      return;
    }
    case "gc": {
      const result = gcClones(args.options);
      if (wantsJson(args.options)) printJson(result);
      else process.stdout.write(`${formatClonesGc(result)}\n`);
      return;
    }
    default:
      throw new Error("Usage: cw.js clones list [--json] | clones gc [--older-than-days N] [--all] [--json]");
  }
}
