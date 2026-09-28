"use strict";
// mcp/resources.ts — MCP `resources/list` and `resources/read` for run
// reports: each run under `<server cwd>/.cw/runs/` that has a report.md is
// one resource, `cw://runs/<run-id>/report.md` (text/markdown). Read only:
// this never renders a report (cw_report does that); it hands back the
// file as it is on disk. Fail closed: a bad URI, an unsafe run id, or a
// report.md that is missing or not a plain file is an error, never an
// empty success.
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ResourceError = void 0;
exports.listReportResources = listReportResources;
exports.readReportResource = readReportResource;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const URI = /^cw:\/\/runs\/([^/]+)\/report\.md$/;
// The same one-path-segment rule as shell/fs-atomic.ts assertSafeRunId.
const SAFE_RUN_ID = /^[A-Za-z0-9._:-]+$/;
/** A JSON-RPC error with its code, for server.ts to answer with. */
class ResourceError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}
exports.ResourceError = ResourceError;
function reportFile(root, runId) {
    const file = path.join(root, ".cw", "runs", runId, "report.md");
    const stat = fs.lstatSync(file, { throwIfNoEntry: false });
    return stat && stat.isFile() ? file : undefined;
}
/** Every run report under `root`, oldest run first (run ids sort by time). */
function listReportResources(root = process.cwd()) {
    const runsDir = path.join(root, ".cw", "runs");
    if (!fs.existsSync(runsDir))
        return [];
    return fs
        .readdirSync(runsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && SAFE_RUN_ID.test(entry.name) && reportFile(root, entry.name))
        .map((entry) => entry.name)
        .sort()
        .map((runId) => ({ uri: `cw://runs/${runId}/report.md`, name: `${runId} report`, mimeType: "text/markdown" }));
}
/** The `resources/read` result for one report URI. */
function readReportResource(uri, root = process.cwd()) {
    const match = typeof uri === "string" ? URI.exec(uri) : null;
    if (!match)
        throw new ResourceError(-32602, `Invalid resource URI: ${String(uri)} (expected cw://runs/<run-id>/report.md)`);
    const runId = match[1];
    if (!SAFE_RUN_ID.test(runId) || runId === "." || runId === "..")
        throw new ResourceError(-32602, `Unsafe run id in resource URI: ${JSON.stringify(runId)}`);
    const file = reportFile(root, runId);
    if (!file)
        throw new ResourceError(-32002, `Resource not found: ${uri}. Try: cw_report with runId ${runId}`);
    return { contents: [{ uri: uri, mimeType: "text/markdown", text: fs.readFileSync(file, "utf8") }] };
}
