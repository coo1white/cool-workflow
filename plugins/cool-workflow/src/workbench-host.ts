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

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { CoolWorkflowRunner } from "./orchestrator";
import {
  WORKBENCH_DEFAULT_PORT,
  buildWorkbenchIndex,
  buildWorkbenchRunView,
  buildWorkbenchServeDescriptor,
  workbenchUiRoot
} from "./workbench";

export interface WorkbenchHostOptions {
  runner: CoolWorkflowRunner;
  cwd?: string;
  port?: number;
  scope?: "repo" | "home";
}

const ALLOWED_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

export class WorkbenchHost {
  readonly runner: CoolWorkflowRunner;
  readonly cwd: string;
  readonly port: number;
  readonly scope: "repo" | "home";
  readonly host = "127.0.0.1";
  private server?: http.Server;

  constructor(options: WorkbenchHostOptions) {
    this.runner = options.runner;
    this.cwd = path.resolve(String(options.cwd || process.cwd()));
    this.port = options.port && options.port > 0 ? Math.floor(options.port) : WORKBENCH_DEFAULT_PORT;
    this.scope = options.scope === "repo" ? "repo" : "home";
  }

  /** The canonical serve descriptor — identical to `cw workbench serve --json`. */
  descriptor(once: boolean): ReturnType<typeof buildWorkbenchServeDescriptor> {
    return buildWorkbenchServeDescriptor(this.runner, { cwd: this.cwd, port: this.port, scope: this.scope, once });
  }

  /** Start listening on loopback only. Resolves with the actually-bound port
   *  (an ephemeral 0 becomes a real port — useful for tests). */
  listen(): Promise<{ host: string; port: number }> {
    const server = http.createServer((req, res) => this.handle(req, res));
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

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) return resolve();
      this.server.close(() => resolve());
    });
  }

  /** Run until interrupted (the CLI default `workbench serve`). */
  async run(): Promise<void> {
    const bound = await this.listen();
    process.stdout.write(`${JSON.stringify({ ...this.descriptor(false), boundPort: bound.port })}\n`);
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    try {
      // Fail closed on anything but a localhost GET.
      if (!isLocalHost(req.headers.host)) return this.send(res, 403, { error: "forbidden: non-localhost Host header" });
      if ((req.method || "GET").toUpperCase() !== "GET") {
        return this.send(res, 405, { error: "read-only: only GET is permitted" }, { Allow: "GET" });
      }

      // Optional token auth (CW_WORKBENCH_TOKEN). When set, every request must
      // carry the token as an Authorization: Bearer header or ?token= query param.
      // Off by default — single-user loopback is already gated by the OS boundary.
      const url = new URL(req.url || "/", `http://${this.host}`);
      const requiredToken = (process.env.CW_WORKBENCH_TOKEN || "").trim();
      if (requiredToken) {
        const bearer = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
        const queryToken = url.searchParams.get("token") || "";
        const tokenBuf = Buffer.from(requiredToken);
        const bearerBuf = Buffer.from(bearer);
        const queryBuf = Buffer.from(queryToken);
        const tokenOk = bearerBuf.length === tokenBuf.length && crypto.timingSafeEqual(bearerBuf, tokenBuf);
        const queryOk = queryBuf.length === tokenBuf.length && crypto.timingSafeEqual(queryBuf, tokenBuf);
        if (!tokenOk && !queryOk) {
          return this.send(res, 401, { error: "unauthorized: token mismatch" });
        }
      }
      const route = decodeURIComponent(url.pathname);

      if (route === "/" || route === "/index.html") return this.sendAsset(res, "index.html");
      if (route.startsWith("/ui/")) return this.sendAsset(res, route.slice("/ui/".length));
      if (route === "/api/serve") return this.send(res, 200, this.descriptor(true));
      if (route === "/api/index") {
        const args = Object.fromEntries(url.searchParams.entries());
        return this.send(res, 200, buildWorkbenchIndex(this.runner, { cwd: this.cwd, scope: this.scope, ...args }));
      }
      const runMatch = /^\/api\/run\/([^/]+)$/.exec(route);
      if (runMatch) {
        return this.send(res, 200, buildWorkbenchRunView(this.runner.withBaseDir(this.cwd), runMatch[1]));
      }
      this.send(res, 404, { error: `no such read-only view: ${route}` });
    } catch (error) {
      this.send(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  }

  /** Serve a static UI asset from disk, re-read on every request (no caching of
   *  authoritative state). Path-traversal is refused; a missing asset is an
   *  honest 404 — the framework ships fine without the UI installed. */
  private sendAsset(res: http.ServerResponse, relative: string): void {
    const uiRoot = workbenchUiRoot(this.runner);
    const resolved = path.resolve(uiRoot, relative);
    if (resolved !== uiRoot && !resolved.startsWith(uiRoot + path.sep)) {
      return this.send(res, 403, { error: "forbidden: path traversal" });
    }
    let body: Buffer;
    try {
      body = fs.readFileSync(resolved);
    } catch {
      if (relative === "index.html") {
        return this.sendRaw(res, 200, CONTENT_TYPES[".html"], Buffer.from(FALLBACK_HTML(uiRoot)));
      }
      return this.send(res, 404, { error: `UI asset not installed: ${relative}` });
    }
    this.sendRaw(res, 200, CONTENT_TYPES[path.extname(resolved)] || "application/octet-stream", body);
  }

  private send(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
    this.sendRaw(res, status, CONTENT_TYPES[".json"], Buffer.from(JSON.stringify(body, null, 2)), headers);
  }

  private sendRaw(
    res: http.ServerResponse,
    status: number,
    contentType: string,
    body: Buffer,
    headers: Record<string, string> = {}
  ): void {
    res.writeHead(status, {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers
    });
    res.end(body);
  }
}

function isLocalHost(hostHeader: string | undefined): boolean {
  if (!hostHeader) return true; // HTTP/1.0 / no Host — loopback bind already constrains us.
  const hostname = hostHeader.replace(/:\d+$/, "");
  return ALLOWED_HOSTNAMES.has(hostname);
}

function FALLBACK_HTML(uiRoot: string): string {
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

function escapeHtml(value: string): string {
  return value.replace(/[&<>]/g, (ch) => (ch === "&" ? "&amp;" : ch === "<" ? "&lt;" : "&gt;"));
}
