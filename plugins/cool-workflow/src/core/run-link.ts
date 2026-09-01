// core/run-link.ts — pure logic for "run <-> PR linkage": check a
// link url, build one link annotation, and add it to a run's link list
// with no repeat.
//
// Pure: no file reads, no wall clock, no network call. The shell layer
// (shell/run-link-io.ts) reads the run, calls these helpers, and writes
// the run back to disk. `now` always comes in as a plain string from the
// caller — this file never calls `new Date()` itself.
//
// Evidence: docs/run-registry-control-plane.7.md "Link".

import { RunLinkAnnotation, RunLinkKind } from "./state/types";

const RUN_LINK_KINDS: readonly RunLinkKind[] = ["pr", "issue", "ticket"];

function trimmed(value: unknown): string {
  return value === undefined || value === null ? "" : String(value).trim();
}

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

/** Check that a url text is a good http(s) link. Gives back the trimmed
 *  text, or throws a plain error when it does not parse or does not use
 *  http/https. */
export function parseRunLinkUrl(raw: unknown): string {
  const text = trimmed(raw);
  if (!text) throw new Error("A run link needs a url (--url <url>)");
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    throw new Error(`Run link url does not parse as a url: ${text}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Run link url must use http or https: ${text}`);
  }
  return text;
}

/** Normalize a link kind. Empty/absent -> "pr" (the default). Anything
 *  else must be one of the known kinds, or this throws. */
export function normalizeRunLinkKind(raw: unknown): RunLinkKind {
  const value = trimmed(raw).toLowerCase();
  if (!value) return "pr";
  if ((RUN_LINK_KINDS as readonly string[]).includes(value)) return value as RunLinkKind;
  throw new Error(`Run link kind must be one of: ${RUN_LINK_KINDS.join(", ")} (got "${value}")`);
}

export interface RunLinkInput {
  url: string;
  kind?: string;
  note?: string;
  actor?: string;
}

/** Build one link annotation from input. The actor name, when not given,
 *  falls back to "cw" — the same stand-in this codebase already uses for
 *  an unnamed actor on a run-level record (core/multi-agent/runtime.ts's
 *  lifecycleEvent). */
export function buildRunLink(input: RunLinkInput, now: string): RunLinkAnnotation {
  const url = parseRunLinkUrl(input.url);
  const kind = normalizeRunLinkKind(input.kind);
  const note = trimmed(input.note) || undefined;
  const actor = trimmed(input.actor) || "cw";
  return compact({ url, kind, note, addedAt: now, actor }) as RunLinkAnnotation;
}

export interface AppendRunLinkResult {
  links: RunLinkAnnotation[];
  added: boolean;
  link: RunLinkAnnotation;
}

/** Add a link to a run's link list, unless a link with the same url is
 *  already there — a repeat url is an idempotent no-op: the list comes
 *  back unchanged and `added` is false, with `link` set to the ALREADY
 *  stored entry (its first addedAt/actor is kept, never overwritten). */
export function appendRunLink(existing: readonly RunLinkAnnotation[], link: RunLinkAnnotation): AppendRunLinkResult {
  const found = existing.find((entry) => entry.url === link.url);
  if (found) return { links: [...existing], added: false, link: found };
  return { links: [...existing, link], added: true, link };
}
