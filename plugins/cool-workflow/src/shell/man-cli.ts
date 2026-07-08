// shell/man-cli.ts — the CLI/MCP-reachable body for `cw man <topic>`.
//
// Reads docs/<topic>.7.md, then docs/<topic>.md, then docs/<topic>, and
// writes the raw file bytes to stdout with NO added trailing newline.
//
// Evidence: SPEC/cli-surface.md "man <topic>" row, and the old build's
// src/cli/command-surface.ts:147-161 ("man" case) — docsDir is resolved
// relative to the plugin root the same way shell/workflow-app-loader.ts's
// walkUpFor and shell/metrics-cli.ts's pluginRoot() do (walk up from this
// file's own location looking for a sibling plugins/cool-workflow tree).

import * as fs from "node:fs";
import * as path from "node:path";
import { isContainedPath } from "./fs-atomic";

export class ManPageNotFoundError extends Error {
  constructor(public readonly topic: string) {
    super(`Man page not found: ${topic}.\n  Tip: cw list for workflow topics, or browse docs/ for manuals.`);
    this.name = "ManPageNotFoundError";
  }
}

function pluginRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, "plugins", "cool-workflow");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

/** Resolves `topic` to the raw file bytes of its manual page, trying
 *  `docs/<topic>.7.md`, then `docs/<topic>.md`, then `docs/<topic>` in
 *  that order. Throws `ManPageNotFoundError` when none of the three
 *  candidates exists as a file. */
export function readManPage(topic: string): string {
  const docsDir = path.join(pluginRoot(), "docs");
  const candidates = [path.join(docsDir, `${topic}.7.md`), path.join(docsDir, `${topic}.md`), path.join(docsDir, topic)];
  for (const candidate of candidates) {
    // A topic containing `..` or an absolute-path escape must never resolve
    // outside docsDir — this bare third candidate would otherwise read any
    // file on disk (e.g. `cw man ../../../../etc/passwd`).
    if (!isContainedPath(candidate, docsDir)) continue;
    try {
      if (fs.statSync(candidate).isFile()) return fs.readFileSync(candidate, "utf8");
    } catch {
      // keep looking
    }
  }
  throw new ManPageNotFoundError(topic);
}
