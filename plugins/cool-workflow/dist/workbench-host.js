"use strict";
// Web / Desktop Workbench host (v0.1.30) — a thin, OPTIONAL localhost renderer.
//
// BSD discipline:
//  - LEAST PRIVILEGE, LOCAL BY DEFAULT. Binds 127.0.0.1 ONLY, serves read-only
//    derived views, exposes nothing beyond the current user's `.cw/` scope and
//    the v0.1.28 registry's registered repos. It also rejects non-localhost Host
//    headers (DNS-rebinding defense) and fails closed on anything it cannot read.
//  - READ-ONLY BY DEFAULT. Every route is GET; any write verb is refused 405.
//    The host offers no actions — it is pure inspection. (A future action would
//    have to route through a declared capability core entry, never a parallel
//    path, so it stays parity-gated.)
//  - NO HIDDEN DASHBOARD / OPTIONAL SURFACE. The host imports the kernel, never
//    the reverse. It holds zero authoritative state: every response is re-derived
//    on demand from disk via the SAME core entries the CLI/MCP use. The committed
//    `dist/` + plain `node` runtime keep working with this file deleted.
//
// See src/workbench.ts and docs/web-desktop-workbench.7.md.
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkbenchHost = void 0;
const node_http_1 = __importDefault(require("node:http"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const workbench_1 = require("./workbench");
const ALLOWED_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml"
};
class WorkbenchHost {
    runner;
    cwd;
    port;
    scope;
    host = "127.0.0.1";
    server;
    constructor(options) {
        this.runner = options.runner;
        this.cwd = node_path_1.default.resolve(String(options.cwd || process.cwd()));
        this.port = options.port && options.port > 0 ? Math.floor(options.port) : workbench_1.WORKBENCH_DEFAULT_PORT;
        this.scope = options.scope === "repo" ? "repo" : "home";
    }
    /** The canonical serve descriptor — identical to `cw workbench serve --json`. */
    descriptor(once) {
        return (0, workbench_1.buildWorkbenchServeDescriptor)(this.runner, { cwd: this.cwd, port: this.port, scope: this.scope, once });
    }
    /** Start listening on loopback only. Resolves with the actually-bound port
     *  (an ephemeral 0 becomes a real port — useful for tests). */
    listen() {
        const server = node_http_1.default.createServer((req, res) => this.handle(req, res));
        this.server = server;
        return new Promise((resolve, reject) => {
            server.once("error", reject);
            // Bind the loopback interface ONLY — never a public address.
            server.listen(this.port, this.host, () => {
                const address = server.address();
                const port = address && typeof address === "object" ? address.port : this.port;
                resolve({ host: this.host, port });
            });
        });
    }
    close() {
        return new Promise((resolve) => {
            if (!this.server)
                return resolve();
            this.server.close(() => resolve());
        });
    }
    /** Run until interrupted (the CLI default `workbench serve`). */
    async run() {
        const bound = await this.listen();
        process.stdout.write(`${JSON.stringify({ ...this.descriptor(false), boundPort: bound.port })}\n`);
    }
    handle(req, res) {
        try {
            // Fail closed on anything but a localhost GET.
            if (!isLocalHost(req.headers.host))
                return this.send(res, 403, { error: "forbidden: non-localhost Host header" });
            if ((req.method || "GET").toUpperCase() !== "GET") {
                return this.send(res, 405, { error: "read-only: only GET is permitted" }, { Allow: "GET" });
            }
            const url = new URL(req.url || "/", `http://${this.host}`);
            const route = decodeURIComponent(url.pathname);
            if (route === "/" || route === "/index.html")
                return this.sendAsset(res, "index.html");
            if (route.startsWith("/ui/"))
                return this.sendAsset(res, route.slice("/ui/".length));
            if (route === "/api/serve")
                return this.send(res, 200, this.descriptor(true));
            if (route === "/api/index") {
                const args = Object.fromEntries(url.searchParams.entries());
                return this.send(res, 200, (0, workbench_1.buildWorkbenchIndex)(this.runner, { cwd: this.cwd, scope: this.scope, ...args }));
            }
            const runMatch = /^\/api\/run\/([^/]+)$/.exec(route);
            if (runMatch) {
                const previousCwd = process.cwd();
                process.chdir(this.cwd);
                try {
                    return this.send(res, 200, (0, workbench_1.buildWorkbenchRunView)(this.runner, runMatch[1]));
                }
                finally {
                    process.chdir(previousCwd);
                }
            }
            this.send(res, 404, { error: `no such read-only view: ${route}` });
        }
        catch (error) {
            this.send(res, 500, { error: error instanceof Error ? error.message : String(error) });
        }
    }
    /** Serve a static UI asset from disk, re-read on every request (no caching of
     *  authoritative state). Path-traversal is refused; a missing asset is an
     *  honest 404 — the SDK ships fine without the UI installed. */
    sendAsset(res, relative) {
        const uiRoot = (0, workbench_1.workbenchUiRoot)(this.runner);
        const resolved = node_path_1.default.resolve(uiRoot, relative);
        if (resolved !== uiRoot && !resolved.startsWith(uiRoot + node_path_1.default.sep)) {
            return this.send(res, 403, { error: "forbidden: path traversal" });
        }
        let body;
        try {
            body = node_fs_1.default.readFileSync(resolved);
        }
        catch {
            if (relative === "index.html") {
                return this.sendRaw(res, 200, CONTENT_TYPES[".html"], Buffer.from(FALLBACK_HTML(uiRoot)));
            }
            return this.send(res, 404, { error: `UI asset not installed: ${relative}` });
        }
        this.sendRaw(res, 200, CONTENT_TYPES[node_path_1.default.extname(resolved)] || "application/octet-stream", body);
    }
    send(res, status, body, headers = {}) {
        this.sendRaw(res, status, CONTENT_TYPES[".json"], Buffer.from(JSON.stringify(body, null, 2)), headers);
    }
    sendRaw(res, status, contentType, body, headers = {}) {
        res.writeHead(status, {
            "Content-Type": contentType,
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
            ...headers
        });
        res.end(body);
    }
}
exports.WorkbenchHost = WorkbenchHost;
function isLocalHost(hostHeader) {
    if (!hostHeader)
        return true; // HTTP/1.0 / no Host — loopback bind already constrains us.
    const hostname = hostHeader.replace(/:\d+$/, "");
    return ALLOWED_HOSTNAMES.has(hostname);
}
function FALLBACK_HTML(uiRoot) {
    return [
        "<!doctype html><meta charset=utf-8><title>Cool Workflow Workbench</title>",
        "<body style=\"font-family:system-ui;margin:2rem;color:#222\">",
        "<h1>Cool Workflow Workbench</h1>",
        "<p>The static UI assets are not installed at:</p>",
        `<pre>${escapeHtml(uiRoot)}</pre>`,
        "<p>The read-only JSON views are still served:</p>",
        "<ul><li><a href=\"/api/index\">/api/index</a></li><li><code>/api/run/&lt;runId&gt;</code></li><li><a href=\"/api/serve\">/api/serve</a></li></ul>",
        "</body>"
    ].join("");
}
function escapeHtml(value) {
    return value.replace(/[&<>]/g, (ch) => (ch === "&" ? "&amp;" : ch === "<" ? "&lt;" : "&gt;"));
}
