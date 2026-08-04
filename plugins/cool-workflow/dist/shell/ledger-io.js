"use strict";
// shell/ledger-io.ts — the ledger's directory reads
// (listLedgerEntries/unionLedgerEntries). Impure (fs); the pure verify
// logic they call lives in core/trust/ledger.ts.
//
// MILESTONE 8. Byte-exact port of the old build's src/ledger.ts stage-2
// git-transport functions (listLedgerEntries, unionLedgerEntries), split
// out per plugins/cool-workflow/project/docs/rebuild/PLAN.md's core/shell rule since these two functions are the
// ONLY impure ones in the old ledger.ts module.
//
// Evidence: SPEC/ledger-trust.md "Handoff ledger entry" (listLedgerEntries/
// unionLedgerEntries JSON shapes), "Edge cases" (dir-unreadable/entry-not-
// regular/bad-json); plugins/cool-workflow/src/ledger.ts:307-391.
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
exports.listLedgerEntries = listLedgerEntries;
exports.unionLedgerEntries = unionLedgerEntries;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const ledger_1 = require("../core/trust/ledger");
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** Read every `*.json` in `dir`, verify each entry fail-closed, and
 *  report. `allOk` is false if any entry is tampered, malformed, or
 *  unreadable — so the receiving side refuses the whole inbox rather
 *  than acting on a mixed batch. */
function listLedgerEntries(dir) {
    let names;
    try {
        names = fs.readdirSync(dir).filter((n) => n.endsWith(".json")).sort();
    }
    catch (error) {
        const entry = {
            file: dir,
            id: null,
            kind: null,
            from: null,
            to: null,
            title: null,
            target: null,
            verdict: null,
            ok: false,
            failedChecks: [{ name: "dir", code: "ledger-dir-unreadable", detail: error.message }],
        };
        return { dir, count: 0, allOk: false, entries: [entry], resolution: (0, ledger_1.resolveLedgerInbox)([entry]) };
    }
    const entries = names.map((name) => {
        const file = path.join(dir, name);
        let raw;
        try {
            const stat = fs.lstatSync(file);
            if (!stat.isFile()) {
                return {
                    file: name,
                    id: null,
                    kind: null,
                    from: null,
                    to: null,
                    title: null,
                    target: null,
                    verdict: null,
                    ok: false,
                    failedChecks: [{ name: "file", code: "ledger-entry-not-regular" }],
                };
            }
            raw = JSON.parse(fs.readFileSync(file, "utf8"));
        }
        catch {
            return {
                file: name,
                id: null,
                kind: null,
                from: null,
                to: null,
                title: null,
                target: null,
                verdict: null,
                ok: false,
                failedChecks: [{ name: "parse", code: "ledger-bad-json" }],
            };
        }
        const result = (0, ledger_1.verifyLedgerEntry)(raw);
        const rec = isRecord(raw) ? raw : {};
        return {
            file: name,
            id: result.id,
            kind: result.kind,
            from: typeof rec.from === "string" ? rec.from : null,
            to: typeof rec.to === "string" ? rec.to : null,
            title: typeof rec.title === "string" ? rec.title : null,
            target: typeof rec.target === "string" ? rec.target : null,
            verdict: typeof rec.verdict === "string" ? rec.verdict : null,
            ok: result.ok,
            failedChecks: result.failedChecks,
        };
    });
    return {
        dir,
        count: entries.length,
        allOk: entries.every((e) => e.ok),
        entries,
        resolution: (0, ledger_1.resolveLedgerInbox)(entries),
    };
}
/** Union-verify several mirror directories into ONE fail-closed inbox.
 *  Verified entries are de-duplicated by their content-addressed id;
 *  failing entries are kept per-occurrence so every problem in every
 *  mirror is visible. `allOk` is false if ANY entry in ANY mirror does
 *  not verify. */
function unionLedgerEntries(dirs) {
    const byId = new Map();
    const failures = [];
    let allOk = true;
    for (const dir of dirs) {
        const listed = listLedgerEntries(dir);
        if (!listed.allOk)
            allOk = false;
        for (const entry of listed.entries) {
            if (entry.ok && entry.id) {
                const existing = byId.get(entry.id);
                if (existing) {
                    if (!existing.dirs.includes(dir))
                        existing.dirs.push(dir);
                }
                else {
                    byId.set(entry.id, { ...entry, dirs: [dir] });
                }
            }
            else {
                failures.push({ ...entry, dirs: [dir] });
            }
        }
    }
    const entries = [...byId.values(), ...failures];
    return { dirs, count: entries.length, allOk, entries, resolution: (0, ledger_1.resolveLedgerInbox)(entries) };
}
