"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleClones = handleClones;
// `cw clones` handler — carved out of the command-surface god-dispatch. The
// remote-source clone cache (v0.1.91): `list` inspects the cached checkouts that
// `--link`/URL reviews populate; `gc` reclaims them (TTL sweep, or --all). Pure
// filesystem work — no network, no run registry, no runner needed.
const capability_core_1 = require("../../capability-core");
const format_1 = require("../format");
const io_1 = require("../io");
/** `cw clones list [--json] | clones gc [--older-than-days N] [--all] [--json]`. */
function handleClones(args) {
    const [subcommand] = args.positionals;
    switch (subcommand) {
        case "list": {
            const result = (0, capability_core_1.listClones)(args.options);
            if ((0, io_1.wantsJson)(args.options))
                (0, io_1.printJson)(result);
            else
                process.stdout.write(`${(0, format_1.formatClonesList)(result)}\n`);
            return;
        }
        case "gc": {
            const result = (0, capability_core_1.gcClones)(args.options);
            if ((0, io_1.wantsJson)(args.options))
                (0, io_1.printJson)(result);
            else
                process.stdout.write(`${(0, format_1.formatClonesGc)(result)}\n`);
            return;
        }
        default:
            throw new Error("Usage: cw.js clones list [--json] | clones gc [--older-than-days N] [--all] [--json]");
    }
}
