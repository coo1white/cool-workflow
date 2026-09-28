// mcp/resources.ts — MCP `resources/list` and `resources/read` for run
// reports: each run under `<server cwd>/.cw/runs/` that has a report.md is
// one resource, `cw://runs/<run-id>/report.md` (text/markdown). Read only:
// this never renders a report (cw_report does that); it hands back the
// file as it is on disk. Fail closed: a bad URI, an unsafe run id, or a
// report.md that is missing or not a plain file is an error, never an
// empty success.

import * as fs from "node:fs";
import * as path from "node:path";

const URI = /^cw:\/\/runs\/([^/]+)\/report\.md$/;
// The same one-path-segment rule as shell/fs-atomic.ts assertSafeRunId.
const SAFE_RUN_ID = /^[A-Za-z0-9._:-]+$/;

export interface McpResource {
  uri: string;
  name: string;
  mimeType: string;
}

/** A JSON-RPC error with its code, for server.ts to answer with. */
export class ResourceError extends Error {
  constructor(readonly code: number, message: string) {
    super(message);
    this.name = "ResourceError";
  }
}

function reportFile(root: string, runId: string): string | undefined {
  const file = path.join(root, ".cw", "runs", runId, "report.md");
  const stat = fs.lstatSync(file, { throwIfNoEntry: false });
  return stat && stat.isFile() ? file : undefined;
}

/** Every run report under `root`, oldest run first (run ids sort by time). */
export function listReportResources(root: string = process.cwd()): McpResource[] {
  const runsDir = path.join(root, ".cw", "runs");
  if (!fs.existsSync(runsDir)) return [];
  return fs
    .readdirSync(runsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && SAFE_RUN_ID.test(entry.name) && reportFile(root, entry.name))
    .map((entry) => entry.name)
    .sort()
    .map((runId) => ({ uri: `cw://runs/${runId}/report.md`, name: `${runId} report`, mimeType: "text/markdown" }));
}

/** The `resources/read` result for one report URI. */
export function readReportResource(uri: unknown, root: string = process.cwd()): { contents: Array<{ uri: string; mimeType: string; text: string }> } {
  const match = typeof uri === "string" ? URI.exec(uri) : null;
  if (!match) throw new ResourceError(-32602, `Invalid resource URI: ${String(uri)} (expected cw://runs/<run-id>/report.md)`);
  const runId = match[1];
  if (!SAFE_RUN_ID.test(runId) || runId === "." || runId === "..") throw new ResourceError(-32602, `Unsafe run id in resource URI: ${JSON.stringify(runId)}`);
  const file = reportFile(root, runId);
  if (!file) throw new ResourceError(-32002, `Resource not found: ${uri}. Try: cw_report with runId ${runId}`);
  return { contents: [{ uri: uri as string, mimeType: "text/markdown", text: fs.readFileSync(file, "utf8") }] };
}
