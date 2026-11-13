// core/format/safe-json.ts — a byte-capped JSON.stringify for `--json`, so
// a huge result gives a small notice, not a giant dump or a RangeError.

/** Far above any real result, far below V8's string ceiling. */
export const MAX_JSON_OUTPUT_BYTES = 10 * 1024 * 1024;

/** The notice's `detail` is cut to this, so the notice stays small. */
const MAX_DETAIL_CHARS = 500;

/** `JSON.stringify(value, null, 2)`, byte for byte, under `maxBytes`.
 *  Over it, or if stringify throws, a small JSON notice instead. An
 *  `undefined` result passes through unchanged. */
export function safeJsonStringify(value: unknown, maxBytes: number = MAX_JSON_OUTPUT_BYTES): string {
  let text: string;
  try {
    text = JSON.stringify(value, null, 2);
  } catch (error: unknown) {
    return JSON.stringify(overflowPayload(undefined, maxBytes, error), null, 2);
  }
  if (typeof text !== "string") return text;
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes <= maxBytes) return text;
  return JSON.stringify(overflowPayload(bytes, maxBytes), null, 2);
}

function overflowPayload(bytes: number | undefined, maxBytes: number, error?: unknown): Record<string, unknown> {
  const rawDetail = error instanceof Error ? error.message : error !== undefined ? String(error) : undefined;
  const detail =
    rawDetail !== undefined
      ? rawDetail.length > MAX_DETAIL_CHARS
        ? `${rawDetail.slice(0, MAX_DETAIL_CHARS)}… (truncated)`
        : rawDetail
      : undefined;
  return {
    error: "result-too-large",
    message:
      `This result is too large to return in full (${bytes !== undefined ? `${bytes} bytes` : "exceeds the size limit while serializing"}, ` +
      `cap is ${maxBytes} bytes). Narrow the query (a --limit/--status/--since filter, or a more specific tool/verb) and try again.`,
    capBytes: maxBytes,
    ...(bytes !== undefined ? { actualBytes: bytes } : {}),
    ...(detail ? { detail } : {}),
  };
}
