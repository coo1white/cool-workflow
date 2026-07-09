"use strict";
// core/format/safe-json.ts — a byte-capped JSON.stringify shared by the CLI's
// `--json` output (cli/io.ts) and the MCP `tools/call` result (mcp/server.ts).
//
// Both surfaces JSON.stringify a caller-selected result with no size limit.
// An aggregate/dashboard capability (e.g. cw_workbench_view, cw comment
// list --json on a run with thousands of comments) can grow to hundreds of
// MB: a useless dump for a calling agent's context window at best, and at
// worst a RangeError ("Invalid string length") once the string crosses
// V8's per-string ceiling (~256M UTF-16 code units) — the same failure
// class PR #316 fixed for batch stdout reconciliation, here on the output
// side instead. Both `--json` and MCP callers already catch a thrown error
// and report it cleanly (cli/entry.ts's top-level catch; mcp/server.ts's
// tools/call try/catch), so this is not a crash fix so much as a "return
// something useful instead of a cryptic RangeError, or an unusable giant
// payload" fix.
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_JSON_OUTPUT_BYTES = void 0;
exports.safeJsonStringify = safeJsonStringify;
/** Generous but bounded: comfortably above any real cw result today, far
 *  below V8's ~256M-UTF-16-code-unit ceiling. */
exports.MAX_JSON_OUTPUT_BYTES = 10 * 1024 * 1024;
/** Overflow-notice `detail` (a caught error's message) is truncated to this
 *  many characters — the notice itself must stay small and predictable
 *  regardless of how large the underlying error's message was (e.g. an
 *  error wrapping a huge stored blackboard-message body), both so the
 *  notice can never itself approach any cap, and so JSON.stringify-ing the
 *  notice can never itself throw. */
const MAX_DETAIL_CHARS = 500;
/** JSON.stringify `value` the same way `JSON.stringify(value, null, 2)`
 *  always has. If that would exceed `maxBytes` (or throws — e.g. a
 *  RangeError from a value so large stringify itself blows V8's string
 *  ceiling), returns a small, valid JSON string describing the overflow
 *  instead of the real payload. Byte-identical to the un-capped form for
 *  every result under the cap — the common case is untouched.
 *
 *  `JSON.stringify` returns the actual value `undefined` (not a string,
 *  despite its `string` return-type declaration) for `undefined`, a
 *  function, or a Symbol — never throws for those. That is passed through
 *  unchanged (matching the un-capped form's pre-existing behavior for this
 *  edge case: `content[0].text`/`printJson`'s `${text}` end up printing
 *  literally `undefined`) rather than measured as a byte length. */
function safeJsonStringify(value, maxBytes = exports.MAX_JSON_OUTPUT_BYTES) {
    let text;
    try {
        text = JSON.stringify(value, null, 2);
    }
    catch (error) {
        return JSON.stringify(overflowPayload(undefined, maxBytes, error), null, 2);
    }
    if (typeof text !== "string")
        return text;
    const bytes = Buffer.byteLength(text, "utf8");
    if (bytes <= maxBytes)
        return text;
    return JSON.stringify(overflowPayload(bytes, maxBytes), null, 2);
}
function overflowPayload(bytes, maxBytes, error) {
    const rawDetail = error instanceof Error ? error.message : error !== undefined ? String(error) : undefined;
    const detail = rawDetail !== undefined
        ? rawDetail.length > MAX_DETAIL_CHARS
            ? `${rawDetail.slice(0, MAX_DETAIL_CHARS)}… (truncated)`
            : rawDetail
        : undefined;
    return {
        error: "result-too-large",
        message: `This result is too large to return in full (${bytes !== undefined ? `${bytes} bytes` : "exceeds the size limit while serializing"}, ` +
            `cap is ${maxBytes} bytes). Narrow the query (a --limit/--status/--since filter, or a more specific tool/verb) and try again.`,
        capBytes: maxBytes,
        ...(bytes !== undefined ? { actualBytes: bytes } : {}),
        ...(detail ? { detail } : {}),
    };
}
