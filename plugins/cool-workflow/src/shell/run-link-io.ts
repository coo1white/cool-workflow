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

import { RunLinkAnnotation, WorkflowRun } from "../core/state/types";
import { appendRunLink, buildRunLink, RunLinkInput } from "../core/run-link";
import { RunRegistry } from "./run-registry-io";
import { saveCheckpoint } from "./run-store";

export interface RunLinkResult {
  runId: string;
  repo: string;
  added: boolean;
  link: RunLinkAnnotation;
  links: RunLinkAnnotation[];
}

function now(): string {
  return new Date().toISOString();
}

/** `cw run link <run-id> --url <url> [--kind ...] [--note ...]`. Fails
 *  closed (throws) when the run id does not resolve to a real run. */
export function recordRunLink(
  registry: RunRegistry,
  runId: string,
  input: RunLinkInput,
  options: { scope?: "repo" | "home" } = {}
): RunLinkResult {
  const located = registry.locate(runId, options.scope || "home");
  if (!located) {
    throw new Error(`Cannot add a link: run ${runId} not found in source state (fail closed; try registry refresh).`);
  }
  const run: WorkflowRun = registry.loadRun(located.record.repo, runId);
  const existing: RunLinkAnnotation[] = Array.isArray(run.links) ? run.links : [];
  const built = buildRunLink(input, now());
  const result = appendRunLink(existing, built);
  run.links = result.links;
  if (result.added) saveCheckpoint(run);
  return { runId, repo: located.record.repo, added: result.added, link: result.link, links: result.links };
}
