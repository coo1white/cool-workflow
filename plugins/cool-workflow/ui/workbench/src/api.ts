// Shared fetch types and helpers for the run list and run panel client
// islands, ported from the old app.js (apiUrl, getJson). Paths passed to
// apiUrl are RELATIVE ("api/index", never "/api/index") so the page works
// at "/" and under the "/ui" export prefix. The types here are also used
// by the build-time loader (src/load-index.ts) — type-only, so that never
// pulls fetch/browser code into the server bundle.

export interface WorkbenchPanel {
  capability: string;
  cli: string;
  mcp: string;
  status: "present" | "absent";
  data?: unknown;
  error?: string;
}

export interface WorkbenchRunView {
  schemaVersion: 1;
  surface: "workbench";
  runId: string;
  resolved: boolean;
  lifecycle?: string;
  error?: string;
  panels: Record<string, Record<string, WorkbenchPanel>>;
}

export interface WorkbenchRunRecord {
  runId: string;
  appId?: string;
  workflowId?: string;
  repo?: string;
  createdAt?: string;
  lifecycle?: string;
  status?: string;
}

export interface WorkbenchIndexView {
  schemaVersion: 1;
  surface: "workbench";
  command: "index";
  scope: "repo" | "home";
  registry: { freshness?: { status?: string } } & Record<string, unknown>;
  runs: { total?: number; records?: WorkbenchRunRecord[] } & Record<string, unknown>;
}

// The host's auth token, read from the page address on every call (not
// cached at module load: this module is also imported, type-only, from
// server code where `window` does not exist).
function token(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("token") || "";
}

export function apiUrl(pathname: string, params: Record<string, string | undefined> = {}): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  const t = token();
  if (t) search.set("token", t);
  const query = search.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export async function getJson<T = unknown>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`non-JSON response (${res.status}): ${text.slice(0, 120)}`);
  }
  if (res.status === 401) {
    throw new Error("unauthorized — reopen as /?token=<your CW_WORKBENCH_TOKEN value>");
  }
  if (!res.ok) {
    const message = body && typeof body === "object" && "error" in (body as Record<string, unknown>) ? String((body as Record<string, unknown>).error) : `HTTP ${res.status}`;
    throw new Error(message);
  }
  return body as T;
}
