"use strict";
// shell/workbench-host.ts — the localhost-only, read-only Workbench HTTP
// server: `cw workbench serve`.
//
// MILESTONE 11 (reporting/observability). Byte-exact port of the old
// build's src/workbench-host.ts's HTTP behavior: loopback bind only,
// GET-only, non-localhost Host header refused, optional bearer-token
// auth (timing-safe compare), pretty (2-space) JSON responses with
// `Cache-Control: no-store` + `X-Content-Type-Options: nosniff`, a fixed
// fallback index page when the UI is not installed, and `--once`/`--json`
// printing only the descriptor and starting nothing.
//
// CRITICAL: the MCP path (mcp/dispatch.ts) must NEVER start a persistent
// listener — it always forces `once: true` so `cw_workbench_serve` only
// ever returns the descriptor. Only the CLI's default (no `--once`, no
// `--json`) actually binds and blocks.
//
// Evidence: SPEC/reporting-ux.md "Workbench" (HTTP behavior, allowed
// hostnames, serve descriptor stdout line), invariant 11.
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
exports.WorkbenchHost = void 0;
const crypto = __importStar(require("node:crypto"));
const fs = __importStar(require("node:fs"));
const http = __importStar(require("node:http"));
const path = __importStar(require("node:path"));
const node_url_1 = require("node:url");
const workbench_1 = require("./workbench");
const ALLOWED_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
function timingSafeEqual(a, b) {
    const bufA = Buffer.from(a, "utf8");
    const bufB = Buffer.from(b, "utf8");
    if (bufA.length !== bufB.length) {
        // Compare against a same-length dummy so the check still takes
        // constant time relative to the (wrong) input length, matching the
        // old build's mismatched-length handling.
        crypto.timingSafeEqual(bufA, bufA);
        return false;
    }
    return crypto.timingSafeEqual(bufA, bufB);
}
function sendJson(res, status, body) {
    const text = `${JSON.stringify(body, null, 2)}\n`;
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    res.end(text);
}
function contentTypeFor(file) {
    const ext = path.extname(file).toLowerCase();
    const map = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml" };
    return map[ext] || "application/octet-stream";
}
function fallbackIndexHtml(descriptor) {
    const routeLines = descriptor.routes.map((r) => `<li><code>${r.path}</code> — ${r.description}</li>`).join("\n    ");
    return `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Cool Workflow Workbench</title></head>
  <body>
    <h1>Cool Workflow Workbench</h1>
    <p>The Workbench UI is not installed. Read-only JSON routes:</p>
    <ul>
    ${routeLines}
    </ul>
  </body>
</html>
`;
}
class WorkbenchHost {
    args;
    token;
    server;
    constructor(args = {}) {
        this.args = args;
        this.token = process.env.CW_WORKBENCH_TOKEN && process.env.CW_WORKBENCH_TOKEN.trim() ? process.env.CW_WORKBENCH_TOKEN.trim() : undefined;
    }
    /** The serve descriptor; `boundPort` is filled in only after `listen()`
     *  actually binds (an ephemeral `--port 0` resolves to its real port). */
    descriptor(once, boundPort) {
        return (0, workbench_1.buildWorkbenchServeDescriptor)({ ...this.args, once }, boundPort);
    }
    checkAuth(req, url) {
        if (!this.token)
            return true;
        const header = req.headers.authorization;
        const bearer = header && header.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
        const queryToken = url.searchParams.get("token") || undefined;
        const provided = bearer || queryToken;
        if (!provided)
            return false;
        return timingSafeEqual(provided, this.token);
    }
    handleRequest(req, res) {
        try {
            const hostHeader = req.headers.host;
            if (hostHeader) {
                const hostname = hostHeader.split(":")[0];
                if (!ALLOWED_HOSTNAMES.has(hostname)) {
                    sendJson(res, 403, { error: "forbidden: non-localhost Host header" });
                    return;
                }
            }
            if (req.method !== "GET") {
                res.setHeader("Allow", "GET");
                sendJson(res, 405, { error: "read-only: only GET is permitted" });
                return;
            }
            let url;
            try {
                url = new node_url_1.URL(req.url || "/", "http://127.0.0.1");
            }
            catch {
                sendJson(res, 400, { error: "bad request: invalid URL" });
                return;
            }
            if (!this.checkAuth(req, url)) {
                sendJson(res, 401, { error: "unauthorized: token mismatch" });
                return;
            }
            if (url.pathname === "/api/serve") {
                sendJson(res, 200, this.descriptor(false));
                return;
            }
            if (url.pathname === "/api/index") {
                sendJson(res, 200, (0, workbench_1.buildWorkbenchIndex)());
                return;
            }
            const runMatch = url.pathname.match(/^\/api\/run\/([^/]+)$/);
            if (runMatch) {
                const runId = decodeURIComponent(runMatch[1]);
                sendJson(res, 200, (0, workbench_1.buildWorkbenchRunView)(runId, this.args));
                return;
            }
            if (url.pathname === "/" || url.pathname.startsWith("/ui/")) {
                this.serveUiAsset(url.pathname, res);
                return;
            }
            sendJson(res, 404, { error: `no such read-only view: ${url.pathname}` });
        }
        catch (error) {
            sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
        }
    }
    serveUiAsset(pathname, res) {
        const uiRoot = (0, workbench_1.workbenchUiRoot)();
        const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/ui\//, "");
        const resolved = path.resolve(uiRoot, relative);
        if (!resolved.startsWith(path.resolve(uiRoot) + path.sep) && resolved !== path.resolve(uiRoot)) {
            sendJson(res, 403, { error: "forbidden: path traversal" });
            return;
        }
        if (pathname === "/" && !fs.existsSync(resolved)) {
            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
            res.end(fallbackIndexHtml(this.descriptor(false)));
            return;
        }
        if (!fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) {
            sendJson(res, 404, { error: `UI asset not installed: ${relative}` });
            return;
        }
        res.writeHead(200, { "Content-Type": contentTypeFor(resolved), "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
        res.end(fs.readFileSync(resolved));
    }
    /** Binds the loopback server and resolves once listening. Returns the
     *  actually-bound port (useful for `--port 0`). */
    listen() {
        return new Promise((resolve, reject) => {
            const server = http.createServer((req, res) => this.handleRequest(req, res));
            const requestedPort = this.args.port !== undefined ? Number(this.args.port) : undefined;
            server.on("error", reject);
            server.listen(requestedPort ?? 7717, "127.0.0.1", () => {
                this.server = server;
                const address = server.address();
                resolve(typeof address === "object" && address ? address.port : requestedPort || 7717);
            });
        });
    }
    close() {
        return new Promise((resolve) => {
            if (!this.server) {
                resolve();
                return;
            }
            this.server.close(() => resolve());
        });
    }
    /** `cw workbench serve` entry point: `--once`/`--json` prints ONLY the
     *  descriptor (compact JSON) and starts nothing; the default binds and
     *  blocks, printing one compact line (`{...descriptor, boundPort}`)
     *  once listening. */
    async run() {
        const once = Boolean(this.args.once || this.args.json);
        if (once) {
            process.stdout.write(`${JSON.stringify(this.descriptor(true))}\n`);
            return;
        }
        const boundPort = await this.listen();
        const descriptor = this.descriptor(false, boundPort);
        process.stdout.write(`${JSON.stringify({ ...descriptor, boundPort })}\n`);
        // Block forever (until the process is killed) — a real serve.
        await new Promise(() => { });
    }
}
exports.WorkbenchHost = WorkbenchHost;
