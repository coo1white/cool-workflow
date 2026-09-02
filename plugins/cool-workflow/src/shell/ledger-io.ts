// shell/ledger-io.ts — the ledger's directory reads
// (listLedgerEntries/unionLedgerEntries). Impure (fs); the pure verify
// logic they call lives in core/trust/ledger.ts.
//
// MILESTONE 8. Byte-exact port of the old build's ledger module stage-2
// git-transport functions (listLedgerEntries, unionLedgerEntries), split
// out per project/docs/rebuild/PLAN.md's core/shell rule since these two functions are the
// ONLY impure ones in the old ledger.ts module.
//
// Evidence: SPEC/ledger-trust.md "Handoff ledger entry" (listLedgerEntries/
// unionLedgerEntries JSON shapes), "Edge cases" (dir-unreadable/entry-not-
// regular/bad-json).

import * as fs from "node:fs";
import * as path from "node:path";
import {
  LedgerInboxResolution,
  LedgerListEntry,
  resolveLedgerInbox,
  verifyLedgerEntry,
} from "../core/trust/ledger";

export interface LedgerListResult {
  dir: string;
  count: number;
  allOk: boolean;
  entries: LedgerListEntry[];
  resolution: LedgerInboxResolution;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Read every `*.json` in `dir`, verify each entry fail-closed, and
 *  report. `allOk` is false if any entry is tampered, malformed, or
 *  unreadable — so the receiving side refuses the whole inbox rather
 *  than acting on a mixed batch. */
export function listLedgerEntries(dir: string): LedgerListResult {
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith(".json")).sort();
  } catch (error) {
    const entry: LedgerListEntry = {
      file: dir,
      id: null,
      kind: null,
      from: null,
      to: null,
      title: null,
      target: null,
      verdict: null,
      ok: false,
      failedChecks: [{ name: "dir", code: "ledger-dir-unreadable", detail: (error as Error).message }],
    };
    return { dir, count: 0, allOk: false, entries: [entry], resolution: resolveLedgerInbox([entry]) };
  }
  const entries: LedgerListEntry[] = names.map((name) => {
    const file = path.join(dir, name);
    let raw: unknown;
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
    } catch {
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
    const result = verifyLedgerEntry(raw);
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
    resolution: resolveLedgerInbox(entries),
  };
}

export interface LedgerUnionEntry extends LedgerListEntry {
  /** Which mirror directories this entry appeared in. */
  dirs: string[];
}

export interface LedgerUnionResult {
  dirs: string[];
  count: number;
  allOk: boolean;
  entries: LedgerUnionEntry[];
  resolution: LedgerInboxResolution;
}

/** Union-verify several mirror directories into ONE fail-closed inbox.
 *  Verified entries are de-duplicated by their content-addressed id;
 *  failing entries are kept per-occurrence so every problem in every
 *  mirror is visible. `allOk` is false if ANY entry in ANY mirror does
 *  not verify. */
export function unionLedgerEntries(dirs: string[]): LedgerUnionResult {
  const byId = new Map<string, LedgerUnionEntry>();
  const failures: LedgerUnionEntry[] = [];
  let allOk = true;
  for (const dir of dirs) {
    const listed = listLedgerEntries(dir);
    if (!listed.allOk) allOk = false;
    for (const entry of listed.entries) {
      if (entry.ok && entry.id) {
        const existing = byId.get(entry.id);
        if (existing) {
          if (!existing.dirs.includes(dir)) existing.dirs.push(dir);
        } else {
          byId.set(entry.id, { ...entry, dirs: [dir] });
        }
      } else {
        failures.push({ ...entry, dirs: [dir] });
      }
    }
  }
  const entries = [...byId.values(), ...failures];
  return { dirs, count: entries.length, allOk, entries, resolution: resolveLedgerInbox(entries) };
}
