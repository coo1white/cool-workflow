"use strict";
// Pure Workbench navigation policy. The browser page and Node unit test both
// use this file; it holds no run data and does no file or network work.

(function expose(root, factory) {
  const navigation = factory();
  if (typeof module === "object" && module.exports) module.exports = navigation;
  if (root) root.CWWorkbenchNavigation = navigation;
})(typeof globalThis === "object" ? globalThis : this, function buildNavigation() {
  const TAB_KEYS = ["graph", "blackboard", "worker", "candidate", "audit", "metrics", "collaboration"];
  const DEFAULT_TAB = TAB_KEYS[0];

  function knownTab(value) {
    return TAB_KEYS.includes(value) ? value : DEFAULT_TAB;
  }

  function parseFragment(fragment) {
    const source = typeof fragment === "string" && fragment.startsWith("#") ? fragment.slice(1) : fragment || "";
    const params = new URLSearchParams(source);
    const run = params.get("run");
    const requestedTab = params.get("tab");
    return {
      runId: run ? run : null,
      tab: knownTab(requestedTab),
      replace: requestedTab !== null && !TAB_KEYS.includes(requestedTab),
    };
  }

  function formatFragment(runId, tab) {
    if (!runId) return "";
    return `#run=${encodeURIComponent(runId)}&tab=${encodeURIComponent(knownTab(tab))}`;
  }

  function moveTab(current, key) {
    const index = Math.max(0, TAB_KEYS.indexOf(knownTab(current)));
    if (key === "Home") return TAB_KEYS[0];
    if (key === "End") return TAB_KEYS[TAB_KEYS.length - 1];
    if (key === "ArrowLeft") return TAB_KEYS[(index - 1 + TAB_KEYS.length) % TAB_KEYS.length];
    if (key === "ArrowRight") return TAB_KEYS[(index + 1) % TAB_KEYS.length];
    return TAB_KEYS[index];
  }

  return { DEFAULT_TAB, TAB_KEYS, formatFragment, moveTab, parseFragment };
});
