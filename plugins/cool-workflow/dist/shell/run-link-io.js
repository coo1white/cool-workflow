"use strict";
// shell/run-link-io.ts — the impure half of `run.link`: find one run by
// id (fail closed when it will not load), then use core/run-link.ts's
// pure helpers to build and add one link annotation, writing the run
// back to disk only when the link is new.
//
// No network call anywhere in this file — it only records a link; it
// never calls out to a forge (GitHub, Gitea, ...).
//
// Evidence: the run-link-annotations binding design, WS1 ("run <-> PR
// linkage — Linkage as the minimum bar").
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordRunLink = recordRunLink;
const run_link_1 = require("../core/run-link");
const run_store_1 = require("./run-store");
function now() {
    return new Date().toISOString();
}
/** `cw run link <run-id> --url <url> [--kind ...] [--note ...]`. Fails
 *  closed (throws) when the run id does not resolve to a real run. */
function recordRunLink(registry, runId, input, options = {}) {
    const located = registry.locate(runId, options.scope || "home");
    if (!located) {
        throw new Error(`Cannot add a link: run ${runId} not found in source state (fail closed; try registry refresh).`);
    }
    const run = registry.loadRun(located.record.repo, runId);
    const existing = Array.isArray(run.links) ? run.links : [];
    const built = (0, run_link_1.buildRunLink)(input, now());
    const result = (0, run_link_1.appendRunLink)(existing, built);
    run.links = result.links;
    if (result.added)
        (0, run_store_1.saveCheckpoint)(run);
    return { runId, repo: located.record.repo, added: result.added, link: result.link, links: result.links };
}
