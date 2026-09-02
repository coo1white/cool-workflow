"use strict";
// shell/workbench-host.ts — the localhost-only, read-only Workbench HTTP
// server: `cw workbench serve`.
//
// MILESTONE 11 (reporting/observability). Byte-exact port of the old
// build's workbench-host module's HTTP behavior: loopback bind only,
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
exports.formatServeHint = formatServeHint;
exports.printServeHint = printServeHint;
const crypto = __importStar(require("node:crypto"));
const fs = __importStar(require("node:fs"));
const http = __importStar(require("node:http"));
const path = __importStar(require("node:path"));
const node_url_1 = require("node:url");
const workbench_1 = require("./workbench");
// `[::1]` is the form Node's URL parser returns for a bracketed IPv6
// literal Host header (verified); the bare `::1` covers a non-bracketed
// header that our fallback split still yields. `.split(":")[0]` alone could
// never produce either (it returns `[` or ``), so those entries used to be
// dead — parseHostname below fixes that.
const ALLOWED_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
/** Extract the hostname from a Host header, correctly handling a bracketed
 *  IPv6 literal (`[::1]:7717`) that a naive `split(":")[0]` mangles into
 *  `"["`. Returns undefined when the header cannot be parsed at all. */
function parseHostname(hostHeader) {
    try {
        return new node_url_1.URL(`http://${hostHeader}`).hostname;
    }
    catch {
        // A non-bracketed IPv6 literal (`::1`) is not a valid URL authority, so
        // URL() throws — fall back to the raw header for that one case; a
        // hostname:port still trims the port.
        if (hostHeader.includes("]") || hostHeader.split(":").length > 2)
            return hostHeader;
        return hostHeader.split(":")[0];
    }
}
function isTTY(stream) {
    return Boolean(stream.isTTY);
}
/** Pure text for the human-friendly serve hint line. Kept separate from
 *  the TTY gate below so it is directly unit-testable with no fake stream
 *  at all: just a port number in, one line of text out. */
function formatServeHint(boundPort) {
    return `workbench serving at http://127.0.0.1:${boundPort} (Ctrl-C to stop)`;
}
/** Prints the human hint line to STDERR only, and only on a real
 *  interactive terminal — the same TTY-gated-nicety pattern as
 *  term.ts's printSuccessSummary: silent when the stream is not a TTY, so
 *  a piped/non-interactive run (and the existing STDOUT descriptor line)
 *  never changes at all. */
function printServeHint(boundPort, stream = process.stderr) {
    if (!isTTY(stream))
        return;
    stream.write(`${formatServeHint(boundPort)}\n`);
}
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
    // If a handler already began the response (e.g. an asset read threw AFTER
    // writeHead), a second writeHead throws ERR_HTTP_HEADERS_SENT synchronously
    // inside the request listener and kills the whole server. Guard against it.
    if (res.headersSent) {
        res.end();
        return;
    }
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
                const hostname = parseHostname(hostHeader);
                if (hostname === undefined || !ALLOWED_HOSTNAMES.has(hostname)) {
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
            // Decode the route path ONCE (old build's decodeRoutePath). Node's
            // `new URL()` does NOT throw on a malformed percent-escape like
            // `/%E0%A4%A`; only decodeURIComponent does — so this is where a
            // malformed URL is caught as a 400 client error (not a 404, not a
            // 500 crash). The decoded route is also what the traversal guard
            // inspects, so an encoded `..%2f..%2f` unescapes to `../../` BEFORE
            // path.resolve, letting it escape uiRoot and fail 403.
            let route;
            try {
                route = decodeURIComponent(url.pathname);
            }
            catch {
                sendJson(res, 400, { error: "bad request: malformed URL path" });
                return;
            }
            // Auth is checked AFTER the route is decoded, and only where run data
            // (or environment data) can flow. Before this, a set token made the
            // browser's own follow-up requests for /ui/app.css and /ui/app.js fail
            // 401 — the page rendered as broken unstyled HTML with no explanation.
            // The three shipped UI files are generic static code with no run data,
            // so they are served without a token. Every /api/* route carries run
            // data and stays behind the token. The "/" route is split: an
            // INSTALLED index.html is the same generic static code (open), but the
            // FALLBACK page embeds the serve descriptor — which carries the
            // absolute repo root path — so a missing UI keeps "/" behind the token.
            if (!this.checkAuth(req, url)) {
                const uiIndexInstalled = fs.existsSync(path.resolve((0, workbench_1.workbenchUiRoot)(), "index.html"));
                if (route.startsWith("/api/") || (route === "/" && !uiIndexInstalled)) {
                    sendJson(res, 401, { error: "unauthorized: token mismatch" });
                    return;
                }
            }
            if (route === "/api/serve") {
                sendJson(res, 200, this.descriptor(false));
                return;
            }
            if (route === "/api/index") {
                const scope = this.args.scope === "home" ? "home" : "repo";
                // Only `text` may be driven by the query string — it is the sidebar
                // filter. Spreading ALL query params (as before) let a request
                // override the server's computed `scope` or inject an arbitrary
                // `cwd`, reading run data from any directory the serving user can
                // read, past the repo the operator chose to serve.
                const text = url.searchParams.get("text") || undefined;
                sendJson(res, 200, (0, workbench_1.buildWorkbenchIndex)({ ...this.args, scope, ...(text ? { text } : {}) }));
                return;
            }
            const runMatch = route.match(/^\/api\/run\/([^/]+)$/);
            if (runMatch) {
                const runId = runMatch[1];
                sendJson(res, 200, (0, workbench_1.buildWorkbenchRunView)(runId, this.args));
                return;
            }
            if (route === "/" || route.startsWith("/ui/")) {
                this.serveUiAsset(route, res);
                return;
            }
            sendJson(res, 404, { error: `no such read-only view: ${route}` });
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
        // Read the bytes BEFORE writeHead: if the asset vanished or became
        // unreadable between the checks above and here (TOCTOU), the throw
        // then lands on the sendJson(500) path with headers not yet sent,
        // instead of a fatal double-writeHead.
        const bytes = fs.readFileSync(resolved);
        res.writeHead(200, { "Content-Type": contentTypeFor(resolved), "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
        res.end(bytes);
    }
    /** Binds the loopback server and resolves once listening. Returns the
     *  actually-bound port (useful for `--port 0`). */
    listen() {
        return new Promise((resolve, reject) => {
            // Defense in depth: `run()` already validated the port before ever
            // reaching here, but a direct caller of listen() still fails closed
            // with the clear message rather than node's opaque ERR_SOCKET_BAD_PORT.
            let requestedPort;
            try {
                requestedPort = (0, workbench_1.parseWorkbenchPort)(this.args.port);
            }
            catch (error) {
                reject(error);
                return;
            }
            const server = http.createServer((req, res) => this.handleRequest(req, res));
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
     *  once listening. `--require-token` is a strict opt-in: default behavior
     *  (unauthenticated local reads when no token is configured) is
     *  unchanged unless the caller explicitly asks to fail closed. */
    async run() {
        const requireToken = Boolean(this.args.requireToken || this.args["require-token"]);
        if (requireToken && !this.token) {
            process.stderr.write("workbench serve --require-token: CW_WORKBENCH_TOKEN is not set; refusing to start.\n");
            process.exitCode = 1;
            return;
        }
        // Validate --port HERE, before any dispatch. The CLI binding calls this
        // as `void host.run()` (not awaited), so a rejection from listen() would
        // otherwise surface as an unhandled promise rejection stack dump on the
        // real CLI. Fail closed the same clean way as --require-token: one `cw:`
        // stderr line + exit 1 + return, never a crash and never a bound server.
        try {
            (0, workbench_1.parseWorkbenchPort)(this.args.port);
        }
        catch (error) {
            process.stderr.write(`cw: ${error instanceof Error ? error.message : String(error)}\n`);
            process.exitCode = 1;
            return;
        }
        const once = Boolean(this.args.once || this.args.json);
        if (once) {
            process.stdout.write(`${JSON.stringify(this.descriptor(true))}\n`);
            return;
        }
        // The bind itself can still fail at runtime (EADDRINUSE when the port
        // is taken, EACCES on a privileged port) — listen() rejects for those.
        // The port-VALUE check above only covers a malformed --port. Fail
        // closed the same clean way rather than an unhandled-rejection crash.
        let boundPort;
        try {
            boundPort = await this.listen();
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            process.stderr.write(`cw: ${message}\n`);
            process.stderr.write(`Try: pick another port with --port <n>, or stop whatever is already serving.\n`);
            process.exitCode = 1;
            return;
        }
        const descriptor = this.descriptor(false, boundPort);
        process.stdout.write(`${JSON.stringify({ ...descriptor, boundPort })}\n`);
        printServeHint(boundPort);
        // Block forever (until the process is killed) — a real serve.
        await new Promise(() => { });
    }
}
exports.WorkbenchHost = WorkbenchHost;
