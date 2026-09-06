// Pure Workbench navigation policy, ported from the old navigation.js. It
// holds no run data. The run list and the run panel are two separate
// client islands (src/run-list.tsx, src/run-panel.tsx); the page address
// is how a selection in one shows in the other, and how Back, Forward and
// a page reload keep the named view.

export const TAB_KEYS = ["graph", "blackboard", "worker", "candidate", "audit", "metrics", "collaboration"] as const;
export type TabKey = (typeof TAB_KEYS)[number];
export const DEFAULT_TAB: TabKey = TAB_KEYS[0];

function knownTab(value: string | null): TabKey {
  return (TAB_KEYS as readonly string[]).includes(value ?? "") ? (value as TabKey) : DEFAULT_TAB;
}

export interface Route {
  runId: string | null;
  tab: TabKey;
  // true when the URL named a tab that is not a known key, so the caller
  // should normalize the address bar (replaceState), not push a new entry.
  replace: boolean;
}

export function parseFragment(fragment: string): Route {
  const source = fragment.startsWith("#") ? fragment.slice(1) : fragment;
  const params = new URLSearchParams(source);
  const run = params.get("run");
  const requestedTab = params.get("tab");
  return {
    runId: run || null,
    tab: knownTab(requestedTab),
    replace: requestedTab !== null && !(TAB_KEYS as readonly string[]).includes(requestedTab),
  };
}

export function formatFragment(runId: string | null, tab: TabKey): string {
  if (!runId) return "";
  return `#run=${encodeURIComponent(runId)}&tab=${encodeURIComponent(knownTab(tab))}`;
}

export function moveTab(current: TabKey, key: string): TabKey {
  const index = Math.max(0, TAB_KEYS.indexOf(current));
  if (key === "Home") return TAB_KEYS[0];
  if (key === "End") return TAB_KEYS[TAB_KEYS.length - 1];
  if (key === "ArrowLeft") return TAB_KEYS[(index - 1 + TAB_KEYS.length) % TAB_KEYS.length];
  if (key === "ArrowRight") return TAB_KEYS[(index + 1) % TAB_KEYS.length];
  return TAB_KEYS[index];
}

// Writes the run/tab into the page address (the auth token stays a query
// param, never lands here) and tells same-tab listeners with a synthetic
// popstate: pushState/replaceState fire no event of their own, so the run
// panel (which only listens for popstate) would otherwise miss a route
// change made by the run list or the tab strip. Real Back/Forward already
// fires a real popstate; this just closes the one gap pushState leaves.
export function writeRoute(runId: string | null, tab: TabKey, mode: "push" | "replace" = "push"): void {
  const fragment = formatFragment(runId, tab);
  if (location.hash === fragment && mode === "push") return;
  const url = `${location.pathname}${location.search}${fragment}`;
  history[mode === "replace" ? "replaceState" : "pushState"](null, "", url);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
