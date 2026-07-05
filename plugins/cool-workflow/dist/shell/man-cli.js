"use strict";
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
exports.ManPageNotFoundError = void 0;
exports.readManPage = readManPage;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
class ManPageNotFoundError extends Error {
    topic;
    constructor(topic) {
        super(`Man page not found: ${topic}.\n  Tip: cw list for workflow topics, or browse docs/ for manuals.`);
        this.topic = topic;
        this.name = "ManPageNotFoundError";
    }
}
exports.ManPageNotFoundError = ManPageNotFoundError;
function pluginRoot() {
    let dir = __dirname;
    for (let i = 0; i < 8; i++) {
        const candidate = path.join(dir, "plugins", "cool-workflow");
        if (fs.existsSync(candidate))
            return candidate;
        const parent = path.dirname(dir);
        if (parent === dir)
            break;
        dir = parent;
    }
    return process.cwd();
}
/** Resolves `topic` to the raw file bytes of its manual page, trying
 *  `docs/<topic>.7.md`, then `docs/<topic>.md`, then `docs/<topic>` in
 *  that order. Throws `ManPageNotFoundError` when none of the three
 *  candidates exists as a file. */
function readManPage(topic) {
    const docsDir = path.join(pluginRoot(), "docs");
    const candidates = [path.join(docsDir, `${topic}.7.md`), path.join(docsDir, `${topic}.md`), path.join(docsDir, topic)];
    for (const candidate of candidates) {
        try {
            if (fs.statSync(candidate).isFile())
                return fs.readFileSync(candidate, "utf8");
        }
        catch {
            // keep looking
        }
    }
    throw new ManPageNotFoundError(topic);
}
